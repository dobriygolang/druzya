// Package domain — replay.go: types для post-debrief "разбор пробного
// собеса". Generated lazily через free LLM cascade, cached в
// pipeline_attempts (migration 00125: ideal_answer_md / diff_annotations /
// replay_generated_at).
//
// Why split from the main grading flow: replay is a read-only,
// non-load-bearing UI affordance ("посмотри как могло быть лучше"). It
// must not block grading or any orchestrator path. We add columns to
// pipeline_attempts instead of a new table because (a) it's strictly
// 1:1 with the attempt, (b) keeps GetReplay a single-row SELECT, and
// (c) cascade-deletes for free when the pipeline gets cleaned up.
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ReplayAnnotationType — kind of diff between user's answer and the
// ideal one. The frontend uses these to colour highlights:
//   - "missing": user didn't cover this point at all
//   - "incorrect": user touched it but got it wrong / partial
//   - "good": user did this right (positive reinforcement)
//
// We keep it as a plain string for forward compatibility — adding a
// new type doesn't break clients (unknown types render as neutral).
type ReplayAnnotationType string

const (
	ReplayAnnotationMissing   ReplayAnnotationType = "missing"
	ReplayAnnotationIncorrect ReplayAnnotationType = "incorrect"
	ReplayAnnotationGood      ReplayAnnotationType = "good"
)

// IsValid reports whether a string parses as one of the three canonical
// annotation types. Callers (orchestrator / LLM-output parser) coerce
// unknown values to "missing" as the safest visible default.
func (t ReplayAnnotationType) IsValid() bool {
	switch t {
	case ReplayAnnotationMissing, ReplayAnnotationIncorrect, ReplayAnnotationGood:
		return true
	}
	return false
}

// ReplayAnnotation — one element of diff_annotations jsonb array.
//
// YourExcerpt is a verbatim slice of the user's answer (or empty when the
// user said nothing about this point — common for "missing" type).
// IdealExcerpt is a corresponding slice of the ideal answer markdown.
// Frontend can render side-by-side highlights; we don't ship char-offsets
// because they don't survive markdown rendering / wrap reflow.
type ReplayAnnotation struct {
	YourExcerpt  string               `json:"your_excerpt"`
	IdealExcerpt string               `json:"ideal_excerpt"`
	Type         ReplayAnnotationType `json:"type"`
	Comment      string               `json:"comment"`
}

// AttemptReplay — cached LLM-generated "ideal answer + diff" pair for one
// pipeline_attempt row. Returned by PipelineAttemptRepo.GetReplay; set by
// SetReplay.
type AttemptReplay struct {
	AttemptID     uuid.UUID
	IdealAnswerMD string
	Annotations   []ReplayAnnotation
	GeneratedAt   time.Time
}

// HasContent — true when there is a usable cached replay (either some
// markdown body OR at least one annotation). Empty all-fields means "not
// generated yet" — caller should kick off generation.
func (r AttemptReplay) HasContent() bool {
	if r.IdealAnswerMD != "" {
		return true
	}
	return len(r.Annotations) > 0
}

// ErrReplayNotReady — sentinel returned when GetReplay finds the row but
// no replay has been generated. Distinct from ErrNotFound (which means
// the attempt itself doesn't exist).
var ErrReplayNotReady = errors.New("mock_interview: replay not generated yet")

// ReplayRepo — narrow interface around the two replay columns.
// Implemented by infra.PipelineAttempts via two new methods; we don't
// add them to PipelineAttemptRepo proper to keep the existing mock
// surface area small and because replay is a strictly-additive concern.
type ReplayRepo interface {
	// GetReplay returns the cached pair. ErrReplayNotReady when
	// replay_generated_at IS NULL. ErrNotFound when the attempt id
	// doesn't exist.
	GetReplay(ctx context.Context, attemptID uuid.UUID) (AttemptReplay, error)

	// SetReplay overwrites the cached pair + stamps replay_generated_at
	// to the supplied time. Marshalling of Annotations is the repo's
	// responsibility (jsonb encoding).
	SetReplay(ctx context.Context, attemptID uuid.UUID, ideal string,
		annotations []ReplayAnnotation, now time.Time) error
}
