package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Freeze implements POST /api/v1/editor/room/{roomId}/freeze.
//
// Only owner + interviewer may flip the flag (bible §3.1). A freeze event
// is broadcast via the Notifier interface so the WS hub fans it out to all
// connected clients.
type Freeze struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Notifier     FreezeNotifier
	Log          *slog.Logger
}

// FreezeNotifier is the outbound hook that ports/ws.go implements.
// Narrow interface — the app layer does not know about websockets.
type FreezeNotifier interface {
	BroadcastFreeze(roomID uuid.UUID, frozen bool, actor uuid.UUID)
}

// FreezeInput is the use-case payload.
type FreezeInput struct {
	RoomID   uuid.UUID
	CallerID uuid.UUID
	Frozen   bool
}

// Do toggles the freeze flag and broadcasts the change.
func (uc *Freeze) Do(ctx context.Context, in FreezeInput) (domain.Room, error) {
	role, err := uc.Participants.GetRole(ctx, in.RoomID, in.CallerID)
	if err != nil {
		// Either not a participant, or repo error.
		return domain.Room{}, fmt.Errorf("editor.Freeze: %w", err)
	}
	if role != enums.EditorRoleOwner && role != enums.EditorRoleInterviewer {
		return domain.Room{}, fmt.Errorf("editor.Freeze: %w", domain.ErrForbidden)
	}
	room, err := uc.Rooms.UpdateFreeze(ctx, in.RoomID, in.Frozen)
	if err != nil {
		return domain.Room{}, fmt.Errorf("editor.Freeze: %w", err)
	}
	if uc.Notifier != nil {
		uc.Notifier.BroadcastFreeze(room.ID, room.IsFrozen, in.CallerID)
	}
	return room, nil
}
