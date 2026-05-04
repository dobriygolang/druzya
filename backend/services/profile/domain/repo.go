//go:generate mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
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

	// RecordXPEvent writes an audit-log row in xp_events. source — closed
	// set (CHECK constraint в schema_v2): task/arena/kata/podcast/mock/quiz/
	// review/custom. sourceID опционально — UUID match'а / task'а / kata'и
	// для downstream-аналитики. Пишется в OnXPGained handler синхронно
	// с ApplyXPDelta так что credit и audit всегда в паре.
	RecordXPEvent(ctx context.Context, userID uuid.UUID, amount int, source string, sourceID *uuid.UUID) error

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

	// Activity snapshots for the weekly report.
	CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (Activity, error)

	// GetStreaks возвращает текущую серию активности (дни) и личный рекорд.
	// Реализация может вернуть (0, 0), если не поддерживает streak-таблицу.
	GetStreaks(ctx context.Context, userID uuid.UUID) (current, best int, err error)

	// IssueShareToken создаёт строку в weekly_share_tokens с TTL 30 дней.
	IssueShareToken(ctx context.Context, userID uuid.UUID, weekISO string) (ShareToken, error)

	// ResolveShareToken находит активный токен; ErrNotFound если протух/нет.
	// Также инкрементирует views_count атомарно.
	ResolveShareToken(ctx context.Context, token string) (ShareResolution, error)

	// ── Multi-track (см docs/feature/tracks.md) ──────────────────────────
	// ListUserTracks возвращает все активные треки пользователя, primary
	// первым. Пустой срез — валидный ответ (например, юзер сбросил
	// onboarding и ещё не выбрал треки заново).
	ListUserTracks(ctx context.Context, userID uuid.UUID) ([]UserTrack, error)

	// SetUserTracks атомарно замещает список треков пользователя. Вызывающий
	// гарантирует ValidateTrackList(items) == nil. Реализация: delete +
	// bulk insert в одной транзакции; started_at сохраняется для треков,
	// которые остались, и проставляется now() для новых.
	SetUserTracks(ctx context.Context, userID uuid.UUID, items []UserTrack) ([]UserTrack, error)
}

// Bundle is the joined shape of GET /profile/me.
type Bundle struct {
	User         User
	Profile      Profile
	Subscription Subscription
}

// PublicBundle omits email/settings (exposed by /profile/{username}).
type PublicBundle struct {
	User    User
	Profile Profile
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
