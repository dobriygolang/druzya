// Package infra hosts the persistent saved-vacancies repo, the OpenRouter
// skill extractor and the cache subpackage.
//
// Phase 3: the parsed-postings table is gone — the live cache lives in
// infra/cache. The only remaining persistent storage is per-user kanban
// state in saved_vacancies, keyed by (user_id, source, external_id) with a
// JSONB snapshot of the vacancy frozen at save time.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgSavedRepo implements domain.SavedVacancyRepo against Postgres.
type PgSavedRepo struct {
	pool *pgxpool.Pool
}

// NewPgSavedRepo wraps a pool.
func NewPgSavedRepo(pool *pgxpool.Pool) *PgSavedRepo {
	return &PgSavedRepo{pool: pool}
}

// Save upserts on (user_id, source, external_id). Snapshot JSON is replaced
// on conflict so re-saving refreshes the frozen copy with the current cache
// view.
func (r *PgSavedRepo) Save(ctx context.Context, s *domain.SavedVacancy) error {
	if !domain.IsValidStatus(s.Status) {
		s.Status = domain.StatusSaved
	}
	snap, err := json.Marshal(s.Snapshot)
	if err != nil {
		return fmt.Errorf("vacancies.PgSaved.Save.marshal: %w", err)
	}
	const q = `
INSERT INTO saved_vacancies(user_id, source, external_id, status, notes, snapshot_json)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (user_id, source, external_id) DO UPDATE SET
  status        = EXCLUDED.status,
  notes         = EXCLUDED.notes,
  snapshot_json = EXCLUDED.snapshot_json,
  updated_at    = now()
RETURNING id, saved_at, updated_at`
	row := r.pool.QueryRow(ctx, q,
		s.UserID, string(s.Source), s.ExternalID, string(s.Status),
		nullString(s.Notes), snap,
	)
	var savedAt, updatedAt time.Time
	if err := row.Scan(&s.ID, &savedAt, &updatedAt); err != nil {
		return fmt.Errorf("vacancies.PgSaved.Save: %w", err)
	}
	s.SavedAt = savedAt
	s.UpdatedAt = updatedAt
	return nil
}

// UpdateStatus mutates status + notes by numeric id, scoped to user.
// Returns the row in its post-update form.
func (r *PgSavedRepo) UpdateStatus(ctx context.Context, userID uuid.UUID, id int64, status domain.SavedStatus, notes string) (domain.SavedVacancy, error) {
	if !domain.IsValidStatus(status) {
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.UpdateStatus: %w", domain.ErrInvalidStatus)
	}
	const q = `
UPDATE saved_vacancies
   SET status = $3, notes = $4, updated_at = now()
 WHERE id = $1 AND user_id = $2
RETURNING source, external_id, snapshot_json, saved_at, updated_at`
	row := r.pool.QueryRow(ctx, q, id, userID, string(status), nullString(notes))
	var (
		src       string
		extID     string
		snap      []byte
		savedAt   time.Time
		updatedAt time.Time
	)
	if err := row.Scan(&src, &extID, &snap, &savedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.UpdateStatus: %w", domain.ErrNotFound)
		}
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.UpdateStatus: %w", err)
	}
	out := domain.SavedVacancy{
		ID:         id,
		UserID:     userID,
		Source:     domain.Source(src),
		ExternalID: extID,
		Status:     status,
		Notes:      notes,
		SavedAt:    savedAt,
		UpdatedAt:  updatedAt,
	}
	if len(snap) > 0 {
		if err := json.Unmarshal(snap, &out.Snapshot); err != nil {
			return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.UpdateStatus.snapshot: %w", err)
		}
	}
	return out, nil
}

// GetByKey reads one row by composite identity.
func (r *PgSavedRepo) GetByKey(ctx context.Context, userID uuid.UUID, source domain.Source, externalID string) (domain.SavedVacancy, error) {
	const q = `
SELECT id, status, notes, snapshot_json, saved_at, updated_at
  FROM saved_vacancies
 WHERE user_id = $1 AND source = $2 AND external_id = $3`
	row := r.pool.QueryRow(ctx, q, userID, string(source), externalID)
	var (
		id        int64
		status    string
		notes     pgtype.Text
		snap      []byte
		savedAt   time.Time
		updatedAt time.Time
	)
	if err := row.Scan(&id, &status, &notes, &snap, &savedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.GetByKey: %w", domain.ErrNotFound)
		}
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.GetByKey: %w", err)
	}
	out := domain.SavedVacancy{
		ID:         id,
		UserID:     userID,
		Source:     source,
		ExternalID: externalID,
		Status:     domain.SavedStatus(status),
		Notes:      notes.String,
		SavedAt:    savedAt,
		UpdatedAt:  updatedAt,
	}
	if len(snap) > 0 {
		if err := json.Unmarshal(snap, &out.Snapshot); err != nil {
			return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.GetByKey.snapshot: %w", err)
		}
	}
	return out, nil
}

// Delete removes the row by numeric id, scoped by user.
func (r *PgSavedRepo) Delete(ctx context.Context, userID uuid.UUID, id int64) error {
	const q = `DELETE FROM saved_vacancies WHERE id = $1 AND user_id = $2`
	tag, err := r.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return fmt.Errorf("vacancies.PgSaved.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("vacancies.PgSaved.Delete: %w", domain.ErrNotFound)
	}
	return nil
}

// ListByUser returns every kanban row for the user with their snapshot
// already decoded. No JOIN — snapshot is self-contained.
func (r *PgSavedRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.SavedVacancy, error) {
	const q = `
SELECT id, source, external_id, status, notes, snapshot_json, saved_at, updated_at
  FROM saved_vacancies
 WHERE user_id = $1
 ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("vacancies.PgSaved.ListByUser: %w", err)
	}
	defer rows.Close()
	out := []domain.SavedVacancy{}
	for rows.Next() {
		var (
			id        int64
			src       string
			extID     string
			status    string
			notes     pgtype.Text
			snap      []byte
			savedAt   time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &src, &extID, &status, &notes, &snap, &savedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("vacancies.PgSaved.ListByUser.scan: %w", err)
		}
		row := domain.SavedVacancy{
			ID:         id,
			UserID:     userID,
			Source:     domain.Source(src),
			ExternalID: extID,
			Status:     domain.SavedStatus(status),
			Notes:      notes.String,
			SavedAt:    savedAt,
			UpdatedAt:  updatedAt,
		}
		if len(snap) > 0 {
			if err := json.Unmarshal(snap, &row.Snapshot); err != nil {
				return nil, fmt.Errorf("vacancies.PgSaved.ListByUser.snapshot: %w", err)
			}
		}
		out = append(out, row)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("vacancies.PgSaved.ListByUser.rows: %w", rerr)
	}
	return out, nil
}

// nullString is the cheap "" → SQL NULL helper shared by saved + extractor.
func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Compile-time check.
var _ domain.SavedVacancyRepo = (*PgSavedRepo)(nil)
