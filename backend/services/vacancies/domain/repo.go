package domain

import (
	"context"

	"github.com/google/uuid"
)

// SavedVacancyRepo holds the per-user kanban state. The vacancy data itself
// is frozen into Snapshot at save time — the cache is the live read source,
// this repo never touches it.
type SavedVacancyRepo interface {
	// Save inserts or updates the row keyed on (user_id, source, external_id).
	// Snapshot is replaced on conflict so re-saving refreshes the frozen copy.
	Save(ctx context.Context, s *SavedVacancy) error
	// UpdateStatus mutates status + notes on an existing row, scoped by user.
	UpdateStatus(ctx context.Context, userID uuid.UUID, id int64, status SavedStatus, notes string) (SavedVacancy, error)
	// ListByUser returns every kanban row for the user, ordered by updated_at
	// desc.
	ListByUser(ctx context.Context, userID uuid.UUID) ([]SavedVacancy, error)
	// GetByKey reads one row by composite identity. Used by the detail
	// endpoint and the upsert path.
	GetByKey(ctx context.Context, userID uuid.UUID, source Source, externalID string) (SavedVacancy, error)
	// Delete removes the row by numeric id, scoped by user.
	Delete(ctx context.Context, userID uuid.UUID, id int64) error
}
