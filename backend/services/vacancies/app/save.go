package app

import (
	"context"
	"fmt"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
)

// SaveVacancy is the POST /vacancies/{id}/save use case.
type SaveVacancy struct {
	Repo domain.SavedVacancyRepo
}

// Do creates the kanban entry in the default "saved" status.
func (s *SaveVacancy) Do(ctx context.Context, userID uuid.UUID, vacancyID int64, notes string) (domain.SavedVacancy, error) {
	row := domain.SavedVacancy{
		UserID:    userID,
		VacancyID: vacancyID,
		Status:    domain.StatusSaved,
		Notes:     notes,
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
	row := domain.SavedVacancy{ID: id, UserID: userID, Status: status, Notes: notes}
	if err := u.Repo.Update(ctx, &row); err != nil {
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.UpdateSavedStatus: %w", err)
	}
	return row, nil
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

// Do returns the user's kanban with eager-loaded vacancies.
func (l *ListSaved) Do(ctx context.Context, userID uuid.UUID) ([]domain.SavedWithVacancy, error) {
	out, err := l.Repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("vacancies.ListSaved: %w", err)
	}
	return out, nil
}
