// eval_ai — Phase 1.7f learning-companion eval suite.
//
// Static guardrail для 4 datasets:
//   - dataset.json                 (legacy daily-brief coach)
//   - dataset_next_action.json     (TaskAssistantNextAction)
//   - dataset_fork_analysis.json   (TaskAssistantForkAnalysis)
//   - dataset_curate_resource.json (TaskCurateResource)
//
// Per-dataset shape:
//
//	[{ name, task, input, raw_response, regression: {...} }, ...]
//
// regression-flags задают per-sample проверки:
//   - must_cite_axis / must_cite_step / must_cite_interview / must_cite_engagement
//     — substring-match в raw_response, case-insensitive
//   - must_not_be_generic — отсутствие generic-фраз в rationale
//   - must_not_force_commit — нет 'commit' в action_kind когда explore
//   - must_acknowledge_no_signal — есть «too early» / «not enough» / etc.
//   - confidence_max / confidence_delta_max — числовые границы
//   - min_resources / max_resources — для curate output
//   - all_urls_absolute / all_why_non_empty / all_kinds_valid — curation
//   - expected_to_fail — sample специально невалидный, fail = pass
//
// Не делает LLM-вызовов. CI-friendly. Exit 1 если хоть один fail.
//
// Usage:
//
//	go run ./cmd/eval_ai
//	go run ./cmd/eval_ai -dataset dataset_next_action.json
//	go run ./cmd/eval_ai -json
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"druz9/curation/domain"
)

type sample struct {
	Name        string         `json:"name"`
	Task        string         `json:"task"`
	Input       map[string]any `json:"input"`
	RawResponse string         `json:"raw_response"`
	Regression  map[string]any `json:"regression"`
}

type result struct {
	Sample sample
	Passed bool
	Reason string
}

type report struct {
	Dataset  string   `json:"dataset"`
	Total    int      `json:"total"`
	Passed   int      `json:"passed"`
	Failures []string `json:"failures,omitempty"`
}

var genericPhrases = []string{
	"practice algorithms",
	"do system design",
	"work on databases",
	"review your notes",
	"be consistent",
	"keep going",
	"keep up the good work",
	"stay consistent",
	"it is important",
	"important",
}

func main() {
	dir := flag.String("dir", "cmd/eval_ai", "directory containing dataset_*.json")
	one := flag.String("dataset", "", "single dataset to run (filename relative to -dir)")
	asJSON := flag.Bool("json", false, "emit machine-readable JSON")
	flag.Parse()

	files := []string{}
	if *one != "" {
		files = append(files, filepath.Join(*dir, *one))
	} else {
		matches, err := filepath.Glob(filepath.Join(*dir, "dataset_*.json"))
		if err != nil {
			fmt.Fprintf(os.Stderr, "eval_ai: glob: %v\n", err)
			os.Exit(2)
		}
		files = matches
	}
	if len(files) == 0 {
		fmt.Fprintf(os.Stderr, "eval_ai: no datasets found under %s\n", *dir)
		os.Exit(2)
	}

	exitCode := 0
	reports := make([]report, 0, len(files))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			fmt.Fprintf(os.Stderr, "eval_ai: read %s: %v\n", f, err)
			os.Exit(2)
		}
		var samples []sample
		if err := json.Unmarshal(raw, &samples); err != nil {
			fmt.Fprintf(os.Stderr, "eval_ai: parse %s: %v\n", f, err)
			os.Exit(2)
		}
		rep := report{Dataset: filepath.Base(f), Total: len(samples)}
		for _, s := range samples {
			r := evaluate(s)
			if r.Passed {
				rep.Passed++
			} else {
				rep.Failures = append(rep.Failures, fmt.Sprintf("%s: %s", s.Name, r.Reason))
			}
		}
		if rep.Passed < rep.Total {
			exitCode = 1
		}
		reports = append(reports, rep)
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(reports)
	} else {
		for _, rep := range reports {
			fmt.Printf("== %s ==  %d/%d passed\n", rep.Dataset, rep.Passed, rep.Total) //nolint:forbidigo // CLI tool: writes report to stdout
			for _, f := range rep.Failures {
				fmt.Printf("  FAIL %s\n", f) //nolint:forbidigo // CLI tool: writes report to stdout
			}
		}
	}
	os.Exit(exitCode)
}

func evaluate(s sample) result {
	expectedToFail := boolFlag(s.Regression, "expected_to_fail")

	checks := []func(s sample) (bool, string){
		checkMustCite("must_cite_axis"),
		checkMustCite("must_cite_step"),
		checkMustCite("must_cite_interview"),
		checkMustCite("must_cite_engagement"),
		checkNotGeneric,
		checkNoForceCommit,
		checkAcknowledgeNoSignal,
		checkConfidence,
		checkResources,
	}

	hasFail := false
	var reasons []string
	for _, c := range checks {
		ok, reason := c(s)
		if !ok {
			hasFail = true
			reasons = append(reasons, reason)
		}
	}

	r := result{Sample: s}
	if expectedToFail {
		// Sample должен fail — invert.
		if hasFail {
			r.Passed = true
			return r
		}
		r.Reason = "expected_to_fail but all regressions passed"
		return r
	}
	r.Passed = !hasFail
	if hasFail {
		r.Reason = strings.Join(reasons, "; ")
	}
	return r
}

