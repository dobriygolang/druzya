// delete_room.go — owner-only room deletion. Wraps RoomRepo.DeleteOwned with
// the same not-leak-existence rule the monolith handler enforced inline.
package app

import (
	"context"
	"fmt"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// DeleteRoom is the use-case for DELETE /editor/room/{id}.
type DeleteRoom struct {
	Rooms domain.RoomRepo
}

// Run deletes the room iff caller is the owner. Returns domain.ErrNotFound
// (wrapped — use errors.Is) when the row didn't exist or caller wasn't owner.
func (uc *DeleteRoom) Run(ctx context.Context, roomID, callerID uuid.UUID) error {
	if err := uc.Rooms.DeleteOwned(ctx, roomID, callerID); err != nil {
		return fmt.Errorf("editor.DeleteRoom: %w", err)
	}
	return nil
}
