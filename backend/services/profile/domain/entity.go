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
	// TutorModeEnabled mirrors users.tutor_mode_enabled (migration 00093).
	// Self-toggle flag — independent from Role. When true the web AppShell
	// surfaces tutor nav items + /tutor sub-surfaces. Free per identity.md.
	TutorModeEnabled bool
}

// Profile — строка прогрессии пользователя (таблица profiles).
type Profile struct {
	UserID    uuid.UUID
	CharClass enums.CharClass
	Level     int
	XP        int64
	UpdatedAt time.Time
}

// Subscription — текущий тарифный план пользователя.
type Subscription struct {
	UserID           uuid.UUID
	Plan             enums.SubscriptionPlan
	Status           string
	CurrentPeriodEnd *time.Time
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
	Locale           string // "ru" | "en" | "kz" | "ua"
	Notifications    NotificationPrefs
	VoiceModeEnabled bool
	// AIInsightModel — пользовательский выбор LLM-модели для AI Coach
	// insight. Валидные значения берутся из GET /api/v1/ai/models — например
	// "openai/gpt-4o-mini", "anthropic/claude-sonnet-4". Пустая строка =
	// "use server default" (free tier-aware fallback в openrouter_insight.go).
	// Premium-модели для free-юзеров silently fallback на default — UI на
	// /settings помечает их 💎 + locked, чтобы пользователь видел причину.
	AIInsightModel string

	// OnboardingCompleted is the read-time boolean derived from
	// users.onboarding_completed_at IS NOT NULL (migration 00035).
	// Write semantics: true ⇒ stamp NOW(); false ⇒ clear column.
	OnboardingCompleted bool

	// FocusClass — declared career focus, one of:
	//   "" | "algo" | "backend" | "system" | "concurrency" | "ds".
	// Validated by UpdateSettings against AllowedFocusClasses.
	FocusClass string

	// TutorModeEnabled — write-side counterpart to User.TutorModeEnabled.
	// HasTutorModeEnabled gates the column update so partial PUTs leave it
	// alone.
	TutorModeEnabled bool

	// FieldMask flags — true when the caller explicitly provided the value
	// in the inbound proto so the persistence layer can skip clobbering
	// columns that were not part of the partial update. Set by
	// fromSettingsProto only for the new sparse-update fields; legacy
	// fields keep their previous "send empty = no-op" semantics.
	HasOnboardingCompleted bool
	HasFocusClass          bool
	HasTutorModeEnabled    bool
}

// AllowedFocusClasses is the canonical set enforced by both the DB CHECK
// (migration 00035) and the UpdateSettings use case. Empty string is a
// real value — "user has not yet picked a focus class".
var AllowedFocusClasses = map[string]struct{}{
	"":            {},
	"algo":        {},
	"backend":     {},
	"system":      {},
	"concurrency": {},
	"ds":          {},
}

// InterviewerApplication mirrors a row in `interviewer_applications`.
// Status is one of ApplicationStatus*. `UserUsername`/`UserDisplayName`
// are hydrated by ListInterviewerApplications for the admin queue;
// single-row reads leave them empty.
type InterviewerApplication struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	Motivation      string
	Status          string
	ReviewedBy      *uuid.UUID
	ReviewedAt      *time.Time
	DecisionNote    string
	CreatedAt       time.Time
	UserUsername    string
	UserDisplayName string
}

const (
	ApplicationStatusPending  = "pending"
	ApplicationStatusApproved = "approved"
	ApplicationStatusRejected = "rejected"
)

// AppSurface — wire-closed identifier of the surface a heartbeat came from.
// Mirrors proto enum AppSurface; string-typed inside the domain so the SQL
// layer can use it directly as a TEXT column value without an extra enum
// table.
type AppSurface string

const (
	AppSurfaceWeb  AppSurface = "web"
	AppSurfaceHone AppSurface = "hone"
	AppSurfaceCue  AppSurface = "cue"
)

// IsValid — sanity check before write. Server rejects unknown values with
// InvalidArgument before they ever hit the DB CHECK.
func (a AppSurface) IsValid() bool {
	switch a {
	case AppSurfaceWeb, AppSurfaceHone, AppSurfaceCue:
		return true
	}
	return false
}

// AppInstall mirrors a row in user_app_installs. AppVersion is
// informational — Hone / Cue / web all push their semver
// on every heartbeat; web typically stays empty (no versioning hook).
type AppInstall struct {
	App         AppSurface
	FirstSeenAt time.Time
	LastSeenAt  time.Time
	AppVersion  string
}
