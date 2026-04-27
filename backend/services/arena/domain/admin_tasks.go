package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrAdminTaskInvalid is returned when an admin upsert payload fails
// section/difficulty validation. Callers map this to HTTP 400.
var ErrAdminTaskInvalid = errors.New("arena: admin task invalid")

// AdminTask is the admin-CRUD projection of a row in `tasks`. solution_hint is
// included here on purpose — the admin surface is the single legitimate
// consumer (curator authoring/review). Public APIs MUST NOT propagate it.
type AdminTask struct {
	ID            uuid.UUID
	Slug          string
	TitleRU       string
	TitleEN       string
	DescriptionRU string
	DescriptionEN string
	Difficulty    string
	Section       string
	TimeLimitSec  int
	MemoryLimitMB int
	SolutionHint  string
	Version       int
	IsActive      bool
	AvgRating     float64
}

// AdminTaskListFilter narrows the admin tasks listing. Empty fields = no
// filter on that axis. OnlyActive=true short-circuits is_active='t' rows.
type AdminTaskListFilter struct {
	Section    string
	Difficulty string
	OnlyActive bool
	Limit      int
}

// AdminTaskUpsert is the create/update payload validated already by callers
// (see ports/wire layer). Repo treats fields as authoritative.
type AdminTaskUpsert struct {
	Slug          string
	TitleRU       string
	TitleEN       string
	DescriptionRU string
	DescriptionEN string
	Difficulty    string
	Section       string
	TimeLimitSec  int
	MemoryLimitMB int
	SolutionHint  string
	IsActive      bool
}

// AdminTaskRepo persists raw `tasks`-table rows for the admin CMS endpoints.
// Distinct from TaskRepo (which exposes the public, hint-stripped projection
// to gameplay paths).
type AdminTaskRepo interface {
	List(ctx context.Context, f AdminTaskListFilter) ([]AdminTask, error)
	Get(ctx context.Context, id uuid.UUID) (AdminTask, error)
	Create(ctx context.Context, in AdminTaskUpsert) (AdminTask, error)
	Update(ctx context.Context, id uuid.UUID, in AdminTaskUpsert) (AdminTask, error)
	SetActive(ctx context.Context, id uuid.UUID, active bool) error
	Delete(ctx context.Context, id uuid.UUID) error
}
