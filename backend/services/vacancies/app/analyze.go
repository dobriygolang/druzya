package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"path"
	"regexp"
	"strings"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
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
	Cache     CacheReader               // shared with list/get use cases (see list.go)
	Details   DetailsReader             // Phase-4 lazy detail cache; pivots analysis off the rich description
	Extractor domain.SkillExtractor     // optional; merges LLM-extracted skills into the gap calc
	UserSkill domain.UserSkillsResolver // Phase-5; resolves user stack from real profile stats
	Log       *slog.Logger
}

// AnalyzeResult is what the handler returns.
//
// Phase 5: MatchScore is round(len(matched)/len(required) * 100), clamped
// to [0,100]. UserProfile is the resolved user stack (transparency: the
// frontend renders "we used these of yours" so the user can sanity-check
// why a missing-list looks the way it does).
type AnalyzeResult struct {
	Vacancy     domain.Vacancy
	Gap         domain.SkillGap
	MatchScore  int
	UserProfile domain.UserSkillsProfile
}

// ErrVacancyNotInCache surfaces when DetectSource + URL parsing succeed
// but the resolved (source, external_id) isn't in the catalogue. Two
// reasons in practice: the vacancy was published after the last 15-min
// refresh, or it was unpublished by the employer. Either way: honest
// error, never a fake "best-guess" payload.
var ErrVacancyNotInCache = errors.New("vacancies.AnalyzeURL: vacancy not found in catalogue (refreshes every 15 min)")

// Do runs the full Phase-5 analyze flow:
//
//	DetectSource → extractExternalID
//	  → DetailsCache.Get (Phase-4 rich detail; falls back to listing on miss)
//	    — gives full description with обязанности/требования/условия text
//	  → SkillExtractor on details.DescriptionHTML+joined sections
//	    — yields 15-30 normalized skills (vs ~5 from listing)
//	  → UserSkillsResolver.Resolve(ctx, userID)
//	    — reads stats, derives demonstrable skill set
//	  → ComputeSkillGap(required=details.NormalizedSkills, user=resolved.Skills)
//	  → MatchScore = round(matched/required * 100)
//
// userID is mandatory (the handler enforces auth). When the user has no
// derivable stack the result still includes the requirement list — the
// frontend renders that as "what you need for this vacancy".
func (a *AnalyzeURL) Do(ctx context.Context, rawURL string, userID uuid.UUID) (AnalyzeResult, error) {
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

	// Pivot off the rich details — DescriptionHTML + bullet sections give
	// the LLM extractor 3-6× more text to work with than the listing
	// snippet. On detail-cache failure (upstream blocked, no fetcher
	// registered for the source, etc.) we fall back to the listing v.
	// Anti-fallback: never fabricate; just degrade to what we have.
	descriptionForExtraction := v.Description
	if a.Details != nil {
		if d, derr := a.Details.Get(ctx, src, v.ExternalID); derr == nil {
			v = d.Vacancy
			descriptionForExtraction = combineDescription(d)
		} else if a.Log != nil {
			a.Log.Warn("vacancies.AnalyzeURL: details lookup failed, using listing description",
				slog.String("source", string(src)),
				slog.String("external_id", v.ExternalID),
				slog.Any("err", derr))
		}
	}

	if a.Extractor != nil && strings.TrimSpace(descriptionForExtraction) != "" {
		// Best-effort: extractor failure must not block the analyze
		// response — keep the listing-level NormalizedSkills as the
		// requirement set. Log + WARN per anti-fallback policy.
		skills, exErr := a.Extractor.Extract(ctx, descriptionForExtraction)
		switch {
		case exErr != nil:
			if a.Log != nil {
				a.Log.Warn("vacancies.AnalyzeURL: skill extractor failed, keeping listing skills",
					slog.String("source", string(src)),
					slog.String("external_id", v.ExternalID),
					slog.Any("err", exErr))
			}
		case len(skills) > 0:
			merged := append(append([]string{}, v.RawSkills...), skills...)
			v.NormalizedSkills = domain.NormalizeSkills(merged)
		}
	}

	var profile domain.UserSkillsProfile
	if a.UserSkill != nil {
		p, perr := a.UserSkill.Resolve(ctx, userID)
		if perr != nil {
			return AnalyzeResult{}, fmt.Errorf("vacancies.AnalyzeURL: resolve user skills: %w", perr)
		}
		profile = p
	}

	gap := domain.ComputeSkillGap(v.NormalizedSkills, profile.Skills)
	score := matchScore(gap, a.Log, src, v.ExternalID)
	return AnalyzeResult{
		Vacancy:     v,
		Gap:         gap,
		MatchScore:  score,
		UserProfile: profile,
	}, nil
}

// matchScore returns round(len(matched)/len(required) * 100), clamped to
// [0,100]. Empty required ⇒ 0 + WARN log (silent extraction means we have
// nothing to compare against, which is a real signal not a UI failure).
func matchScore(gap domain.SkillGap, log *slog.Logger, src domain.Source, extID string) int {
	if len(gap.Required) == 0 {
		if log != nil {
			log.Warn("vacancies.AnalyzeURL: required skills empty, match_score=0",
				slog.String("source", string(src)),
				slog.String("external_id", extID))
		}
		return 0
	}
	score := (len(gap.Matched)*100 + len(gap.Required)/2) / len(gap.Required) // round-half-up
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

// combineDescription joins everything text-bearing in VacancyDetails for
// the LLM extractor — DescriptionHTML, the bullet sections, the optional
// team blurb and tech_stack. Order is intentional (description first so
// the extractor sees overall framing before bullet lists).
func combineDescription(d domain.VacancyDetails) string {
	var sb strings.Builder
	if s := strings.TrimSpace(d.DescriptionHTML); s != "" {
		sb.WriteString(s)
		sb.WriteByte('\n')
	} else if s := strings.TrimSpace(d.Description); s != "" {
		sb.WriteString(s)
		sb.WriteByte('\n')
	}
	for _, line := range d.Requirements {
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	for _, line := range d.Duties {
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	for _, line := range d.Conditions {
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	if s := strings.TrimSpace(d.OurTeam); s != "" {
		sb.WriteString(s)
		sb.WriteByte('\n')
	}
	for _, t := range d.TechStack {
		sb.WriteString(t)
		sb.WriteByte('\n')
	}
	return sb.String()
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
