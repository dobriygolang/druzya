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

	// Settings operations.
	GetSettings(ctx context.Context, userID uuid.UUID) (Settings, error)
	UpdateSettings(ctx context.Context, userID uuid.UUID, s Settings) error

	// Stream D (2026-05-12) — auxiliary read/write for the
	// users.tutor_mode_enabled flag (migration 00093). Kept out of
	// GetSettings/UpdateSettings so the UC layer can decide whether to
	// invoke them (PUT may omit the field; Bundle reads always include).
	GetTutorModeEnabled(ctx context.Context, userID uuid.UUID) (bool, error)
	SetTutorModeEnabled(ctx context.Context, userID uuid.UUID, enabled bool) error

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

	// ── Install tracking ─────────────────────────────────────────────────
	// UpsertAppInstall idempotently records a heartbeat from one surface
	// (web / hone / cue). `inserted` is true ONLY when this call created
	// a fresh row — used by the trial-Pro grant gate. installCountBefore
	// is the number of rows for this user that existed BEFORE the upsert,
	// also for the trial gate.
	UpsertAppInstall(
		ctx context.Context,
		userID uuid.UUID,
		app AppSurface,
		appVersion string,
	) (install AppInstall, inserted bool, installCountBefore int64, err error)

	// ListAppInstalls returns all install rows for a user, oldest-first.
	ListAppInstalls(ctx context.Context, userID uuid.UUID) ([]AppInstall, error)
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
