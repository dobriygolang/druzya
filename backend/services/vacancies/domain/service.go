package domain

import (
	"context"
	"sort"
	"strings"
)

// Parser is the source-specific fetch contract. Each parser owns its own HTTP
// client and politeness rules. Source() is the canonical key written to the
// vacancies.source column; Fetch() returns a fresh batch of postings for the
// hourly sync. RawJSON should be set on each returned Vacancy so the
// extractor can re-mine if the schema changes later.
type Parser interface {
	Source() Source
	Fetch(ctx context.Context) ([]Vacancy, error)
}

// SkillExtractor takes a free-form description and returns a normalized,
// lower-cased list of skill tags. Implementations are expected to cache by
// SHA256(description) — the LLM call is by far the most expensive step.
//
// modelOverride lets the caller pin a specific OpenRouter model id for
// this one call (e.g. the user's ai_vacancies_model pick from Settings).
// Empty string means "use implementation default" — this keeps the
// interface concurrency-safe without forcing callers to clone the
// extractor per-request.
type SkillExtractor interface {
	Extract(ctx context.Context, description, modelOverride string) (skills []string, err error)
}

// ComputeSkillGap diffs required vs user-known. All inputs are normalised to
// lower-case + deduped before comparison.
func ComputeSkillGap(required, userSkills []string) SkillGap {
	req := normSet(required)
	user := normSet(userSkills)
	out := SkillGap{
		Required: sortedKeys(req),
	}
	for s := range req {
		if _, ok := user[s]; ok {
			out.Matched = append(out.Matched, s)
		} else {
			out.Missing = append(out.Missing, s)
		}
	}
	for s := range user {
		if _, ok := req[s]; !ok {
			out.Extra = append(out.Extra, s)
		}
	}
	sort.Strings(out.Matched)
	sort.Strings(out.Missing)
	sort.Strings(out.Extra)
	if out.Matched == nil {
		out.Matched = []string{}
	}
	if out.Missing == nil {
		out.Missing = []string{}
	}
	if out.Extra == nil {
		out.Extra = []string{}
	}
	return out
}

func normSet(in []string) map[string]struct{} {
	out := make(map[string]struct{}, len(in))
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" {
			continue
		}
		out[s] = struct{}{}
	}
	return out
}

func sortedKeys(m map[string]struct{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// NormalizeSkills lowercases, trims, and dedupes a parser-emitted skill slice
// before persisting. Parsers commonly emit duplicates ("Go", "go", "Golang")
// — we collapse on the obvious cases to keep the GIN index lean. The LLM
// extractor handles the harder synonym work.
func NormalizeSkills(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" {
			continue
		}
		// Cheap synonym collapse — extend as we observe new aliases.
		switch s {
		case "golang":
			s = "go"
		case "postgres":
			s = "postgresql"
		case "k8s":
			s = "kubernetes"
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
