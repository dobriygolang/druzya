// user_skills_resolver.go — derives a user's demonstrable skill set from
// real profile statistics. Implements domain.UserSkillsResolver.
//
// Cross-bounded-context note: the source data (section_ratings,
// skill_nodes, atlas_nodes) lives inside the profile module. To preserve
// module boundaries we don't import druz9/profile here — instead the
// resolver depends on the two narrow reader interfaces defined below
// (SectionRatingsReader, AtlasMasteryReader). The cmd/monolith wirer
// supplies adapters around profile's existing repo (see
// cmd/monolith/services/vacancies.go).
package infra

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
)

// SectionRating is the shape we need from the profile bounded context. We
// duplicate the fields here (rather than import profile.SectionRating) to
// keep the module dependency-free.
type SectionRating struct {
	Section      string
	Elo          int
	MatchesCount int
	LastMatchAt  *time.Time
}

// SkillNodeMastery is the per-(node, section) slice of skill_nodes JOINed
// with atlas_nodes that the resolver needs. The wirer is responsible for
// the SQL JOIN; the resolver only buckets + counts mastered nodes.
//
// "Mastered" = Progress >= AtlasMasteredThreshold (see below). The reader
// is free to filter at the SQL layer or to return all rows and let the
// resolver filter — both work; see the in-memory filter in Resolve.
type SkillNodeMastery struct {
	NodeKey  string
	Section  string
	Progress int
}

// SectionRatingsReader pulls the user's per-section Elo + matches_count.
type SectionRatingsReader interface {
	ListRatings(ctx context.Context, userID uuid.UUID) ([]SectionRating, error)
}

// AtlasMasteryReader pulls every (skill_node, atlas_node.section) row for
// the user. Implementations may filter to mastered-only at the SQL layer;
// the resolver applies AtlasMasteredThreshold defensively.
type AtlasMasteryReader interface {
	ListUserSkillNodesWithSection(ctx context.Context, userID uuid.UUID) ([]SkillNodeMastery, error)
}

// Tunable thresholds — chosen so a user who has fought ~10 real matches
// in a section AND is above the rookie Elo bracket counts as "knows it",
// OR who has explicitly mastered ≥5 atlas nodes in that section.
//
// The thresholds are intentionally loose: false negatives ("we said you
// don't know X but you do") are worse for UX than false positives ("we
// said you know X but you're rusty") — the analyze flow then shows a
// match-score that the user can sanity-check against the chip rows.
const (
	UserSkillsEloThreshold     = 1000
	UserSkillsMatchesThreshold = 10
	UserSkillsMasteredCount    = 5
	AtlasMasteredThreshold     = 100 // matches profile/app/atlas.go ("Mastered = Progress == 100")
)

// sectionToSkills maps a profile-side Section code onto the vacancy-side
// skill labels we expect to see in NormalizedSkills. Hand-rolled because
// the per-node mapping table would be ~200 entries for marginal gain over
// the section-level grouping; if section coverage feels coarse we can add
// per-cluster overrides without tearing this table out.
//
// Sections beyond the canonical enums.Section list ("data_structures",
// "concurrency") are tolerated — atlas_nodes.section is a free string
// column at the schema level (see atlas_catalogue.go) so a designer-
// added cluster can surface here without code changes. Behavioral has
// no entry: soft skills aren't surfaced as vacancy-skill chips today.
var sectionToSkills = map[string][]string{
	"algorithms":      {"algorithms", "data structures", "leetcode", "ds&a"},
	"data_structures": {"data structures", "algorithms"},
	"sql":             {"sql", "postgresql", "postgres", "mysql", "queries", "rdbms", "database"},
	"go":              {"go", "golang", "concurrency", "goroutines"},
	"system_design":   {"system design", "distributed systems", "microservices", "scalability", "high load"},
	"concurrency":     {"concurrency", "threading", "goroutines", "async"},
	"behavioral":      nil,
}

// UserSkillsResolver implements domain.UserSkillsResolver against the two
// reader interfaces above.
type UserSkillsResolver struct {
	Ratings SectionRatingsReader
	Atlas   AtlasMasteryReader
	Log     *slog.Logger
}

// NewUserSkillsResolver wires the resolver. Either reader may be nil — a
// nil reader contributes zero qualifying signal. This is the documented
// "explicit-list override" placeholder for future use; never silently
// fabricates skills.
func NewUserSkillsResolver(ratings SectionRatingsReader, atlas AtlasMasteryReader, log *slog.Logger) *UserSkillsResolver {
	return &UserSkillsResolver{Ratings: ratings, Atlas: atlas, Log: log}
}

