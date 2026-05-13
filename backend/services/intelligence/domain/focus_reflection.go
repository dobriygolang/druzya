// Package domain — Focus reflection persistence.
//
// FocusReflection mirrors focus_reflections row. One write per
// pomodoro/countdown finish + paginated read for /stats grade-trend chart.
// Idempotent through (UserID, SessionID) UNIQUE constraint — Hone outbox
// can replay safely after offline gap.
//
// Coach memory side-effect: SaveFocusReflection UC also appends a
// coach_episodes row (kind=focus_reflection_added) so DailyBrief / Recall /
// next-action prompts surface the reflection alongside other signals.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// FocusReflection — one row in focus_reflections.
type FocusReflection struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	SessionID       string // client-generated, matches hone_focus_sessions.id
	FocusMode       string // pomodoro|stopwatch|free|plan|pinned|countdown
	DurationSeconds int
	// Grade — pointer so nil = "no rating submitted"; non-nil ∈ [1,5].
	Grade      *int
	Notes      string
	TaskPinned string
	StartedAt  time.Time
	EndedAt    time.Time
	CreatedAt  time.Time
}

// FocusReflectionRepo persists focus_reflections + reads recent window.
type FocusReflectionRepo interface {
	// Insert writes a row idempotently — repeat call with same
	// (UserID, SessionID) returns the existing row instead of erroring.
	Insert(ctx context.Context, in FocusReflection) (FocusReflection, error)
	// ListRecent returns reflections newest-first within window days.
	// limit hard-capped by adapter (default 200).
	ListRecent(ctx context.Context, userID uuid.UUID, windowDays int) ([]FocusReflection, error)
}
