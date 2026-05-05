package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ActiveTrack — UI-фильтр Hone'а. Решает, какой контент (Plan / Tasks /
// Reading / AI-tutor thread) рендерится. `general` = legacy all-in-one.
// `go` — sub-mode dev'а для глубоких Go-сессий.
//
// Phase 4.1 (2026-05-04): TrackML удалён. ML — специализация внутри
// dev_senior, не отдельный hardcoded трек. CHECK constraint в
// hone_user_settings (mig 00046) больше не принимает 'ml'; SetActiveTrack
// rejects его как invalid.
type ActiveTrack string

const (
	TrackGeneral ActiveTrack = "general"
	TrackDev     ActiveTrack = "dev"
	TrackEnglish ActiveTrack = "english"
	TrackGo      ActiveTrack = "go"
)

func (t ActiveTrack) IsValid() bool {
	switch t {
	case TrackGeneral, TrackDev, TrackEnglish, TrackGo:
		return true
	}
	return false
}

// UserSettings — per-user Hone preferences. Active study mode + orthogonal
// English-modifier (Sergey 2026-05-03: English — не track, а дополнение).
type UserSettings struct {
	UserID        uuid.UUID
	ActiveTrack   ActiveTrack
	EnglishActive bool
	UpdatedAt     time.Time
}

// SettingsRepo — persistence для hone_user_settings. Get никогда не возвращает
// ErrNotFound: для незарегистрированного юзера выдаётся zero-value (general).
type SettingsRepo interface {
	Get(ctx context.Context, userID uuid.UUID) (UserSettings, error)
	SetActiveTrack(ctx context.Context, userID uuid.UUID, track ActiveTrack, now time.Time) (UserSettings, error)
	SetEnglishActive(ctx context.Context, userID uuid.UUID, active bool, now time.Time) (UserSettings, error)
}
