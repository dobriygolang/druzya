package app

import (
	"context"
	"fmt"
	"time"

	"druz9/shared/enums"
	"druz9/slot/domain"

	"github.com/google/uuid"
)

// CreateSlot implements POST /slot (interviewers only).
type CreateSlot struct {
	Slots domain.SlotRepo
	Now   func() time.Time
}

// CreateSlotInput is the sanitized input pulled from the HTTP DTO by the ports
// layer. Role / auth checks happen upstream before Do is invoked.
type CreateSlotInput struct {
	InterviewerID uuid.UUID
	StartsAt      time.Time
	DurationMin   int
	Section       enums.Section
	Difficulty    *enums.Difficulty
	Language      string
	PriceRub      int
	// MeetURL — interviewer-supplied video room URL (optional). Stored as-is
	// on the slot row; BookSlot reuses it on the resulting booking when set.
	MeetURL string
}

// Do validates the slot, runs overlap detection against the interviewer's
// existing slots and inserts the row.
func (uc *CreateSlot) Do(ctx context.Context, in CreateSlotInput) (domain.Slot, error) {
	now := uc.now()

	lang := in.Language
	if lang == "" {
		lang = domain.LanguageRu
	}

	draft := domain.Slot{
		InterviewerID: in.InterviewerID,
		StartsAt:      in.StartsAt.UTC(),
		DurationMin:   in.DurationMin,
		Section:       in.Section,
		Difficulty:    in.Difficulty,
		Language:      lang,
		PriceRub:      in.PriceRub,
		MeetURL:       in.MeetURL,
		Status:        enums.SlotStatusAvailable,
	}
	if err := domain.ValidateSlot(draft, now); err != nil {
		return domain.Slot{}, fmt.Errorf("slot.CreateSlot: %w", err)
	}

	// Overlap detection — look at any non-terminal slot within [starts_at, ends_at).
	existing, err := uc.Slots.ListByInterviewer(ctx,
		in.InterviewerID, draft.StartsAt, draft.EndsAt(),
	)
	if err != nil {
		return domain.Slot{}, fmt.Errorf("slot.CreateSlot: list existing: %w", err)
	}
	if domain.ConflictsWith(existing, draft) {
		return domain.Slot{}, fmt.Errorf("slot.CreateSlot: %w", domain.ErrOverlapping)
	}

	out, err := uc.Slots.Create(ctx, draft)
	if err != nil {
		return domain.Slot{}, fmt.Errorf("slot.CreateSlot: %w", err)
	}
	return out, nil
}

func (uc *CreateSlot) now() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}
