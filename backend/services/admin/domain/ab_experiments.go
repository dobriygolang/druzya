//go:generate mockgen -package mocks -destination mocks/ab_experiments_mock.go -source ab_experiments.go

// ab_experiments.go — A/B experiment entity + repo port.
//
// Minimal scaffolding для admin surface. Variant rollout logic,
// bucketing, statistics analytics live elsewhere.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ABExperimentStatus — discrete set enforced на DB level via CHECK.
const (
	ABStatusDraft     = "draft"
	ABStatusRunning   = "running"
	ABStatusPaused    = "paused"
	ABStatusCompleted = "completed"
)

// ABVariant — single variant inside an experiment.
type ABVariant struct {
	Name   string `json:"name"`
	Weight int    `json:"weight"`
}

// ABExperiment mirrors an ab_experiments row.
type ABExperiment struct {
	ID         uuid.UUID
	Slug       string
	Hypothesis string
	Variants   []ABVariant
	MetricSlug string
	Status     string
	StartsAt   *time.Time
	EndsAt     *time.Time
	CreatedBy  *uuid.UUID
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// ABExperimentUpsert — create payload.
type ABExperimentUpsert struct {
	Slug       string
	Hypothesis string
	Variants   []ABVariant
	MetricSlug string
	Status     string
	StartsAt   *time.Time
	EndsAt     *time.Time
	CreatedBy  *uuid.UUID
}

// ABExperimentRepo — persistence port. Minimal CRUD; assignment +
// stats живут в отдельных boundaries.
type ABExperimentRepo interface {
	List(ctx context.Context) ([]ABExperiment, error)
	GetByID(ctx context.Context, id uuid.UUID) (ABExperiment, error)
	Create(ctx context.Context, in ABExperimentUpsert) (ABExperiment, error)
	SetStatus(ctx context.Context, id uuid.UUID, status string) (ABExperiment, error)
}
