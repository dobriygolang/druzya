// Phase 5 — eval harness for the daily brief synthesiser.
//
// Public entry для CLI tool в cmd/eval_coach/. Unit-tests держат свою
// частную тестовую обвязку, а eval — отдельный staic analyzer over
// (input prompt-snapshot, raw LLM response): он не делает LLM call'ов,
// а проверяет что output удовлетворяет качественному контракту:
//
//   - generic_rate     — % recommendations classified as generic
//     (же isGenericRecommendation hook'ом, который parser
//     сам использует для drop-rule).
//   - link_validity    — % inline-links в narrative/recommendations,
//     которые после sanitizeBriefLinks остались. Drop
//     linked URL'а сигналит invented codex slug.
//   - citation_rate    — % rationales содержащих ≥1 числовой токен
//     (\d+) — proxy for "specific signal".
//   - severity_buckets — counts cruise/nudge/warn/critical.
//
// Это не «реальный» eval (для него нужен LLM call с api keys). Это
// guardrail: catch регрессии в parser + анти-fluff filter без денег
// на LLM в CI.
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"druz9/intelligence/domain"
)

// EvalSample — один кейс датасета. Raw — это string, который мы
// прогоняем через parseBriefJSON (тот же путь что в проде).
type EvalSample struct {
	Name string                  `json:"name"`
	In   domain.BriefPromptInput `json:"in"`
	Raw  string                  `json:"raw"`
}

// EvalMetrics — итоги одного sample.
type EvalMetrics struct {
	Sample           string `json:"sample"`
	ParseOK          bool   `json:"parse_ok"`
	ParseErr         string `json:"parse_err,omitempty"`
	RecommendationsN int    `json:"recommendations_n"`
	GenericN         int    `json:"generic_n"`
	GenericRatePct   int    `json:"generic_rate_pct"`  // 0..100
	LinkValidityPct  int    `json:"link_validity_pct"` // 0..100; -1 если нет ссылок
	CitationRatePct  int    `json:"citation_rate_pct"` // 0..100
	Severity         string `json:"severity"`          // cruise/nudge/warn/critical
	Headline         string `json:"headline"`
}

// EvalReport — aggregated metrics over a dataset.
type EvalReport struct {
	Total           int            `json:"total"`
	ParsedOK        int            `json:"parsed_ok"`
	GenericRatePct  int            `json:"generic_rate_pct"`
	LinkValidityPct int            `json:"link_validity_pct"`
	CitationRatePct int            `json:"citation_rate_pct"`
	SeverityBuckets map[string]int `json:"severity_buckets"`
	PerSample       []EvalMetrics  `json:"per_sample"`
}

// LoadEvalDataset reads samples from the same JSON shape EvalDataset
// produces. Caller-friendly thin wrapper to keep main.go tight.
func LoadEvalDataset(raw []byte) ([]EvalSample, error) {
	var out []EvalSample
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("intelligence.LoadEvalDataset: %w", err)
	}
	return out, nil
}

// EvalDataset runs all samples, aggregates metrics. Pure function — no
// LLM calls, no DB access. Safe to invoke в CI без api keys / network.
func EvalDataset(samples []EvalSample) EvalReport {
	rep := EvalReport{
		Total:           len(samples),
		SeverityBuckets: map[string]int{"cruise": 0, "nudge": 0, "warn": 0, "critical": 0},
		PerSample:       make([]EvalMetrics, 0, len(samples)),
		// Use -1 to distinguish «нет ссылок ни в одном sample'е» от 0%.
		LinkValidityPct: -1,
	}
	var (
		recsTotal       int
		genericTotal    int
		linkSeen        int
		linkValid       int
		citationsTotal  int
		rationalesTotal int
		parsedOK        int
	)
	for _, s := range samples {
		m := evalOne(s)
		rep.PerSample = append(rep.PerSample, m)
		if !m.ParseOK {
			continue
		}
		parsedOK++
		recsTotal += m.RecommendationsN
		genericTotal += m.GenericN
		if m.LinkValidityPct >= 0 {
			// Перевод per-sample процента обратно в counts грубоват — но
			// у нас нет separate fields. Для CI хватит per-sample average,
			// поэтому aggregate как mean of per-sample percentages.
			linkSeen++
			linkValid += m.LinkValidityPct
		}
		citationsTotal += m.CitationRatePct
		rationalesTotal++
		if m.Severity != "" {
			rep.SeverityBuckets[m.Severity]++
		}
	}
	rep.ParsedOK = parsedOK
	if recsTotal > 0 {
		rep.GenericRatePct = (genericTotal * 100) / recsTotal
	}
	if linkSeen > 0 {
		rep.LinkValidityPct = linkValid / linkSeen
	}
	if rationalesTotal > 0 {
		rep.CitationRatePct = citationsTotal / rationalesTotal
	}
	return rep
}

