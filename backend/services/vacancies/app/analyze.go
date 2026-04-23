package app

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"druz9/vacancies/domain"
)

// AnalyzeURL is the use case behind POST /vacancies/analyze. The user pastes
// a single vacancy link; we detect the source from the host, dispatch to that
// source's SingleFetcher (if any), persist the result idempotently, then run
// the skill extractor and compute the gap vs the caller's known skills.
type AnalyzeURL struct {
	Parsers   []domain.Parser
	Repo      domain.VacancyRepo
	Extractor domain.SkillExtractor
}

// AnalyzeResult is what the handler returns.
type AnalyzeResult struct {
	Vacancy domain.Vacancy
	Gap     domain.SkillGap
}

// Do does the full analyze flow. userSkills can be nil — the gap then has
// every required skill in Missing.
func (a *AnalyzeURL) Do(ctx context.Context, rawURL string, userSkills []string) (AnalyzeResult, error) {
	src, err := DetectSource(rawURL)
	if err != nil {
		return AnalyzeResult{}, err
	}
	parser := a.findParser(src)
	if parser == nil {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: no parser for source %q", src)
	}
	sf, ok := parser.(domain.SingleFetcher)
	if !ok {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: source %q does not support single-URL fetch", src)
	}
	v, err := sf.FetchOne(ctx, rawURL)
	if err != nil {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL.Fetch: %w", err)
	}
	if v.ExternalID == "" {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: parser returned empty external_id")
	}
	if a.Extractor != nil {
		skills, _ := a.Extractor.Extract(ctx, v.Description)
		v.NormalizedSkills = domain.NormalizeSkills(append(append([]string{}, v.RawSkills...), skills...))
	}
	id, err := a.Repo.UpsertByExternal(ctx, &v)
	if err != nil {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL.Upsert: %w", err)
	}
	v.ID = id
	if len(v.NormalizedSkills) > 0 {
		// Persist the freshly-merged skill list — the upsert preserved the
		// pre-existing one on conflict.
		_ = a.Repo.UpdateNormalizedSkills(ctx, id, v.NormalizedSkills)
	}
	gap := domain.ComputeSkillGap(v.NormalizedSkills, userSkills)
	return AnalyzeResult{Vacancy: v, Gap: gap}, nil
}

func (a *AnalyzeURL) findParser(s domain.Source) domain.Parser {
	for _, p := range a.Parsers {
		if p.Source() == s {
			return p
		}
	}
	return nil
}

// DetectSource maps a raw URL onto the source enum. Public so the handler
// can pre-validate the request before invoking the use case.
func DetectSource(rawURL string) (domain.Source, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("vacancies.DetectSource: parse: %w", err)
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	switch {
	case strings.Contains(host, "yandex"):
		return domain.SourceYandex, nil
	// ozon.tech check must come before generic ozon — career.ozon.tech is
	// Ozon Tech (the IT subsidiary) while job.ozon.ru is retail. They are
	// distinct careers sites with different parser shapes.
	case strings.Contains(host, "ozon.tech"):
		return domain.SourceOzonTech, nil
	case strings.Contains(host, "ozon"):
		return domain.SourceOzon, nil
	case strings.Contains(host, "tinkoff") || strings.Contains(host, "tbank"):
		return domain.SourceTinkoff, nil
	case strings.Contains(host, "vk.com") || strings.Contains(host, "vk.ru"):
		return domain.SourceVK, nil
	case strings.Contains(host, "sber"):
		return domain.SourceSber, nil
	case strings.Contains(host, "avito"):
		return domain.SourceAvito, nil
	case strings.Contains(host, "wildberries") || strings.Contains(host, "wb.ru"):
		return domain.SourceWildberries, nil
	case strings.Contains(host, "mts.ru"):
		return domain.SourceMTS, nil
	case strings.Contains(host, "kaspersky"):
		return domain.SourceKaspersky, nil
	case strings.Contains(host, "jetbrains"):
		return domain.SourceJetBrains, nil
	case strings.Contains(host, "lamoda"):
		return domain.SourceLamoda, nil
	}
	return "", fmt.Errorf("vacancies.DetectSource: unsupported host %q", host)
}
