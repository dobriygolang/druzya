package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SettingsRepo — pgx-backed реализация domain.SettingsRepo поверх
// hone_user_settings (миграции 00035 + 00042).
type SettingsRepo struct{ pool *pgxpool.Pool }

func NewSettingsRepo(pool *pgxpool.Pool) *SettingsRepo { return &SettingsRepo{pool: pool} }

func (r *SettingsRepo) Get(ctx context.Context, userID uuid.UUID) (domain.UserSettings, error) {
	const q = `SELECT user_id, active_track, english_active, updated_at FROM hone_user_settings WHERE user_id = $1`
	var s domain.UserSettings
	var track string
	err := r.pool.QueryRow(ctx, q, userID).Scan(&s.UserID, &track, &s.EnglishActive, &s.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return domain.UserSettings{UserID: userID, ActiveTrack: domain.TrackGeneral}, nil
		}
		return domain.UserSettings{}, fmt.Errorf("hone.SettingsRepo.Get: %w", err)
	}
	s.ActiveTrack = domain.ActiveTrack(track)
	return s, nil
}

func (r *SettingsRepo) SetActiveTrack(ctx context.Context, userID uuid.UUID, track domain.ActiveTrack, now time.Time) (domain.UserSettings, error) {
	const q = `
		INSERT INTO hone_user_settings (user_id, active_track, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		    SET active_track = EXCLUDED.active_track,
		        updated_at   = EXCLUDED.updated_at
		RETURNING user_id, active_track, english_active, updated_at`
	var s domain.UserSettings
	var trackStr string
	err := r.pool.QueryRow(ctx, q, userID, string(track), now.UTC()).
		Scan(&s.UserID, &trackStr, &s.EnglishActive, &s.UpdatedAt)
	if err != nil {
		return domain.UserSettings{}, fmt.Errorf("hone.SettingsRepo.SetActiveTrack: %w", err)
	}
	s.ActiveTrack = domain.ActiveTrack(trackStr)
	return s, nil
}

func (r *SettingsRepo) SetEnglishActive(ctx context.Context, userID uuid.UUID, active bool, now time.Time) (domain.UserSettings, error) {
	const q = `
		INSERT INTO hone_user_settings (user_id, active_track, english_active, updated_at)
		VALUES ($1, 'general', $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		    SET english_active = EXCLUDED.english_active,
		        updated_at     = EXCLUDED.updated_at
		RETURNING user_id, active_track, english_active, updated_at`
	var s domain.UserSettings
	var trackStr string
	err := r.pool.QueryRow(ctx, q, userID, active, now.UTC()).
		Scan(&s.UserID, &trackStr, &s.EnglishActive, &s.UpdatedAt)
	if err != nil {
		return domain.UserSettings{}, fmt.Errorf("hone.SettingsRepo.SetEnglishActive: %w", err)
	}
	s.ActiveTrack = domain.ActiveTrack(trackStr)
	return s, nil
}
