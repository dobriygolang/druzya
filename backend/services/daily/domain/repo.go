//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("daily: not found")

// ErrAlreadySubmitted is returned by SubmitKata when the user already did
// today's kata. Idempotent from the client's perspective — handler renders as 200
// with already_submitted=true rather than 4xx.
var ErrAlreadySubmitted = errors.New("daily: already submitted")

// ErrSandboxUnavailable signals that no Judge0 sandbox or LLM evaluator is
// wired. Transports map this to HTTP 503 / Connect-RPC Unavailable. Anti-
// fallback policy: NEVER fabricate a passing test result.
var ErrSandboxUnavailable = errors.New("daily: sandbox unavailable")

// TaskRepo pulls tasks used for the kata selection.
type TaskRepo interface {
	// ListActiveBySectionDifficulty returns the set the selector will choose from.
	// MUST drop solution_hint from the returned rows.
	ListActiveBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) ([]TaskPublic, error)
	// GetByID is used when submit needs to look up the stored task.
	GetByID(ctx context.Context, id uuid.UUID) (TaskPublic, error)
	// GetBySlug powers GET /api/v1/daily/kata/:slug. Returns ErrNotFound for an
	// unknown slug — callers MUST NOT fall back to today's kata (anti-fake
	// policy: a stale or misspelled slug is a 404, not a silent redirect).
	GetBySlug(ctx context.Context, slug string) (TaskPublic, error)
}

// SkillRepo exposes per-user atlas progress — the kata picker reads this to
// find the weakest node.
type SkillRepo interface {
	WeakestNode(ctx context.Context, userID uuid.UUID) (NodeWeakness, error)
}

// NodeWeakness is the minimal shape returned by WeakestNode.
type NodeWeakness struct {
	Section    enums.Section
	Difficulty enums.Difficulty
	Progress   int
}

// KataRepo persists the per-user kata assignment and submission history.
type KataRepo interface {
	// GetOrAssign picks up today's assignment if present, otherwise inserts
	// a new row using the given TaskID. Returns (row, createdNow).
	GetOrAssign(ctx context.Context, userID uuid.UUID, date time.Time, taskID uuid.UUID, isCursed, isWeeklyBoss bool) (Assignment, bool, error)
	// MarkSubmitted records pass/fail + freeze use for today.
	MarkSubmitted(ctx context.Context, userID uuid.UUID, date time.Time, passed bool) error
	// HistoryLast30 returns the last 30 days in reverse chronological order.
	HistoryLast30(ctx context.Context, userID uuid.UUID, today time.Time) ([]HistoryEntry, error)
	// HistoryByYear returns every daily_kata_history row for the given UTC
	// calendar year, ordered by date ASC. Powers the year-grid on
	// /daily/streak (12 months × month-count cells).
	HistoryByYear(ctx context.Context, userID uuid.UUID, year int) ([]HistoryEntry, error)
}

// Assignment is the daily_kata_history row.
type Assignment struct {
	UserID       uuid.UUID
	KataDate     time.Time
	TaskID       uuid.UUID
	IsCursed     bool
	IsWeeklyBoss bool
	Passed       *bool
	FreezeUsed   bool
	SubmittedAt  *time.Time
}

// HistoryEntry is one row of StreakInfo.History.
type HistoryEntry struct {
	Date       time.Time
	TaskID     uuid.UUID
	Passed     *bool // nil = missed, true = completed, false = failed attempt
	FreezeUsed bool
}

// StreakRepo persists daily_streaks.
type StreakRepo interface {
	Get(ctx context.Context, userID uuid.UUID) (StreakState, error)
	Update(ctx context.Context, userID uuid.UUID, s StreakState) error
}

// StreakState is the mutable state of daily_streaks.
type StreakState struct {
	CurrentStreak int
	LongestStreak int
	FreezeTokens  int
	LastKataDate  *time.Time
}

// CalendarRepo persists interview_calendars.
type CalendarRepo interface {
	GetActive(ctx context.Context, userID uuid.UUID, today time.Time) (InterviewCalendar, error)
	Upsert(ctx context.Context, c InterviewCalendar) (InterviewCalendar, error)
}

// AutopsyRepo persists interview_autopsies.
type AutopsyRepo interface {
	Create(ctx context.Context, a Autopsy) (Autopsy, error)
	Get(ctx context.Context, id uuid.UUID) (Autopsy, error)
	MarkReady(ctx context.Context, id uuid.UUID, analysisJSON []byte) error
}

// Judge0Client verifies code submissions. A concrete adapter either:
//   - drives a real Judge0 container (POST /submissions?wait=true per test
//     case, stdout equality vs expected_output); or
//   - returns ErrSandboxUnavailable (NoSandboxJudge0) — anti-fallback policy
//     forbids any fake-pass in production.
//
// The passed TaskPublic carries the Task.ID, which the real adapter uses to
// load test cases from the repo. Callers MUST populate TaskPublic.ID before
// calling Submit — an empty id yields ErrSandboxUnavailable.
type Judge0Client interface {
	Submit(ctx context.Context, code, language string, task TaskPublic) (passed bool, total int, passedCount int, err error)
}

// TestCase is one hidden or visible grading row for a task. Order controls
// deterministic iteration so failure reports are reproducible. Mirrors the
// `test_cases` table from migration 00003.
type TestCase struct {
	Input    string
	Expected string
	IsHidden bool
	Order    int
}

// TestCaseRepo loads the grading set for a task. The real-sandbox adapter
// calls this once per Submit; the no-sandbox adapter never does.
type TestCaseRepo interface {
	ListForTask(ctx context.Context, taskID uuid.UUID) ([]TestCase, error)
}
