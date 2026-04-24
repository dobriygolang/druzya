package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
)

// SaveVacancy is the POST /vacancies/{source}/{external_id}/save use case.
//
// Pulls the live vacancy from the cache, freezes it into the saved row's
// snapshot column, then upserts. The snapshot is what the kanban renders
// from then on — the live cache is never consulted by ListSaved.
type SaveVacancy struct {
	Repo  domain.SavedVacancyRepo
	Cache CacheReader
}

// Do creates or refreshes the kanban entry in the default "saved" status.
func (s *SaveVacancy) Do(ctx context.Context, userID uuid.UUID, source domain.Source, externalID, notes string) (domain.SavedVacancy, error) {
	v, err := s.Cache.Get(source, externalID)
	if err != nil {
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.SaveVacancy.cache: %w", err)
	}
	row := domain.SavedVacancy{
		UserID:     userID,
		Source:     source,
		ExternalID: externalID,
		Status:     domain.StatusSaved,
		Notes:      notes,
		Snapshot:   v,
	}
	if err := s.Repo.Save(ctx, &row); err != nil {
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.SaveVacancy: %w", err)
	}
	return row, nil
}

// UpdateSavedStatus is the PATCH /vacancies/saved/{id} use case.
type UpdateSavedStatus struct {
	Repo domain.SavedVacancyRepo
}

// Do mutates status and/or notes.
func (u *UpdateSavedStatus) Do(ctx context.Context, userID uuid.UUID, id int64, status domain.SavedStatus, notes string) (domain.SavedVacancy, error) {
	if !domain.IsValidStatus(status) {
		return domain.SavedVacancy{}, domain.ErrInvalidStatus
	}
	out, err := u.Repo.UpdateStatus(ctx, userID, id, status, notes)
	if err != nil {
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.UpdateSavedStatus: %w", err)
	}
	return out, nil
}

// RemoveSaved is the DELETE /vacancies/saved/{id} use case.
type RemoveSaved struct {
	Repo domain.SavedVacancyRepo
}

// Do drops the kanban row.
func (r *RemoveSaved) Do(ctx context.Context, userID uuid.UUID, id int64) error {
	if err := r.Repo.Delete(ctx, userID, id); err != nil {
		return fmt.Errorf("vacancies.RemoveSaved: %w", err)
	}
	return nil
}

// ListSaved is the GET /vacancies/saved use case.
type ListSaved struct {
	Repo domain.SavedVacancyRepo
}

// Do returns the user's kanban — pure SQL, no cache lookup. Snapshot is
// already embedded in each row.
func (l *ListSaved) Do(ctx context.Context, userID uuid.UUID) ([]domain.SavedVacancy, error) {
	out, err := l.Repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("vacancies.ListSaved: %w", err)
	}
	return out, nil
}

// GetSaved is the GET /vacancies/saved/{source}/{external_id} use case.
//
// Returns the saved row's frozen snapshot AND, if available, the current
// cache version side-by-side so the UI can show "обновить с источника"
// diff. If the cache no longer has the vacancy (parser dropped it), still
// return the snapshot — that's the whole point of freezing.
type GetSaved struct {
	Repo  domain.SavedVacancyRepo
	Cache CacheReader
}

// SavedDetail bundles the frozen + live views.
type SavedDetail struct {
	Saved domain.SavedVacancy
	Live  *domain.Vacancy // nil if the cache no longer has it
}

// Do reads the saved row + tries to attach the live cache view.
func (g *GetSaved) Do(ctx context.Context, userID uuid.UUID, source domain.Source, externalID string) (SavedDetail, error) {
	row, err := g.Repo.GetByKey(ctx, userID, source, externalID)
	if err != nil {
		return SavedDetail{}, fmt.Errorf("vacancies.GetSaved: %w", err)
	}
	out := SavedDetail{Saved: row}
	live, lerr := g.Cache.Get(source, externalID)
	if lerr == nil {
		out.Live = &live
	} else if !errors.Is(lerr, domain.ErrNotFound) {
		// Real cache failure should still serve the snapshot — but log it.
		// The snapshot is the source of truth for the kanban; live diff is
		// a nice-to-have.
		_ = lerr
	}
	return out, nil
}
