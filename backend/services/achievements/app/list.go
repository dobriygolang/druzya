package app

import (
	"context"
	"fmt"
	"time"

	"druz9/achievements/domain"

	"github.com/google/uuid"
)

// ListItem — DTO ответа /achievements: каталог + per-user state, склеены.
type ListItem struct {
	Code             string
	Title            string
	Description      string
	Category         domain.Category
	Tier             domain.Tier
	IconURL          string
	RequirementsText string
	RewardText       string
	Hidden           bool
	UnlockedAt       *time.Time
	Progress         int
	Target           int
}

// IsUnlocked — true если у user'а есть запись и unlocked_at != nil.
func (i ListItem) IsUnlocked() bool { return i.UnlockedAt != nil }

// ListAchievements собирает merge каталога и per-user состояния.
type ListAchievements struct {
	Repo domain.UserAchievementRepo
}

// Do возвращает merged-список (всегда non-nil).
func (uc *ListAchievements) Do(ctx context.Context, userID uuid.UUID) ([]ListItem, error) {
	if uc == nil || uc.Repo == nil {
		return nil, fmt.Errorf("achievements.ListAchievements: nil Repo")
	}
	rows, err := uc.Repo.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("achievements.ListAchievements: %w", err)
	}
	byCode := make(map[string]domain.UserAchievement, len(rows))
	for _, r := range rows {
		byCode[r.Code] = r
	}
	cat := domain.Catalogue()
	out := make([]ListItem, 0, len(cat))
	for _, a := range cat {
		item := ListItem{
			Code:             a.Code,
			Title:            a.Title,
			Description:      a.Description,
			Category:         a.Category,
			Tier:             a.Tier,
			IconURL:          a.IconURL,
			RequirementsText: a.RequirementsText,
			RewardText:       a.RewardText,
			Hidden:           a.Hidden,
			Target:           a.Target,
		}
		if r, ok := byCode[a.Code]; ok {
			item.Progress = r.Progress
			if r.Target > 0 {
				item.Target = r.Target
			}
			item.UnlockedAt = r.UnlockedAt
		}
		out = append(out, item)
	}
	return out, nil
}

// GetSingle отдаёт один merged-элемент или (nil, ErrUnknownCode).
type GetSingle struct {
	Repo domain.UserAchievementRepo
}

// Do возвращает merged item.
func (uc *GetSingle) Do(ctx context.Context, userID uuid.UUID, code string) (ListItem, error) {
	a, err := domain.ByCode(code)
	if err != nil {
		return ListItem{}, fmt.Errorf("achievements.GetSingle.ByCode: %w", err)
	}
	row, err := uc.Repo.Get(ctx, userID, code)
	item := ListItem{
		Code:             a.Code,
		Title:            a.Title,
		Description:      a.Description,
		Category:         a.Category,
		Tier:             a.Tier,
		IconURL:          a.IconURL,
		RequirementsText: a.RequirementsText,
		RewardText:       a.RewardText,
		Hidden:           a.Hidden,
		Target:           a.Target,
	}
	if err == nil {
		item.Progress = row.Progress
		if row.Target > 0 {
			item.Target = row.Target
		}
		item.UnlockedAt = row.UnlockedAt
	}
	return item, nil
}
