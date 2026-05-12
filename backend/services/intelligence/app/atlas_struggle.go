// atlas_struggle.go — X5 (Phase J P2 2026-05-12) cross-product handoff UCs.
//
// MarkAtlasStruggle is the entry-point for any service that detects "user
// is stuck on atlas node X" — Cue session analysis (low self_rating), Hone
// reflection persistence (grade ≤2), mock_stage scoring (axis ≤0.4). Each
// caller passes its own source tag + calibrated confidence; the repo
// collapses duplicates per (user, atlas_node_id).
//
// ListAtlasStruggles is the read surface — web AtlasPage hydrates the
// highlight overlay; Hone Coach reads when building cross-product reminders.
//
// ClearAtlasStruggle is an explicit «I'm not stuck anymore» gesture from
// the user (Atlas tooltip → "clear mark" affordance).
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

const (
	atlasStruggleNoteMaxLen        = 280
	atlasStruggleDefaultConfidence = 0.5
)

// MarkAtlasStruggle UC.
type MarkAtlasStruggle struct {
	Repo domain.AtlasStruggleRepo
	Now  func() time.Time
}

// MarkAtlasStruggleInput — wire-shape для UC.
type MarkAtlasStruggleInput struct {
	UserID      uuid.UUID
	AtlasNodeID string
	Source      string
	Confidence  float64
	Note        string
}

// Do validates and upserts. Source defaults to 'manual' when empty.
// Confidence clamped to [0,1]; out-of-band values normalised silently
// (producers shouldn't fail an entire interview ingestion over a stray
// score range).
func (uc *MarkAtlasStruggle) Do(ctx context.Context, in MarkAtlasStruggleInput) error {
	if uc.Repo == nil {
		return fmt.Errorf("intelligence.MarkAtlasStruggle: repo not wired")
	}
	if in.UserID == uuid.Nil {
		return fmt.Errorf("intelligence.MarkAtlasStruggle: %w: zero user_id", domain.ErrInvalidInput)
	}
	nodeID := strings.TrimSpace(in.AtlasNodeID)
	if nodeID == "" {
		return fmt.Errorf("intelligence.MarkAtlasStruggle: %w: atlas_node_id required", domain.ErrInvalidInput)
	}
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = string(domain.AtlasStruggleSourceManual)
	}
	src := domain.AtlasStruggleSource(source)
	if !src.IsValid() {
		return fmt.Errorf("intelligence.MarkAtlasStruggle: %w: invalid source %q", domain.ErrInvalidInput, source)
	}
	confidence := in.Confidence
	if confidence <= 0 {
		confidence = atlasStruggleDefaultConfidence
	}
	if confidence > 1.0 {
		confidence = 1.0
	}
	note := strings.TrimSpace(in.Note)
	if len(note) > atlasStruggleNoteMaxLen {
		note = note[:atlasStruggleNoteMaxLen]
	}
	if err := uc.Repo.Upsert(ctx, domain.AtlasStruggleMark{
		UserID:      in.UserID,
		AtlasNodeID: nodeID,
		Source:      src,
		Confidence:  confidence,
		Note:        note,
		MarkedAt:    uc.now(),
	}); err != nil {
		return fmt.Errorf("intelligence.MarkAtlasStruggle upsert: %w", err)
	}
	return nil
}

func (uc *MarkAtlasStruggle) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// ListAtlasStruggles UC.
type ListAtlasStruggles struct {
	Repo domain.AtlasStruggleRepo
}

// ListAtlasStrugglesInput — wire-shape для UC.
type ListAtlasStrugglesInput struct {
	UserID     uuid.UUID
	WindowDays int
}

// ListAtlasStrugglesOutput — wire-shape для UC.
type ListAtlasStrugglesOutput struct {
	Items []domain.AtlasStruggleMark
}

// Do reads marks for user within window. windowDays ≤ 0 → repo default.
func (uc *ListAtlasStruggles) Do(ctx context.Context, in ListAtlasStrugglesInput) (ListAtlasStrugglesOutput, error) {
	if uc.Repo == nil {
		return ListAtlasStrugglesOutput{}, fmt.Errorf("intelligence.ListAtlasStruggles: repo not wired")
	}
	if in.UserID == uuid.Nil {
		return ListAtlasStrugglesOutput{}, fmt.Errorf("intelligence.ListAtlasStruggles: %w: zero user_id", domain.ErrInvalidInput)
	}
	items, err := uc.Repo.ListByUser(ctx, in.UserID, in.WindowDays)
	if err != nil {
		return ListAtlasStrugglesOutput{}, fmt.Errorf("intelligence.ListAtlasStruggles: %w", err)
	}
	return ListAtlasStrugglesOutput{Items: items}, nil
}

// ClearAtlasStruggle UC.
type ClearAtlasStruggle struct {
	Repo domain.AtlasStruggleRepo
}

// ClearAtlasStruggleInput — wire-shape для UC.
type ClearAtlasStruggleInput struct {
	UserID      uuid.UUID
	AtlasNodeID string
}

// Do removes the mark. Idempotent — missing row is not an error.
func (uc *ClearAtlasStruggle) Do(ctx context.Context, in ClearAtlasStruggleInput) error {
	if uc.Repo == nil {
		return fmt.Errorf("intelligence.ClearAtlasStruggle: repo not wired")
	}
	if in.UserID == uuid.Nil {
		return fmt.Errorf("intelligence.ClearAtlasStruggle: %w: zero user_id", domain.ErrInvalidInput)
	}
	nodeID := strings.TrimSpace(in.AtlasNodeID)
	if nodeID == "" {
		return fmt.Errorf("intelligence.ClearAtlasStruggle: %w: atlas_node_id required", domain.ErrInvalidInput)
	}
	if err := uc.Repo.Clear(ctx, in.UserID, nodeID); err != nil {
		return fmt.Errorf("intelligence.ClearAtlasStruggle clear: %w", err)
	}
	return nil
}
