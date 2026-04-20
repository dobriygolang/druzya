//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// MatchRepo persists arena_matches and arena_participants.
type MatchRepo interface {
	// CreateMatch inserts a match plus the initial participant rows (status=confirming).
	CreateMatch(ctx context.Context, m Match, parts []Participant) (Match, error)

	// Get loads the match by ID.
	Get(ctx context.Context, id uuid.UUID) (Match, error)

	// ListParticipants returns participants for a match ordered by team.
	ListParticipants(ctx context.Context, matchID uuid.UUID) ([]Participant, error)

	// UpdateStatus transitions the match status and optionally stamps started_at/finished_at.
	UpdateStatus(ctx context.Context, id uuid.UUID, status enums.MatchStatus, startedAt, finishedAt *time.Time) error

	// SetWinner records the winner user id and finished_at.
	SetWinner(ctx context.Context, id uuid.UUID, winner uuid.UUID, finishedAt time.Time) error

	// SetTask stamps the selected task onto the match (after matchmaking).
	SetTask(ctx context.Context, id uuid.UUID, taskID uuid.UUID, taskVersion int) error

	// UpsertParticipantResult records solve_time_ms + suspicion_score and submitted_at.
	UpsertParticipantResult(ctx context.Context, p Participant) error
}

// TaskRepo exposes the minimal task lookup arena needs — a section/difficulty
// filter and a by-id fetch. STUB: for MVP we return a single random active task.
type TaskRepo interface {
	PickBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) (TaskPublic, error)
	GetByID(ctx context.Context, id uuid.UUID) (TaskPublic, error)
}

// TaskPublic is the client-safe task view — solution_hint is NEVER populated.
type TaskPublic struct {
	ID            uuid.UUID
	Version       int
	Slug          string
	Title         string
	Description   string
	Difficulty    enums.Difficulty
	Section       enums.Section
	TimeLimitSec  int
	MemoryLimitMB int
	StarterCode   map[string]string
}

// QueueRepo is the Redis-backed matchmaking queue abstraction.
type QueueRepo interface {
	// Enqueue adds a ticket to the section+mode queue keyed by ELO.
	// Returns ErrAlreadyInQueue if the user already has an entry.
	Enqueue(ctx context.Context, t QueueTicket) error

	// Remove deletes a user's queue entry across all keys the implementation
	// tracks (no-op if not present).
	Remove(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) error

	// Snapshot returns all tickets currently waiting for a (section, mode) pair
	// ordered by ELO ASC so the matchmaker can sweep neighbouring pairs.
	Snapshot(ctx context.Context, section enums.Section, mode enums.ArenaMode) ([]QueueTicket, error)

	// AcquireLock attempts to SETNX a short-lived lock on a user id; returns
	// ok=true when the lock was acquired. Used to avoid double-matching a user
	// across concurrent dispatcher ticks.
	AcquireLock(ctx context.Context, userID uuid.UUID, ttl time.Duration) (bool, error)

	// ReleaseLock removes the lock key.
	ReleaseLock(ctx context.Context, userID uuid.UUID) error

	// Position returns the 1-based position of the user in the queue (by ELO
	// tie-broken by enqueued_at). Zero means absent.
	Position(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) (int, error)
}

// ReadyCheckRepo tracks per-match ready-check state.
type ReadyCheckRepo interface {
	// Start records a new 10-second window for a match.
	Start(ctx context.Context, matchID uuid.UUID, userIDs []uuid.UUID, deadline time.Time) error

	// Confirm marks a single user as confirmed. Returns everyoneConfirmed=true
	// the moment the last outstanding user confirms.
	Confirm(ctx context.Context, matchID, userID uuid.UUID) (everyone bool, err error)

	// Get returns the current state (missing = not started).
	Get(ctx context.Context, matchID uuid.UUID) (ReadyCheckState, bool, error)

	// Clear wipes the ready-check entry after transition.
	Clear(ctx context.Context, matchID uuid.UUID) error
}

// ReadyCheckState is what ReadyCheckRepo.Get returns.
type ReadyCheckState struct {
	MatchID   uuid.UUID
	UserIDs   []uuid.UUID
	Confirmed map[uuid.UUID]bool
	Deadline  time.Time
}

// AnticheatRepo tracks suspicion scores per participant + per-match counters.
type AnticheatRepo interface {
	// AddSuspicion bumps the participant's score by delta and returns the new total.
	AddSuspicion(ctx context.Context, matchID, userID uuid.UUID, delta float64) (float64, error)

	// GetSuspicion returns the current score.
	GetSuspicion(ctx context.Context, matchID, userID uuid.UUID) (float64, error)

	// IncrTabSwitch bumps the tab-switch counter and returns the new value.
	IncrTabSwitch(ctx context.Context, matchID, userID uuid.UUID) (int, error)
}

// Judge0Client submits code for grading. STUB impl in infra/judge0.go always passes.
//
// STUB: real Judge0 client. Lives in its own package once wired.
type Judge0Client interface {
	Submit(ctx context.Context, code, language string, task TaskPublic) (Judge0Result, error)
}

// Judge0Result is the minimal outcome shape arena cares about.
type Judge0Result struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}
