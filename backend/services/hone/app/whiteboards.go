package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── CreateWhiteboard ──────────────────────────────────────────────────────

// CreateWhiteboard stores a new tldraw document. The state_json is treated
// as opaque — the server does NOT validate shape structure; tldraw will
// refuse to load a corrupted blob on the client side.
type CreateWhiteboard struct {
	Boards domain.WhiteboardRepo
	Now    func() time.Time
}

// CreateWhiteboardInput — wire body.
type CreateWhiteboardInput struct {
	UserID    uuid.UUID
	Title     string
	StateJSON []byte
}

// Do executes the use case.
func (uc *CreateWhiteboard) Do(ctx context.Context, in CreateWhiteboardInput) (domain.Whiteboard, error) {
	now := uc.Now().UTC()
	wb := domain.Whiteboard{
		UserID:    in.UserID,
		Title:     in.Title,
		StateJSON: in.StateJSON,
		Version:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := uc.Boards.Create(ctx, wb)
	if err != nil {
		return domain.Whiteboard{}, fmt.Errorf("hone.CreateWhiteboard.Do: %w", err)
	}
	return created, nil
}

// ─── UpdateWhiteboard ──────────────────────────────────────────────────────

// UpdateWhiteboard replaces the document with optimistic concurrency on
// version. Pass expected_version=0 to skip the check (only when the client
// is confident — currently the desktop always sends its last-known version).
type UpdateWhiteboard struct {
	Boards domain.WhiteboardRepo
	Now    func() time.Time
}

// UpdateWhiteboardInput — wire body.
type UpdateWhiteboardInput struct {
	UserID          uuid.UUID
	WhiteboardID    uuid.UUID
	Title           string
	StateJSON       []byte
	ExpectedVersion int
}

// Do executes the use case.
func (uc *UpdateWhiteboard) Do(ctx context.Context, in UpdateWhiteboardInput) (domain.Whiteboard, error) {
	wb := domain.Whiteboard{
		ID:        in.WhiteboardID,
		UserID:    in.UserID,
		Title:     in.Title,
		StateJSON: in.StateJSON,
		UpdatedAt: uc.Now().UTC(),
	}
	updated, err := uc.Boards.Update(ctx, wb, in.ExpectedVersion)
	if err != nil {
		return domain.Whiteboard{}, fmt.Errorf("hone.UpdateWhiteboard.Do: %w", err)
	}
	return updated, nil
}

// ─── GetWhiteboard / List / Delete ─────────────────────────────────────────

// GetWhiteboard fetches one board by id + owner.
type GetWhiteboard struct {
	Boards domain.WhiteboardRepo
}

// Do executes the use case.
func (uc *GetWhiteboard) Do(ctx context.Context, userID, wbID uuid.UUID) (domain.Whiteboard, error) {
	return uc.Boards.Get(ctx, userID, wbID)
}

// ListWhiteboards returns list-view projections.
type ListWhiteboards struct {
	Boards domain.WhiteboardRepo
}

// Do executes the use case.
func (uc *ListWhiteboards) Do(ctx context.Context, userID uuid.UUID) ([]domain.WhiteboardSummary, error) {
	return uc.Boards.List(ctx, userID)
}

// DeleteWhiteboard removes a board by id + owner.
type DeleteWhiteboard struct {
	Boards domain.WhiteboardRepo
}

// Do executes the use case.
func (uc *DeleteWhiteboard) Do(ctx context.Context, userID, wbID uuid.UUID) error {
	return uc.Boards.Delete(ctx, userID, wbID)
}

// ─── CritiqueWhiteboard ────────────────────────────────────────────────────

// CritiqueWhiteboard loads the board's state_json and streams an AI
// architect's critique via the CritiqueStreamer adapter. Reuses the
// existing llmchain TaskSysDesignCritique task — same model map as the
// ai_mock system-design track.
//
// The prompt (held in the CritiqueStreamer impl) feeds the tldraw JSON
// plus the board title as context. Output is sectioned ("strengths /
// concerns / missing / closing") and emitted as CritiquePacket stream.
type CritiqueWhiteboard struct {
	Boards    domain.WhiteboardRepo
	Streamer  domain.CritiqueStreamer // nil when llmchain is nil
	Log       *slog.Logger
}

// CritiqueWhiteboardInput — wire body.
type CritiqueWhiteboardInput struct {
	UserID       uuid.UUID
	WhiteboardID uuid.UUID
}

// Do executes the use case. `yield` is called per CritiquePacket; returning
// a non-nil error aborts the stream.
func (uc *CritiqueWhiteboard) Do(ctx context.Context, in CritiqueWhiteboardInput, yield func(domain.CritiquePacket) error) error {
	if uc.Streamer == nil {
		return fmt.Errorf("hone.CritiqueWhiteboard.Do: %w", domain.ErrLLMUnavailable)
	}
	wb, err := uc.Boards.Get(ctx, in.UserID, in.WhiteboardID)
	if err != nil {
		return fmt.Errorf("hone.CritiqueWhiteboard.Do: %w", err)
	}
	if err := uc.Streamer.Critique(ctx, wb.StateJSON, yield); err != nil {
		return fmt.Errorf("hone.CritiqueWhiteboard.Do: critique: %w", err)
	}
	return nil
}
