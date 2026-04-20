//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("admin: not found")

// ErrConflict indicates a uniqueness violation (e.g. duplicate slug).
var ErrConflict = errors.New("admin: conflict")

// ErrInvalidInput is the umbrella sentinel for validation failures; callers
// use errors.Is + the specific reasons below to branch.
var ErrInvalidInput = errors.New("admin: invalid input")

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

// TaskRepo persists the tasks aggregate (task + test_cases + templates +
// follow_up_questions). Upsert mutations are transactional — the adapter is
// responsible for coordinating the nested inserts atomically.
type TaskRepo interface {
	List(ctx context.Context, f TaskFilter) (TaskPage, error)
	GetByID(ctx context.Context, id uuid.UUID) (AdminTask, error)
	Create(ctx context.Context, in TaskUpsert) (AdminTask, error)
	Update(ctx context.Context, id uuid.UUID, in TaskUpsert) (AdminTask, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

// CompanyRepo persists companies rows.
type CompanyRepo interface {
	List(ctx context.Context) ([]AdminCompany, error)
	Upsert(ctx context.Context, in CompanyUpsert) (AdminCompany, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

// ConfigRepo persists dynamic_config rows.
type ConfigRepo interface {
	List(ctx context.Context) ([]ConfigEntry, error)
	Get(ctx context.Context, key string) (ConfigEntry, error)
	Upsert(ctx context.Context, entry ConfigEntry, updatedBy *uuid.UUID) (ConfigEntry, error)
}

// ConfigBroadcaster publishes dynconfig change notifications over Redis
// Pub/Sub for sub-100 ms hot-reload propagation (bible §7). The channel name
// and payload shape are documented in infra/redis_broadcaster.go.
type ConfigBroadcaster interface {
	Publish(ctx context.Context, entry ConfigEntry) error
}

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

// AnticheatRepo serves the anticheat dashboard.
type AnticheatRepo interface {
	List(ctx context.Context, f AnticheatFilter) ([]AnticheatSignal, error)
}
