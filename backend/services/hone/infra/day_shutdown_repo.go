package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DayShutdownRepo — pgx adapter over day_shutdowns (migration 00120).
// One row per (user_id, shutdown_date) — UPSERT-only.
type DayShutdownRepo struct{ pool *pgxpool.Pool }

func NewDayShutdownRepo(pool *pgxpool.Pool) *DayShutdownRepo { return &DayShutdownRepo{pool: pool} }

func (r *DayShutdownRepo) Upsert(ctx context.Context, s domain.DayShutdown) (domain.DayShutdown, error) {
	// Дата normalize'нтся к 00:00 UTC use case'ом, но second guard здесь
	// дешёвый и страхует прямой call (test'ы / future caller'ы).
	day := s.ShutdownDate.UTC().Truncate(24 * time.Hour)
	const q = `
		INSERT INTO day_shutdowns (user_id, shutdown_date, done, pending, tomorrow, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)
		ON CONFLICT (user_id, shutdown_date) DO UPDATE
		    SET done       = EXCLUDED.done,
		        pending    = EXCLUDED.pending,
		        tomorrow   = EXCLUDED.tomorrow,
		        updated_at = EXCLUDED.updated_at
		RETURNING id, user_id, shutdown_date, done, pending, tomorrow, created_at, updated_at`
	now := s.UpdatedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	row := r.pool.QueryRow(ctx, q, s.UserID, day, s.Done, s.Pending, s.Tomorrow, now)
	var out domain.DayShutdown
	if err := row.Scan(
		&out.ID, &out.UserID, &out.ShutdownDate, &out.Done, &out.Pending, &out.Tomorrow,
		&out.CreatedAt, &out.UpdatedAt,
	); err != nil {
		return domain.DayShutdown{}, fmt.Errorf("hone.DayShutdownRepo.Upsert: %w", err)
	}
	return out, nil
}

func (r *DayShutdownRepo) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (domain.DayShutdown, error) {
	day := date.UTC().Truncate(24 * time.Hour)
	const q = `
		SELECT id, user_id, shutdown_date, done, pending, tomorrow, created_at, updated_at
		  FROM day_shutdowns
		 WHERE user_id = $1 AND shutdown_date = $2`
	var out domain.DayShutdown
	err := r.pool.QueryRow(ctx, q, userID, day).Scan(
		&out.ID, &out.UserID, &out.ShutdownDate, &out.Done, &out.Pending, &out.Tomorrow,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DayShutdown{}, domain.ErrNotFound
		}
		return domain.DayShutdown{}, fmt.Errorf("hone.DayShutdownRepo.GetForDate: %w", err)
	}
	return out, nil
}

func (r *DayShutdownRepo) GetMostRecent(ctx context.Context, userID uuid.UUID) (domain.DayShutdown, error) {
	const q = `
		SELECT id, user_id, shutdown_date, done, pending, tomorrow, created_at, updated_at
		  FROM day_shutdowns
		 WHERE user_id = $1
		 ORDER BY shutdown_date DESC
		 LIMIT 1`
	var out domain.DayShutdown
	err := r.pool.QueryRow(ctx, q, userID).Scan(
		&out.ID, &out.UserID, &out.ShutdownDate, &out.Done, &out.Pending, &out.Tomorrow,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.DayShutdown{}, domain.ErrNotFound
		}
		return domain.DayShutdown{}, fmt.Errorf("hone.DayShutdownRepo.GetMostRecent: %w", err)
	}
	return out, nil
}
