package domain

import (
	"context"

	"github.com/google/uuid"
)

// VacancyRepo is the IO seam for the parsed-postings table. UpsertByExternal
// is the hot path used by the hourly sync; ListByFilter powers the public
// listing endpoint and is wrapped in a Redis cache.
type VacancyRepo interface {
	Insert(ctx context.Context, v *Vacancy) error
	GetByID(ctx context.Context, id int64) (Vacancy, error)
	ListByFilter(ctx context.Context, f ListFilter) (Page, error)
	// UpsertByExternal is idempotent on (Source, ExternalID). Returns the
	// resulting row id (existing or newly inserted) so the caller can chain
	// the skill-extraction job on the same record.
	UpsertByExternal(ctx context.Context, v *Vacancy) (int64, error)
	// UpdateNormalizedSkills is called by the extractor after the LLM call;
	// kept separate from UpsertByExternal so the parser sync doesn't block
	// on the skill-extraction queue.
	UpdateNormalizedSkills(ctx context.Context, id int64, skills []string) error
}

// SavedVacancyRepo holds the per-user kanban state.
type SavedVacancyRepo interface {
	Save(ctx context.Context, s *SavedVacancy) error
	Update(ctx context.Context, s *SavedVacancy) error
	ListByUser(ctx context.Context, userID uuid.UUID) ([]SavedWithVacancy, error)
	GetByID(ctx context.Context, userID uuid.UUID, id int64) (SavedVacancy, error)
	Delete(ctx context.Context, userID uuid.UUID, id int64) error
}
