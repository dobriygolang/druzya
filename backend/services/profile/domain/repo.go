//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned when the requested record is absent.
var ErrNotFound = errors.New("profile: not found")

// ProfileRepo reads and writes the profiles + related snapshots.
type ProfileRepo interface {
	// GetByUserID joins users, profiles, subscriptions, ai_credits.
	GetByUserID(ctx context.Context, userID uuid.UUID) (Bundle, error)
	GetPublic(ctx context.Context, username string) (PublicBundle, error)

	// EnsureDefaults creates profiles/subscription/ai_credits/notification_prefs
	// rows for a brand-new user. Idempotent — called from UserRegistered handler.
	EnsureDefaults(ctx context.Context, userID uuid.UUID) error

	// ApplyXPDelta adjusts xp/level atomically (used by XPGained handler).
	ApplyXPDelta(ctx context.Context, userID uuid.UUID, addXP int, newLevel int, remainderXP int64) error

	// UpdateCareerStage writes back the derived seniority label.
	UpdateCareerStage(ctx context.Context, userID uuid.UUID, stage CareerStage) error

	// Settings operations.
	GetSettings(ctx context.Context, userID uuid.UUID) (Settings, error)
	UpdateSettings(ctx context.Context, userID uuid.UUID, s Settings) error

	// Atlas.
	ListSkillNodes(ctx context.Context, userID uuid.UUID) ([]SkillNode, error)

	// Ratings snapshot for score derivation.
	ListRatings(ctx context.Context, userID uuid.UUID) ([]SectionRating, error)

	// Activity snapshots for the weekly report.
	CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (Activity, error)

	// ListMatchAggregatesSince возвращает плоский список матчей пользователя
	// за последние `since…now` (только finished); используется в /report для
	// строй сильных/слабых секций. Если в БД нет таблицы с XP-дельтой на
	// матч, реализация вправе вернуть пустой список — отчёт деградирует
	// безопасно (фронт покажет «нет данных»).
	ListMatchAggregatesSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]MatchAggregate, error)

	// ListWeeklyXPSince возвращает массив XP за каждую из последних N
	// календарных недель (от last → past). Длина массива = N. weeks=4 →
	// `[этa, минус-1, минус-2, минус-3]`.
	ListWeeklyXPSince(ctx context.Context, userID uuid.UUID, now time.Time, weeks int) ([]int, error)

	// GetStreaks возвращает текущую серию активности (дни) и личный рекорд.
	// Реализация может вернуть (0, 0), если не поддерживает streak-таблицу.
	GetStreaks(ctx context.Context, userID uuid.UUID) (current, best int, err error)
}

// Bundle is the joined shape of GET /profile/me.
type Bundle struct {
	User         User
	Profile      Profile
	Subscription Subscription
	AICredits    int
	Ratings      []SectionRating
}

// PublicBundle omits email/settings (exposed by /profile/{username}).
type PublicBundle struct {
	User    User
	Profile Profile
	Ratings []SectionRating
	Atlas   []SkillNode
}

// Activity is a 7-day aggregate for the weekly report.
type Activity struct {
	TasksSolved  int
	MatchesWon   int
	RatingChange int
	XPEarned     int
	TimeMinutes  int
}