// evalOne runs the parser над одним sample'ом и считает метрики.
func evalOne(s EvalSample) EvalMetrics {
	out := EvalMetrics{Sample: s.Name, LinkValidityPct: -1}

	// Запускаем тот же parser что и synthesiser в проде.
	brief, err := parseBriefJSON(s.Raw, s.In)
	if err != nil {
		out.ParseErr = err.Error()
		return out
	}
	out.ParseOK = true
	out.RecommendationsN = len(brief.Recommendations)
	out.Severity = string(brief.Severity)
	out.Headline = brief.Headline

	// Generic check (parser уже фильтрует — но проверим как guardrail
	// чтобы любая регрессия в isGenericRecommendation сразу всплыла).
	for _, r := range brief.Recommendations {
		if isGenericRecommendation(r.Title, r.Rationale) {
			out.GenericN++
		}
	}
	if out.RecommendationsN > 0 {
		out.GenericRatePct = (out.GenericN * 100) / out.RecommendationsN
	}

	// Link validity: сравниваем raw envelope (до sanitize) с финальным
	// brief (после). Drop'нутая ссылка = invented slug.
	rawLinks := countMarkdownLinks(s.Raw)
	finalLinks := countMarkdownLinks(brief.Headline) +
		countMarkdownLinks(brief.Narrative)
	for _, r := range brief.Recommendations {
		finalLinks += countMarkdownLinks(r.Title) + countMarkdownLinks(r.Rationale)
	}
	if rawLinks > 0 {
		out.LinkValidityPct = (finalLinks * 100) / rawLinks
		if out.LinkValidityPct > 100 {
			out.LinkValidityPct = 100
		}
	}

	// Citation: % recommendations rationale которое содержит хотя бы
	// одно число (\d+). Proxy for "specific signal cited".
	if out.RecommendationsN > 0 {
		var cited int
		for _, r := range brief.Recommendations {
			if numberRe.MatchString(r.Rationale) {
				cited++
			}
		}
		out.CitationRatePct = (cited * 100) / out.RecommendationsN
	}
	return out
}

var (
	numberRe   = regexp.MustCompile(`\d+`)
	mdLinkExpr = regexp.MustCompile(`\[[^\]]+\]\([^)]+\)`)
)

func countMarkdownLinks(s string) int {
	if !strings.Contains(s, "](") {
		return 0
	}
	return len(mdLinkExpr.FindAllString(s, -1))
}

// EvalReportText returns a compact human-readable summary of a report
// suitable for stdout / CI logs. JSON output is also useful and lives
// in the CLI tool side.
func EvalReportText(rep EvalReport) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "samples=%d  parsed_ok=%d/%d\n", rep.Total, rep.ParsedOK, rep.Total)
	fmt.Fprintf(&sb, "generic_rate_pct=%d  citation_rate_pct=%d  link_validity_pct=%d\n",
		rep.GenericRatePct, rep.CitationRatePct, rep.LinkValidityPct)
	fmt.Fprintf(&sb, "severity: cruise=%d  nudge=%d  warn=%d  critical=%d\n",
		rep.SeverityBuckets["cruise"], rep.SeverityBuckets["nudge"],
		rep.SeverityBuckets["warn"], rep.SeverityBuckets["critical"])
	for _, m := range rep.PerSample {
		if !m.ParseOK {
			fmt.Fprintf(&sb, "  ✕ %-30s parse_err=%q\n", m.Sample, m.ParseErr)
			continue
		}
		fmt.Fprintf(&sb, "  · %-30s sev=%-8s recs=%d  generic=%d/%d  cite=%d%%  link=%d%%\n",
			m.Sample, m.Severity,
			m.RecommendationsN, m.GenericN, m.RecommendationsN,
			m.CitationRatePct, m.LinkValidityPct,
		)
	}
	return sb.String()
}

// Used to keep ctx in the signature scaffold even when we don't
// need it; allows Future async-only checks (semantic-similarity over
// embedder, etc) to slot in без breaking caller'а.
var _ = context.TODO
