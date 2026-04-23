// Package domain содержит сущности профиля, логику прогрессии и интерфейсы
// репозиториев. Без импортов фреймворков.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// User отражает строку auth.users — хранится здесь, чтобы домен profile не
// импортировал модуль auth. Profile перечитывает нужное из собственного репо.
type User struct {
	ID          uuid.UUID
	Email       string
	Username    string
	Role        enums.UserRole
	Locale      string
	DisplayName string
	CreatedAt   time.Time
}

// Profile — строка прогрессии пользователя (таблица profiles).
type Profile struct {
	UserID      uuid.UUID
	CharClass   enums.CharClass
	Level       int
	XP          int64
	Title       string
	AvatarFrame string
	CareerStage CareerStage
	Attributes  Attributes
	UpdatedAt   time.Time
}

// Attributes — блок RPG-статов в стиле dark fantasy, выводимый из истории рейтинга.
type Attributes struct {
	Intellect int
	Strength  int
	Dexterity int
	Will      int
}

// Subscription — текущий тарифный план пользователя.
type Subscription struct {
	UserID           uuid.UUID
	Plan             enums.SubscriptionPlan
	Status           string
	CurrentPeriodEnd *time.Time
}

// SectionRating — строка ELO по одной секции.
type SectionRating struct {
	Section      enums.Section
	Elo          int
	MatchesCount int
	LastMatchAt  *time.Time
}

// SkillNode — строка прогресса пользователя в атласе навыков.
type SkillNode struct {
	NodeKey    string
	Progress   int
	UnlockedAt *time.Time
	DecayedAt  *time.Time
	UpdatedAt  time.Time
}

// NotificationPrefs отражает notification_preferences.
type NotificationPrefs struct {
	Channels                  []enums.NotificationChannel
	TelegramChatID            string
	QuietHoursFrom            *time.Time // используется только hh:mm
	QuietHoursTo              *time.Time
	WeeklyReportEnabled       bool
	SkillDecayWarningsEnabled bool
}

// Settings — полный набор настроек, возвращаемый PUT /profile/me/settings.
type Settings struct {
	DisplayName      string
	DefaultLanguage  enums.Language
	Locale           string // "ru" | "en"
	Notifications    NotificationPrefs
	VoiceModeEnabled bool
}

// EloPoint — дневной snapshot ELO в одной секции.
type EloPoint struct {
	Date    time.Time
	Elo     int
	Section enums.Section
}

// PercentileView — три перцентиля пользователя (0..100).
type PercentileView struct {
	InTier    int
	InFriends int
	InGlobal  int
}

// ShareToken — выпущенный токен публичной ссылки на отчёт.
type ShareToken struct {
	Token     string
	WeekISO   string
	ExpiresAt time.Time
}

// ShareResolution — результат разрешения токена /report/share/{token}.
type ShareResolution struct {
	UserID  uuid.UUID
	WeekISO string
}

// AchievementBrief — лёгкое представление ачивки для weekly-блока.
type AchievementBrief struct {
	Code       string
	Title      string
	UnlockedAt time.Time
	Tier       string
}
