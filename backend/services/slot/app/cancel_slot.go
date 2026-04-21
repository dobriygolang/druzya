package app

import (
	"context"
	"fmt"
	"log/slog"

	sharedDomain "druz9/shared/domain"
	"druz9/slot/domain"

	"github.com/google/uuid"
)

// CancelSlot implements DELETE /slot/{slotId}/cancel.
//
// Authorization: only the slot's interviewer (owner) may cancel. The ports
// layer resolves the caller's user id from the context and passes it as
// UserID — this use case verifies ownership before hitting the DB.
//
// Side effects:
//   - SlotRepo.CancelSlotWithBooking flips the slot to `cancelled` and (if
//     there was a booking) the booking to `cancelled` in one transaction.
//   - When there was a booking we publish SlotCancelled on the bus so the
//     notify domain can alert the candidate (notify already handles it).
type CancelSlot struct {
	Slots domain.SlotRepo
	Bus   sharedDomain.Bus
	Log   *slog.Logger
}

// CancelSlotInput is the parsed HTTP input.
type CancelSlotInput struct {
	SlotID uuid.UUID
	UserID uuid.UUID
}

// Do executes the cancellation.
func (uc *CancelSlot) Do(ctx context.Context, in CancelSlotInput) error {
	slot, err := uc.Slots.GetByID(ctx, in.SlotID)
	if err != nil {
		return fmt.Errorf("slot.CancelSlot: %w", err)
	}
	if slot.InterviewerID != in.UserID {
		return fmt.Errorf("slot.CancelSlot: %w", domain.ErrForbidden)
	}

	_, hadBooking, err := uc.Slots.CancelSlotWithBooking(ctx, in.SlotID)
	if err != nil {
		return fmt.Errorf("slot.CancelSlot: %w", err)
	}

	if hadBooking && uc.Bus != nil {
		if perr := uc.Bus.Publish(ctx, sharedDomain.SlotCancelled{
			SlotID: slot.ID,
			ByUser: in.UserID,
		}); perr != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "slot.CancelSlot: publish SlotCancelled",
				slog.String("slot_id", slot.ID.String()), slog.Any("err", perr))
		}
	}
	return nil
}
