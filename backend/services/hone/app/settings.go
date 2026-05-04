package app

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// GetUserSettings возвращает настройки юзера. Для never-seen юзера —
// дефолт (general).
type GetUserSettings struct {
	Repo domain.SettingsRepo
}

func (uc *GetUserSettings) Do(ctx context.Context, userID uuid.UUID) (domain.UserSettings, error) {
	s, err := uc.Repo.Get(ctx, userID)
	if err != nil {
		return domain.UserSettings{}, fmt.Errorf("hone.GetUserSettings: %w", err)
	}
	if s.ActiveTrack == "" {
		s.ActiveTrack = domain.TrackGeneral
		s.UserID = userID
	}
	return s, nil
}

// SetActiveTrack валидирует и сохраняет выбранный track.
type SetActiveTrack struct {
	Repo domain.SettingsRepo
	Now  func() time.Time
}

func (uc *SetActiveTrack) Do(ctx context.Context, userID uuid.UUID, track domain.ActiveTrack) (domain.UserSettings, error) {
	if !track.IsValid() {
		return domain.UserSettings{}, fmt.Errorf("hone.SetActiveTrack: %w: track=%q", domain.ErrInvalidInput, track)
	}
	s, err := uc.Repo.SetActiveTrack(ctx, userID, track, uc.Now())
	if err != nil {
		return domain.UserSettings{}, fmt.Errorf("hone.SetActiveTrack: %w", err)
	}
	return s, nil
}

// SetEnglishActive — orthogonal toggle для English-loop'а в Hone. Если
// false — English surfaces (Reading / Writing / Listening pages, English
// pill, EnglishTabsChrome) скрыты.
type SetEnglishActive struct {
	Repo domain.SettingsRepo
	Now  func() time.Time
}

func (uc *SetEnglishActive) Do(ctx context.Context, userID uuid.UUID, active bool) (domain.UserSettings, error) {
	s, err := uc.Repo.SetEnglishActive(ctx, userID, active, uc.Now())
	if err != nil {
		return domain.UserSettings{}, fmt.Errorf("hone.SetEnglishActive: %w", err)
	}
	return s, nil
}