// Resolve reads the user's section ratings + atlas mastery, qualifies the
// sections, and emits the union of vacancy-skill labels, deduped via
// domain.NormalizeSkills. Confidence per skill = average over the
// contributing sections of the per-section confidence formula:
//
//	min(100, elo/15 + matches_count*2 + mastered_count*5)
//
// Empty inputs produce an empty (Skills==nil) profile; never an error.
func (r *UserSkillsResolver) Resolve(ctx context.Context, userID uuid.UUID) (domain.UserSkillsProfile, error) {
	out := domain.UserSkillsProfile{Source: "stats"}

	var ratings []SectionRating
	if r.Ratings != nil {
		rs, err := r.Ratings.ListRatings(ctx, userID)
		if err != nil {
			return domain.UserSkillsProfile{}, fmt.Errorf("vacancies.UserSkillsResolver: ratings: %w", err)
		}
		ratings = rs
	}

	masteredBySection := map[string]int{}
	if r.Atlas != nil {
		nodes, err := r.Atlas.ListUserSkillNodesWithSection(ctx, userID)
		if err != nil {
			return domain.UserSkillsProfile{}, fmt.Errorf("vacancies.UserSkillsResolver: atlas: %w", err)
		}
		for _, n := range nodes {
			if n.Progress >= AtlasMasteredThreshold {
				masteredBySection[n.Section]++
			}
		}
	}

	ratingBySection := map[string]SectionRating{}
	for _, sr := range ratings {
		ratingBySection[sr.Section] = sr
	}

	// Sections seen in EITHER source are candidates; qualification rule:
	// (elo>=THRESHOLD AND matches>=THRESHOLD) OR mastered>=THRESHOLD.
	candidates := map[string]struct{}{}
	for s := range ratingBySection {
		candidates[s] = struct{}{}
	}
	for s := range masteredBySection {
		candidates[s] = struct{}{}
	}

	// skill → list of per-section confidence values (averaged at end).
	confSamples := map[string][]int{}
	qualifiedSections := []string{}

	for section := range candidates {
		sr := ratingBySection[section]
		mastered := masteredBySection[section]
		eloOk := sr.Elo >= UserSkillsEloThreshold && sr.MatchesCount >= UserSkillsMatchesThreshold
		atlasOk := mastered >= UserSkillsMasteredCount
		if !eloOk && !atlasOk {
			continue
		}
		qualifiedSections = append(qualifiedSections, section)

		// Per-section confidence: combines all three signals; clamped 0..100.
		conf := sr.Elo/15 + sr.MatchesCount*2 + mastered*5
		if conf < 0 {
			conf = 0
		}
		if conf > 100 {
			conf = 100
		}

		labels, ok := sectionToSkills[section]
		if !ok {
			// Section we don't have a mapping for — log so we notice and
			// extend the table, but don't fabricate skills.
			if r.Log != nil {
				r.Log.Warn("vacancies.UserSkillsResolver: unmapped section", slog.String("section", section))
			}
			continue
		}
		for _, label := range labels {
			confSamples[label] = append(confSamples[label], conf)
		}
	}

	if len(confSamples) == 0 {
		return out, nil
	}

	rawSkills := make([]string, 0, len(confSamples))
	for s := range confSamples {
		rawSkills = append(rawSkills, s)
	}
	out.Skills = domain.NormalizeSkills(rawSkills)

	// Build confidence map keyed by the post-normalization label so callers
	// can look up by what they see in Skills.
	out.Confidence = make(map[string]int, len(out.Skills))
	for _, s := range out.Skills {
		// NormalizeSkills collapses synonyms; sum confidence samples from
		// every raw label that maps to s after normalization.
		var sum, n int
		for raw, samples := range confSamples {
			if normalizeOne(raw) != s {
				continue
			}
			for _, v := range samples {
				sum += v
				n++
			}
		}
		if n > 0 {
			out.Confidence[s] = sum / n
		}
	}

	sort.Strings(qualifiedSections)
	out.Sections = qualifiedSections
	return out, nil
}

// normalizeOne mirrors the synonym collapse rules in domain.NormalizeSkills
// for a single raw label — used to bucket confidence samples back onto the
// post-normalization skill key. Kept local to avoid widening the domain
// API for a one-off internal need.
func normalizeOne(s string) string {
	out := domain.NormalizeSkills([]string{s})
	if len(out) == 0 {
		return ""
	}
	return out[0]
}
