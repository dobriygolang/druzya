package app

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"druz9/vacancies/domain"
)

// AnalyzeURL is the use case behind POST /vacancies/analyze. The user
// pastes a single vacancy link; we detect the source from the host,
// dispatch to that source's SingleFetcher, route the result through the
// cache (Upsert) so it's immediately addressable, run the optional skill
// extractor, and compute the gap vs the caller's known skills.
type AnalyzeURL struct {
	Parsers   []domain.Parser
	Cache     CacheUpserter
	Extractor domain.SkillExtractor
}

// CacheUpserter is the cache surface AnalyzeURL needs.
type CacheUpserter interface {
	Upsert(v domain.Vacancy)
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
		// Best-effort: extractor failure must not block the analyze response.
		// Skill-gap with whatever we have is still useful.
		if skills, exErr := a.Extractor.Extract(ctx, v.Description); exErr == nil {
			v.NormalizedSkills = domain.NormalizeSkills(append(append([]string{}, v.RawSkills...), skills...))
		}
	}
	if a.Cache != nil {
		a.Cache.Upsert(v)
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
	// Ozon Tech (the IT subsidiary) while job.ozon.ru is retail.
	case strings.Contains(host, "ozon.tech"):
		return domain.SourceOzonTech, nil
	case strings.Contains(host, "ozon"):
		return domain.SourceOzon, nil
	case strings.Contains(host, "tinkoff") || strings.Contains(host, "tbank"):
		return domain.SourceTinkoff, nil
	case strings.Contains(host, "vk.com") || strings.Contains(host, "vk.ru") || strings.Contains(host, "vk.company"):
		return domain.SourceVK, nil
	case strings.Contains(host, "sber"):
		return domain.SourceSber, nil
	case strings.Contains(host, "avito"):
		return domain.SourceAvito, nil
	case strings.Contains(host, "wildberries") || strings.Contains(host, "wb.ru") || strings.Contains(host, "rwb.ru"):
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
