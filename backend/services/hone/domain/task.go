package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// TaskStatus — kanban column. The `dismissed` state is separate from
// `done` so the AI generator can tell "user explicitly skipped" from
// "user completed" when retrospecting on chronic skips.
type TaskStatus string

const (
	TaskStatusToDo       TaskStatus = "todo"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusInReview   TaskStatus = "in_review"
	TaskStatusDone       TaskStatus = "done"
	TaskStatusDismissed  TaskStatus = "dismissed"
)

// IsValid reports whether the value matches a known column.
func (s TaskStatus) IsValid() bool {
	switch s {
	case TaskStatusToDo, TaskStatusInProgress, TaskStatusInReview, TaskStatusDone, TaskStatusDismissed:
		return true
	}
	return false
}

// TaskKind — which validator the coach listener uses when transitioning
// `in_review → done`. Algorithms / sysdesign / quiz / reflection have
// real signals on the bus; reading is settled by `codex.ArticleRead`;
// custom is always user-driven (no AI review).
type TaskKind string

const (
	TaskKindAlgo       TaskKind = "algo"
	TaskKindSysDesign  TaskKind = "sysdesign"
	TaskKindQuiz       TaskKind = "quiz"
	TaskKindReflection TaskKind = "reflection"
	TaskKindReading    TaskKind = "reading"
	TaskKindCustom     TaskKind = "custom"
)

// IsValid reports whether the value matches a known kind.
func (k TaskKind) IsValid() bool {
	switch k {
	case TaskKindAlgo, TaskKindSysDesign, TaskKindQuiz, TaskKindReflection, TaskKindReading, TaskKindCustom:
		return true
	}
	return false
}

// TaskSource — `ai` for coach-generated, `user` for manually added.
type TaskSource string

const (
	TaskSourceAI   TaskSource = "ai"
	TaskSourceUser TaskSource = "user"
)

// Task is a single Notion-style kanban card.
type Task struct {
	ID                 uuid.UUID
	UserID             uuid.UUID
	Status             TaskStatus
	Kind               TaskKind
	Source             TaskSource
	Title              string
	BriefMD            string
	SkillKey           string // FK to atlas_nodes.id; empty for kind=custom
	DeepLink           string
	RecommendedReading []string
	Priority           int16
	DueAt              *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
	CompletedAt        *time.Time
	DismissedAt        *time.Time
}

// TaskCommentAuthor — `ai` (coach) or `user`.
type TaskCommentAuthor string

const (
	TaskCommentAuthorAI   TaskCommentAuthor = "ai"
	TaskCommentAuthorUser TaskCommentAuthor = "user"
)

// TaskComment — one row in the comments thread of a task.
type TaskComment struct {
	ID         uuid.UUID
	TaskID     uuid.UUID
	AuthorKind TaskCommentAuthor
	BodyMD     string
	CreatedAt  time.Time
}

// TaskRepo persists hone_tasks + hone_task_comments.
//
// Cap & TTL invariants are enforced in the use case layer (cap=7 in_todo
// per user, TTL=14d auto-dismiss); the repo just provides the read paths
// that make those checks cheap.
type TaskRepo interface {
	Create(ctx context.Context, t Task) (Task, error)
	Get(ctx context.Context, userID, taskID uuid.UUID) (Task, error)
	ListByUser(ctx context.Context, userID uuid.UUID, statuses []TaskStatus, limit int) ([]Task, error)
	// CountInTodo returns how many tasks the user currently holds in the
	// `todo` column. Used by the AI generator to enforce cap=7.
	CountInTodo(ctx context.Context, userID uuid.UUID) (int, error)
	// FindOpenBySkill returns an existing open (todo|in_progress|in_review)
	// task for the same skill_key, used to dedupe AI generation. Empty
	// skill_key returns no rows by definition.
	FindOpenBySkill(ctx context.Context, userID uuid.UUID, skillKey string) (Task, error)
	// SetStatus moves a task between columns and stamps completed_at /
	// dismissed_at when entering the corresponding terminal column.
	SetStatus(ctx context.Context, userID, taskID uuid.UUID, status TaskStatus) (Task, error)
	// AutoDismissOlderThan flips status='todo' rows older than cutoff to
	// 'dismissed' (TTL sweep). Returns affected count.
	AutoDismissOlderThan(ctx context.Context, cutoff time.Time) (int64, error)
	Delete(ctx context.Context, userID, taskID uuid.UUID) error

	// Comments
	AddComment(ctx context.Context, c TaskComment) (TaskComment, error)
	ListComments(ctx context.Context, taskID uuid.UUID) ([]TaskComment, error)
}
