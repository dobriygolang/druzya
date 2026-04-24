package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	sharedDomain "druz9/shared/domain"
	"druz9/slot/domain"

	"github.com/google/uuid"
)

// BookSlot implements POST /slot/{slotId}/book.
//
// Flow:
//  1. Load slot for validation (domain.CanBook).
//  2. Delegate to SlotRepo.BookAtomically — the infra layer locks the row,
//     flips status and inserts the booking inside a single transaction.
//  3. Generate the meet URL (best-effort; failure is not fatal — logged).
//     The URL is persisted by BookAtomically so callers receive the full
//     Booking.
//  4. Publish SlotBooked on the shared event bus.
type BookSlot struct {
	Slots domain.SlotRepo
	Meet  domain.MeetRoomProvider
	Bus   sharedDomain.Bus
	Log   *slog.Logger
	Now   func() time.Time
}

// BookSlotInput is the parsed HTTP input.
type BookSlotInput struct {
	SlotID      uuid.UUID
	CandidateID uuid.UUID
}

// Do runs one booking end-to-end.
func (uc *BookSlot) Do(ctx context.Context, in BookSlotInput) (domain.Booking, error) {
	// Pre-check against domain rules so we can return specific errors before
	// hitting the transaction. BookAtomically re-checks under FOR UPDATE to
	// close the race window.
	slot, err := uc.Slots.GetByID(ctx, in.SlotID)
	if err != nil {
		return domain.Booking{}, fmt.Errorf("slot.BookSlot: %w", err)
	}
	if checkErr := domain.CanBook(slot, in.CandidateID, uc.now()); checkErr != nil {
		return domain.Booking{}, fmt.Errorf("slot.BookSlot: %w", checkErr)
	}

	// Prefer the interviewer-supplied meet URL (set on the slot at create
	// time, e.g. their personal Google Meet room). Fall back to the provider
	// stub when empty so legacy slots without meet_url still get a value.
	var meetURL string
	if slot.MeetURL != "" {
		meetURL = slot.MeetURL
	} else {
		generated, gerr := uc.Meet.GenerateMeetURL(ctx, in.SlotID)
		if gerr != nil {
			if uc.Log != nil {
				uc.Log.WarnContext(ctx, "slot.BookSlot: meet room generation failed",
					slog.String("slot_id", in.SlotID.String()),
					slog.Any("err", gerr),
				)
			}
			meetURL = ""
		} else {
			meetURL = generated
		}
	}

	booking, err := uc.Slots.BookAtomically(ctx, in.SlotID, in.CandidateID, meetURL)
	if err != nil {
		return domain.Booking{}, fmt.Errorf("slot.BookSlot: %w", err)
	}

	// Publish event — handler failures must not fail the booking.
	if uc.Bus != nil {
		if perr := uc.Bus.Publish(ctx, sharedDomain.SlotBooked{
			SlotID:        slot.ID,
			InterviewerID: slot.InterviewerID,
			CandidateID:   in.CandidateID,
			StartsAt:      slot.StartsAt,
		}); perr != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "slot.BookSlot: publish SlotBooked", slog.Any("err", perr))
		}
	}
	return booking, nil
}

func (uc *BookSlot) now() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}
