package app

import (
	"context"
	"fmt"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// GetRoom implements GET /api/v1/editor/room/{roomId}.
type GetRoom struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Tasks        domain.TaskRepo // optional — omitted in wiring where not needed
}

// GetRoomOutput bundles the room + participants + optional task.
type GetRoomOutput struct {
	Room         domain.Room
	Participants []domain.Participant
	Task         *domain.TaskPublic
}

// Do loads the full room state. Caller-authorisation (participant-or-owner
// gate) is enforced in the port layer, not here — ports/server.go does
// the check before returning.
func (uc *GetRoom) Do(ctx context.Context, roomID uuid.UUID) (GetRoomOutput, error) {
	r, err := uc.Rooms.Get(ctx, roomID)
	if err != nil {
		return GetRoomOutput{}, fmt.Errorf("editor.GetRoom: %w", err)
	}
	ps, err := uc.Participants.List(ctx, roomID)
	if err != nil {
		return GetRoomOutput{}, fmt.Errorf("editor.GetRoom: participants: %w", err)
	}
	out := GetRoomOutput{Room: r, Participants: ps}
	if r.TaskID != nil && uc.Tasks != nil {
		task, tErr := uc.Tasks.GetByID(ctx, *r.TaskID)
		if tErr == nil {
			out.Task = &task
		}
		// soft-fail: missing task is not fatal for the room view.
	}
	return out, nil
}