func checkMustCite(key string) func(s sample) (bool, string) {
	return func(s sample) (bool, string) {
		v, ok := s.Regression[key].(string)
		if !ok || v == "" {
			return true, ""
		}
		if !strings.Contains(strings.ToLower(s.RawResponse), strings.ToLower(v)) {
			return false, fmt.Sprintf("%s=%q not cited", key, v)
		}
		return true, ""
	}
}

func checkNotGeneric(s sample) (bool, string) {
	if !boolFlag(s.Regression, "must_not_be_generic") {
		return true, ""
	}
	low := strings.ToLower(s.RawResponse)
	for _, p := range genericPhrases {
		if strings.Contains(low, p) {
			return false, fmt.Sprintf("generic phrase detected: %q", p)
		}
	}
	return true, ""
}

func checkNoForceCommit(s sample) (bool, string) {
	if !boolFlag(s.Regression, "must_not_force_commit") {
		return true, ""
	}
	low := strings.ToLower(s.RawResponse)
	if strings.Contains(low, "\"action_kind\":\"commit\"") || strings.Contains(low, "force commit") {
		return false, "explore mode but action forces commit"
	}
	return true, ""
}

func checkAcknowledgeNoSignal(s sample) (bool, string) {
	if !boolFlag(s.Regression, "must_acknowledge_no_signal") {
		return true, ""
	}
	low := strings.ToLower(s.RawResponse)
	for _, p := range []string{"too early", "not enough", "no signal", "early to judge", "still exploring"} {
		if strings.Contains(low, p) {
			return true, ""
		}
	}
	return false, "missing no-signal acknowledgement"
}

func checkConfidence(s sample) (bool, string) {
	maxC, hasMax := floatFlag(s.Regression, "confidence_max")
	deltaMax, hasDelta := floatFlag(s.Regression, "confidence_delta_max")
	if !hasMax && !hasDelta {
		return true, ""
	}
	var resp struct {
		Confidence float64 `json:"confidence"`
	}
	if err := json.Unmarshal([]byte(s.RawResponse), &resp); err != nil {
		return false, fmt.Sprintf("confidence parse: %v", err)
	}
	if hasMax && resp.Confidence > maxC {
		return false, fmt.Sprintf("confidence=%.2f > max %.2f", resp.Confidence, maxC)
	}
	if hasDelta {
		prior, _ := floatFlag(s.Input, "prior_confidence")
		if v := abs(resp.Confidence - prior); v > deltaMax {
			return false, fmt.Sprintf("|delta|=%.2f > %.2f", v, deltaMax)
		}
	}
	return true, ""
}

func checkResources(s sample) (bool, string) {
	if s.Task != "curate_resource" {
		return true, ""
	}
	low, _ := floatFlag(s.Regression, "min_resources")
	high, _ := floatFlag(s.Regression, "max_resources")
	allURL := boolFlag(s.Regression, "all_urls_absolute")
	allWhy := boolFlag(s.Regression, "all_why_non_empty")
	allKinds := boolFlag(s.Regression, "all_kinds_valid")
	if low == 0 && high == 0 && !allURL && !allWhy && !allKinds {
		return true, ""
	}
	list, err := domain.Unmarshal([]byte(s.RawResponse))
	if err != nil {
		return false, fmt.Sprintf("resources parse: %v", err)
	}
	n := len(list)
	if low > 0 && float64(n) < low {
		return false, fmt.Sprintf("only %d resources, need >= %.0f", n, low)
	}
	if high > 0 && float64(n) > high {
		return false, fmt.Sprintf("%d resources, max %.0f", n, high)
	}
	for i, r := range list {
		if allURL {
			u, err := url.Parse(r.URL)
			if err != nil || u == nil || !u.IsAbs() {
				return false, fmt.Sprintf("resource[%d] url not absolute: %q", i, r.URL)
			}
		}
		if allWhy && strings.TrimSpace(r.Why) == "" {
			return false, fmt.Sprintf("resource[%d] empty why", i)
		}
		if allKinds && !r.Kind.IsValid() {
			return false, fmt.Sprintf("resource[%d] invalid kind: %q", i, r.Kind)
		}
	}
	return true, ""
}

func boolFlag(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

func floatFlag(m map[string]any, key string) (float64, bool) {
	if m == nil {
		return 0, false
	}
	v, ok := m[key].(float64)
	return v, ok
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
