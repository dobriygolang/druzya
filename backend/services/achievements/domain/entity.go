package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound — sentinel для отсутствующих записей.
var ErrNotFound = errors.New("achievements: not found")

// ErrUnknownCode возвращается, когда строка по коду не существует в каталоге.
var ErrUnknownCode = errors.New("achievements: unknown code")

// Category — секция каталога. Используется фронтом для группировки.
type Category string

const (
	CategoryCombat      Category = "combat"
	CategoryConsistency Category = "consistency"
	CategorySocial      Category = "social"
	CategoryMastery     Category = "mastery"
	CategorySecret      Category = "secret"
)

// Tier — редкость ачивки. UI красит значки рамками по тиру.
type Tier string

const (
	TierCommon    Tier = "common"
	TierRare      Tier = "rare"
	TierLegendary Tier = "legendary"
)

// Achievement — описание из каталога. Статично собирается в catalogue.go.
type Achievement struct {
	Code        string
	Title       string
	Description string
	Category    Category
	Tier        Tier
	IconURL     string
	// RequirementsText — короткое HR-описание (RU). UI рендерит как list, но
	// содержимое решает контент-команда — поле остаётся свободной строкой.
	RequirementsText string
	// RewardText — что дают за разблок ("+500 XP", "title Speed Demon", …).
	RewardText string
	// Hidden — скрытая ачивка. Если не разблокирована, UI показывает «???».
	Hidden bool
	// Target — финальный счётчик прогресса. UpsertProgress сравнивает с ним.
	Target int
}

// UserAchievement — состояние одного пользователя по одной ачивке.
type UserAchievement struct {
	UserID     uuid.UUID
	Code       string
	Progress   int
	Target     int
	UnlockedAt *time.Time
	UpdatedAt  time.Time
}

// IsUnlocked — true если у строки есть unlocked_at.
func (u UserAchievement) IsUnlocked() bool { return u.UnlockedAt != nil }
