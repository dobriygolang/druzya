//go:generate mockgen -package mocks -destination mocks/reading_path_mock.go -source reading_path.go

// Curated atlas-node sequence that a tutor crafts for a student/cohort
// to walk through. Complements SharedMaterial (one-off broadcast) — a
// path is reusable curriculum, not a single recommendation.
//
// `assigned_count` is denormalised for the list view; bumped by
// AssignReadingPath UC.

package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ReadingPathMaxNodes mirrors the DB CHECK constraint (migration 00093).
// Enforced both in the use case and SQL so a misbehaving client can't
// bypass the limit.
const ReadingPathMaxNodes = 200

// ReadingPath — one curated atlas-node sequence.
type ReadingPath struct {
	ID             uuid.UUID
	TutorID        uuid.UUID
	Name           string
	Description    string
	AtlasNodeKeys  []string
	ResourceIDs    []uuid.UUID
	AssignedCount  int
	ArchivedAt     *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// ReadingPathRepo — pgx-backed persistence for tutor_reading_paths.
type ReadingPathRepo interface {
	// CreateReadingPath persists a fresh path. Caller has already
	// validated the input shape — this just inserts and returns the
	// canonical row (with server-generated id + timestamps).
	CreateReadingPath(ctx context.Context, p ReadingPath) (ReadingPath, error)

	// UpdateReadingPath overwrites name/description/keys/ids on an
	// existing path scoped by tutor_id (per-row auth at the SQL gate).
	// ErrNotFound when no row matches.
	UpdateReadingPath(ctx context.Context, p ReadingPath) (ReadingPath, error)

	// ArchiveReadingPath soft-deletes (stamps archived_at). Idempotent —
	// archiving an already-archived path is a no-op.
	ArchiveReadingPath(ctx context.Context, tutorID, pathID uuid.UUID, now time.Time) error

	// ListReadingPathsByTutorPaged — keyset cursor pagination on
	// created_at DESC, id DESC. Excludes archived_at IS NOT NULL.
	ListReadingPathsByTutorPaged(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) ([]ReadingPath, string, error)

	// GetReadingPathForTutor reads one path scoped by tutor_id —
	// per-row auth at the SQL gate, ErrNotFound when no row matches
	// (covers «doesn't exist» AND «not yours»). Used by AssignReadingPath
	// to snapshot contents at assign time.
	GetReadingPathForTutor(ctx context.Context, tutorID, pathID uuid.UUID) (ReadingPath, error)
}
