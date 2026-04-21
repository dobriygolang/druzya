// Package domain contains profile entities, progression logic, and repo
// interfaces. No framework imports.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// User mirrors the auth users row — kept here so the profile domain does not
// import the auth module. Profile re-reads what it needs from its own repo.
type User struct {
	ID          uuid.UUID
	Email       string
	Username    string
	Role        enums.UserRole
	Locale      string
	DisplayName string
	CreatedAt   time.Time
}

// Profile is the per-user progression row (profiles table).
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

// Attributes is the Dark-Fantasy RPG stat block derived from rating history.
type Attributes struct {
	Intellect int
	Strength  int
	Dexterity int
	Will      int
}

// Subscription is the current billing plan for a user.
type Subscription struct {
	UserID           uuid.UUID
	Plan             enums.SubscriptionPlan
	Status           string
	CurrentPeriodEnd *time.Time
}

// SectionRating is a per-section ELO row.
type SectionRating struct {
	Section      enums.Section
	Elo          int
	MatchesCount int
	LastMatchAt  *time.Time
}

// SkillNode is a per-user progress row in the skill atlas.
type SkillNode struct {
	NodeKey    string
	Progress   int
	UnlockedAt *time.Time
	DecayedAt  *time.Time
	UpdatedAt  time.Time
}

// NotificationPrefs mirrors notification_preferences.
type NotificationPrefs struct {
	Channels                  []enums.NotificationChannel
	TelegramChatID            string
	QuietHoursFrom            *time.Time // only hh:mm is used
	QuietHoursTo              *time.Time
	WeeklyReportEnabled       bool
	SkillDecayWarningsEnabled bool
}

// Settings is the full settings bundle exposed by PUT /profile/me/settings.
type Settings struct {
	DisplayName      string
	DefaultLanguage  enums.Language
	Locale           string // "ru" | "en"
	Notifications    NotificationPrefs
	VoiceModeEnabled bool
}
