// Package domain contains the daily kata / streak entities, the kata-selection
// logic, and repository interfaces. No framework imports.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Kata is the selected daily task.
type Kata struct {
	Date         time.Time
	Task         TaskPublic
	IsCursed     bool
	IsWeeklyBoss bool
	AlreadyDone  bool
}

// TaskPublic is a *client-safe* view of tasks row — solution_hint is NEVER
// included. The repo layer MUST drop that column when projecting to this shape.
type TaskPublic struct {
	ID            uuid.UUID
	Slug          string
	Title         string
	Description   string
	Difficulty    enums.Difficulty
	Section       enums.Section
	TimeLimitSec  int
	MemoryLimitMB int
	StarterCode   map[string]string // lang → snippet
}

// StreakInfo is GET /daily/streak shape.
type StreakInfo struct {
	Current      int
	Longest      int
	FreezeTokens int
	LastKataDate *time.Time
	History      []*bool // 30-day window; nil = freeze used
}

// KataSubmissionResult is what submit returns to the caller.
type KataSubmissionResult struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	XPEarned    int
	IsCursed    bool
	Streak      StreakInfo
}
