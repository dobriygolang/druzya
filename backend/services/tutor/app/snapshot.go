package app

import (
	"context"
	"fmt"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// SnapshotWindowDays is the trailing window the tutor dashboard
// renders by default. 7 days matches «pre-session brief» cadence —
// most tutors run weekly sessions and want the snapshot to cover
// «what happened since we last met».
const SnapshotWindowDays = 7

// GetStudentSnapshot — tutor reads a student's aggregate. Always
// authorizes via SnapshotRepo.EnsureRelationship before fetching;
// foreign-id probes return ErrNotFound, not 403 (matches the rest of
// the codebase's «cross-user leak protection» policy in
// docs/tech/conventions.md).
type GetStudentSnapshot struct {
	Repo domain.SnapshotRepo
	Now  func() time.Time
}

type GetStudentSnapshotInput struct {
	TutorID    uuid.UUID
	StudentID  uuid.UUID
	WindowDays int // 0 → SnapshotWindowDays
}

func (uc *GetStudentSnapshot) Do(ctx context.Context, in GetStudentSnapshotInput) (domain.StudentSnapshot, error) {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.EnsureRelationship(ctx, in.TutorID, in.StudentID); err != nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: %w", err)
	}
	w := in.WindowDays
	if w <= 0 {
		w = SnapshotWindowDays
	}
	now := nowOr(uc.Now)
	snap, err := uc.Repo.GetStudentSnapshot(ctx, in.StudentID, w, now)
	if err != nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: %w", err)
	}
	return snap, nil
}

// PreSessionBriefer is the LLM hop. The tutor module avoids importing
// shared/pkg/llmchain directly (it's a heavy dependency that pulls
// the whole provider stack); instead the wirer in cmd/monolith plugs
// in a closure that translates the snapshot into a 1-page narrative.
//
// The closure returns "" when LLMChain is unavailable — caller
// renders a fallback «brief unavailable, raw stats below».
type PreSessionBriefer interface {
	Render(ctx context.Context, snap domain.StudentSnapshot) (string, error)
}

// GeneratePreSessionBrief — Wave 2.5 of plan.md. Wraps
// GetStudentSnapshot + the LLM render so the handler doesn't have to
// orchestrate two repo hops.
type GeneratePreSessionBrief struct {
	Snapshot *GetStudentSnapshot
	Briefer  PreSessionBriefer
}

type PreSessionBrief struct {
	Snapshot domain.StudentSnapshot
	Brief    string // empty when Briefer unavailable
}

func (uc *GeneratePreSessionBrief) Do(ctx context.Context, in GetStudentSnapshotInput) (PreSessionBrief, error) {
	snap, err := uc.Snapshot.Do(ctx, in)
	if err != nil {
		return PreSessionBrief{}, err
	}
	out := PreSessionBrief{Snapshot: snap}
	if uc.Briefer == nil {
		return out, nil
	}
	brief, err := uc.Briefer.Render(ctx, snap)
	if err != nil {
		// LLM hop is non-blocking — return the raw snapshot so the
		// dashboard can still render numbers. Wirer logs the error.
		return out, nil
	}
	out.Brief = brief
	return out, nil
}
