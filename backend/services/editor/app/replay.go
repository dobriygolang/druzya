package app

import (
	"context"
	"fmt"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// Replay implements GET /api/v1/editor/room/{roomId}/replay.
//
// Only a participant of the room may fetch its replay (bible §3.1 leakage
// prevention).
type Replay struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Uploader     domain.ReplayUploader
	// Flush pulls the current in-memory op buffer for the given room and
	// returns the serialised JSONL payload. Implemented by ports/ws.go.
	// Nil-tolerant: when no hub is wired we upload an empty payload so the
	// endpoint still hands out a URL.
	Flush func(roomID uuid.UUID) []byte
}

// Do validates membership and returns a presigned URL.
func (uc *Replay) Do(ctx context.Context, roomID, callerID uuid.UUID) (domain.ReplayURL, error) {
	if _, err := uc.Rooms.Get(ctx, roomID); err != nil {
		return domain.ReplayURL{}, fmt.Errorf("editor.Replay: %w", err)
	}
	if _, err := uc.Participants.GetRole(ctx, roomID, callerID); err != nil {
		// GetRole returns ErrNotFound for non-participants — map to Forbidden
		// at the port layer.
		return domain.ReplayURL{}, fmt.Errorf("editor.Replay: %w", domain.ErrForbidden)
	}

	var payload []byte
	if uc.Flush != nil {
		payload = uc.Flush(roomID)
	}
	url, expires, err := uc.Uploader.Upload(ctx, roomID, payload)
	if err != nil {
		return domain.ReplayURL{}, fmt.Errorf("editor.Replay: upload: %w", err)
	}
	return domain.ReplayURL{URL: url, ExpiresAt: expires}, nil
}
