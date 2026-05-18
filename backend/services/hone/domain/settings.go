package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ActiveTrack — UI-фильтр Hone'а. Решает, какой контент (Plan / Tasks /
// Reading / AI-tutor thread) рендерится. `general` = legacy all-in-one.
// `go` — sub-mode dev'а для глубоких Go-сессий. ML атлас-узлы tag'нуты
// под dev_senior (ml-coach persona scoped to 'dev_senior'); 'ml' active
// track — UI-фильтр + persona handoff.
type ActiveTrack string

const (
	TrackGeneral ActiveTrack = "general"
	TrackDev     ActiveTrack = "dev"
	TrackML      ActiveTrack = "ml"
	TrackEnglish ActiveTrack = "english"
	TrackGo      ActiveTrack = "go"
)

func (t ActiveTrack) IsValid() bool {
	switch t {
	case TrackGeneral, TrackDev, TrackML, TrackEnglish, TrackGo:
		return true
	}
	return false
}

// UserSettings — per-user Hone preferences. Active study mode + orthogonal
// English-modifier (English — не track, а дополнение).
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
