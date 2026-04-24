package app

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"

	"druz9/vacancies/domain"
)

// AnalyzeURL is the use case behind POST /vacancies/analyze. The user
// pastes a single vacancy link; we detect the source from the host,
// extract the source-specific external_id from the path, look it up in
// the listing cache (which holds the entire 5-portal catalogue refreshed
// every 15 min by Phase 3) and return the cached vacancy + skill-gap.
//
// Architectural note: prior to Phase 3 every parser implemented an
// optional `domain.SingleFetcher` for one-off URL lookups. After the
// cache pivot that path was redundant — the cache always has fresher data
// than a fresh single-URL fetch would produce. AnalyzeURL is now a thin
// shim over `cache.Get`, with one nuance: MTS uses a slug in URLs but
// stores `id` as the cache key, so we reverse-resolve via the per-source
// detail key when needed.
type AnalyzeURL struct {
	Cache     CacheReader           // shared with list/get use cases (see list.go)
	Extractor domain.SkillExtractor // optional; merges LLM-extracted skills into the gap calc
}

// AnalyzeResult is what the handler returns.
type AnalyzeResult struct {
	Vacancy domain.Vacancy
	Gap     domain.SkillGap
}

// ErrVacancyNotInCache surfaces when DetectSource + URL parsing succeed
// but the resolved (source, external_id) isn't in the catalogue. Two
// reasons in practice: the vacancy was published after the last 15-min
// refresh, or it was unpublished by the employer. Either way: honest
// error, never a fake "best-guess" payload.
var ErrVacancyNotInCache = errors.New("vacancies.AnalyzeURL: vacancy not found in catalogue (refreshes every 15 min)")

// Do does the full analyze flow. userSkills can be nil — the gap then
// has every required skill in Missing.
func (a *AnalyzeURL) Do(ctx context.Context, rawURL string, userSkills []string) (AnalyzeResult, error) {
	src, err := DetectSource(rawURL)
	if err != nil {
		return AnalyzeResult{}, err
	}
	extID, err := extractExternalID(src, rawURL)
	if err != nil {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: %w", err)
	}
	if a.Cache == nil {
		return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: cache is nil (wiring bug)")
	}
	v, err := a.Cache.Get(src, extID)
	if err != nil {
		// MTS edge: URL holds the slug, cache is keyed by numeric id. We
		// preserve the slug in Vacancy.DetailsKey at parse time, so a
		// short linear scan resolves it without extra HTTP.
		if src == domain.SourceMTS {
			if vv, ok := lookupMTSBySlug(a.Cache.ListBySource(src), extID); ok {
				v = vv
				err = nil
			}
		}
		if err != nil {
			return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: %w", ErrVacancyNotInCache)
		}
	}
	if a.Extractor != nil && strings.TrimSpace(v.Description) != "" {
		// Best-effort: extractor failure must not block the analyze
		// response. Skill-gap with whatever we have is still useful.
		if skills, exErr := a.Extractor.Extract(ctx, v.Description); exErr == nil && len(skills) > 0 {
			merged := append(append([]string{}, v.RawSkills...), skills...)
			v.NormalizedSkills = domain.NormalizeSkills(merged)
		}
	}
	gap := domain.ComputeSkillGap(v.NormalizedSkills, userSkills)
	return AnalyzeResult{Vacancy: v, Gap: gap}, nil
}

// lookupMTSBySlug walks the bucket looking for an item whose DetailsKey
// (the slug, populated at parse time) matches the URL slug. ~25 items/page
// in MTS, O(N) is fine.
func lookupMTSBySlug(items []domain.Vacancy, slug string) (domain.Vacancy, bool) {
	for _, v := range items {
		if v.DetailsKey == slug {
			return v, true
		}
	}
	return domain.Vacancy{}, false
}

// ── URL → external_id extraction ────────────────────────────────────────
//
// Per-source URL shapes (verified 2026-04-23):
//
//	Yandex      yandex.ru/jobs/vacancies/{slug-with-trailing-numeric-id}
//	            e.g.  /jobs/vacancies/multitrack-…-15322            → 15322
//	WB          career.rwb.ru/vacancies/{numeric-id}                → id
//	            (or career.wb.ru/vacancies/{id} — host alias)
//	VK          team.vk.company/vacancy/{numeric-id}/               → id
//	MTS         job.mts.ru/vacancies/{slug}                         → slug
//	            (cache uses numeric id; reverse-lookup via DetailsKey)
//	Ozon        career.ozon.ru/vacancy/{uuid}            → uuid (path)
//	            or  career.ozon.ru/vacancy/?id={uuid}    → uuid (query)
//
// We extract the source-side identifier and let the cache layer worry
// about whether that matches its key.

var yandexSlugIDRe = regexp.MustCompile(`-(\d+)/?$`)

func extractExternalID(src domain.Source, rawURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("parse url: %w", err)
	}
	cleanPath := strings.Trim(u.Path, "/")
	switch src {
	case domain.SourceYandex:
		// Yandex slugs end with -NN where NN is the publication id.
		m := yandexSlugIDRe.FindStringSubmatch(cleanPath)
		if len(m) < 2 {
			return "", fmt.Errorf("yandex: trailing -id not found in path %q", u.Path)
		}
		return m[1], nil
	case domain.SourceWildberries, domain.SourceVK:
		// Last path segment is the numeric id.
		seg := path.Base(cleanPath)
		if seg == "" || seg == "." {
			return "", fmt.Errorf("%s: empty path", src)
		}
		return seg, nil
	case domain.SourceMTS:
		// Last path segment is the slug.
		seg := path.Base(cleanPath)
		if seg == "" || seg == "." {
			return "", fmt.Errorf("mts: empty path")
		}
		return seg, nil
	case domain.SourceOzon:
		// Two shapes: /vacancy/{uuid} or /vacancy/?id={uuid}.
		if id := u.Query().Get("id"); id != "" {
			return id, nil
		}
		seg := path.Base(cleanPath)
		if seg == "" || seg == "." || seg == "vacancy" {
			return "", fmt.Errorf("ozon: id not in path or ?id=")
		}
		return seg, nil
	case domain.SourceOzonTech, domain.SourceTinkoff, domain.SourceSber,
		domain.SourceAvito, domain.SourceKaspersky, domain.SourceJetBrains,
		domain.SourceLamoda:
		// Sources whose constants exist for historical / future use but
		// are NOT in RegisterAll today (no parser, no cache bucket).
		// Fail honestly rather than guess at a URL shape we never verified.
		return "", fmt.Errorf("source %q is detected but not catalogued", src)
	default:
		return "", fmt.Errorf("source %q is detected but not catalogued", src)
	}
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
