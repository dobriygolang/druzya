package domain

import (
	"context"

	"github.com/google/uuid"
)

// UserSkillsResolver derives a user's demonstrable skill set from their
// real profile statistics — section_ratings (Elo + matches_count) plus
// atlas skill_nodes (Progress). The vacancies module owns the interface;
// the concrete implementation lives in infra and reads cross-bounded-
// context data via thin reader interfaces (see infra/user_skills_resolver.go).
//
// Phase 5 contract: Resolve returns an empty (Skills==nil) profile if the
// user has no qualifying signal — never an error in that case. Errors are
// reserved for genuine read failures (db down, etc.) which the analyze
// flow must surface, never silently mask.
type UserSkillsResolver interface {
	Resolve(ctx context.Context, userID uuid.UUID) (UserSkillsProfile, error)
}

// UserSkillsProfile is the resolver output. Skills are normalized vacancy-
// skill labels (lower-cased, deduped via NormalizeSkills); they are what
// gets fed into ComputeSkillGap as the user-side. Confidence + Sections
// are surfaced to the frontend so the user can see "we used these of
// yours" — pure transparency, no behavioural difference.
type UserSkillsProfile struct {
	Skills     []string       // normalized vacancy-skill labels
	Confidence map[string]int // skill → 0..100 confidence score derived from stats
	Sections   []string       // section codes the user demonstrated competence in
	Source     string         // "stats" today; "explicit" reserved for a future user-list override
}
