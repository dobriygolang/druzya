// Package domain contains the daily kata / streak / calendar / autopsy entities,
// the kata-selection logic, and repository interfaces. No framework imports.
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
	Current       int
	Longest       int
	FreezeTokens  int
	LastKataDate  *time.Time
	History       []*bool // 30-day window; nil = freeze used
}

// InterviewCalendar mirrors interview_calendars + derived fields.
type InterviewCalendar struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	CompanyID     uuid.UUID
	Role          string
	InterviewDate time.Time
	CurrentLevel  string
	DaysLeft      int
	ReadinessPct  int
	UpdatedAt     time.Time
}

// Autopsy mirrors interview_autopsies.
type Autopsy struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	CompanyID     uuid.UUID
	Section       enums.Section
	Outcome       AutopsyOutcome
	InterviewDate *time.Time
	Questions     string
	Answers       string
	Notes         string
	Status        AutopsyStatus
	AnalysisJSON  []byte
	ShareSlug     string
	CreatedAt     time.Time
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
