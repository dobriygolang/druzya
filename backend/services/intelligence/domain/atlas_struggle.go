// atlas_struggle.go — X5 (Phase J P2 2026-05-12) cross-product handoff signal.
//
// AtlasStruggleMark = "user is stuck on node X" derived from any surface
// (Cue session low rating, Hone reflection grade ≤2, mock_stage poor score).
// Written by producers across services; read by web AtlasPage to highlight
// nodes per CLAUDE.md b/w-only rule (1.5px red stripe / single dot indicator).
//
// Single row per (user, atlas_node_id) — latest write wins. See migration
// 00107 for rationale (no append-only struggle log here; source history
// lives in coach_episodes payloads).
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// AtlasStruggleSource enumerates valid producers. Closed set — server
// validates against this list before writing.
type AtlasStruggleSource string

const (
	AtlasStruggleSourceCueSession     AtlasStruggleSource = "cue_session"
	AtlasStruggleSourceHoneReflection AtlasStruggleSource = "hone_reflection"
	AtlasStruggleSourceMockStage      AtlasStruggleSource = "mock_stage"
	AtlasStruggleSourceManual         AtlasStruggleSource = "manual"
)

// IsValid powers exhaustive runtime guards in the UC.
func (s AtlasStruggleSource) IsValid() bool {
	switch s {
	case AtlasStruggleSourceCueSession,
		AtlasStruggleSourceHoneReflection,
		AtlasStruggleSourceMockStage,
		AtlasStruggleSourceManual:
		return true
	}
	return false
}

// AtlasStruggleMark — one row in user_atlas_struggle_marks (migration 00107).
type AtlasStruggleMark struct {
	UserID      uuid.UUID
	AtlasNodeID string
	Source      AtlasStruggleSource
	// Confidence ∈ [0,1]. 0.5 = default; producers calibrate (Cue 1/5 → 0.9,
	// reflection grade 2/5 → 0.7, etc.).
	Confidence float64
	// Note — single-line context surfaced in UI tooltip («grade 2 — stuck on
	// joins»). Capped at 280 chars in UC.
	Note     string
	MarkedAt time.Time
}

// AtlasStruggleRepo — persistence port for cross-product struggle signals.
type AtlasStruggleRepo interface {
	// Upsert writes a row idempotently. Latest write wins on (user, node)
	// conflict — source/confidence/note/marked_at replaced.
	Upsert(ctx context.Context, in AtlasStruggleMark) error
	// ListByUser returns all marks for user within windowDays, newest first.
	// windowDays ≤ 0 → repo default (30); hard cap 365.
	ListByUser(ctx context.Context, userID uuid.UUID, windowDays int) ([]AtlasStruggleMark, error)
	// Clear removes a mark explicitly. Idempotent — clearing a non-existent
	// (user, node) pair returns nil.
	Clear(ctx context.Context, userID uuid.UUID, atlasNodeID string) error
}
