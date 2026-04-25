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

	// UpdateRole rewrites users.role. Used by BecomeInterviewer to promote
	// a regular user; idempotent (no-op when current role is already >= role).
	UpdateRole(ctx context.Context, userID uuid.UUID, role string) error

	// Interviewer-application moderation queue (M4a).
	SubmitInterviewerApplication(ctx context.Context, userID uuid.UUID, motivation string) (InterviewerApplication, error)
	GetMyInterviewerApplication(ctx context.Context, userID uuid.UUID) (InterviewerApplication, error)
	ListInterviewerApplications(ctx context.Context, status string) ([]InterviewerApplication, error)
	GetInterviewerApplication(ctx context.Context, applicationID uuid.UUID) (InterviewerApplication, error)
	ApproveInterviewerApplication(ctx context.Context, applicationID, adminID uuid.UUID, note string) (InterviewerApplication, error)
	RejectInterviewerApplication(ctx context.Context, applicationID, adminID uuid.UUID, note string) (InterviewerApplication, error)

	// Atlas.
	ListSkillNodes(ctx context.Context, userID uuid.UUID) ([]SkillNode, error)
	// UpsertSkillNode upserts a (user, node_key) row in skill_nodes with the
	// given progress (0..100). Sets unlocked_at = NOW() on first insert and
	// is idempotent on conflict (same node_key → progress is updated to MAX
	// of stored vs incoming so a reallocation never regresses progress).
	// Returns ErrNotFound if the node_key does not exist in atlas_nodes.
	UpsertSkillNode(ctx context.Context, userID uuid.UUID, nodeKey string, progress int) (SkillNode, error)

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

	// ── Phase A killer-stats ─────────────────────────────────────────────
	// ListHourlyActivitySince возвращает 168-элементный массив (dow*24+hour)
	// активности (count матчей) за окно [since, now]. Пустые ячейки = 0.
	ListHourlyActivitySince(ctx context.Context, userID uuid.UUID, since time.Time) ([168]int, error)

	// ListEloSnapshotsSince возвращает дневные snapshot-точки из
	// elo_snapshots_daily, отсортированные по дате ASC.
	ListEloSnapshotsSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]EloPoint, error)

	// GetPercentiles считает три перцентиля пользователя на дату weekEnd
	// (in_tier по elo-bucket'у, in_friends среди принятых дружб, in_global).
	GetPercentiles(ctx context.Context, userID uuid.UUID, weekEnd time.Time) (PercentileView, error)

	// IssueShareToken создаёт строку в weekly_share_tokens с TTL 30 дней.
	IssueShareToken(ctx context.Context, userID uuid.UUID, weekISO string) (ShareToken, error)

	// ResolveShareToken находит активный токен; ErrNotFound если протух/нет.
	// Также инкрементирует views_count атомарно.
	ResolveShareToken(ctx context.Context, token string) (ShareResolution, error)
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
