package app

import (
	"context"
	"fmt"
	"time"

	"druz9/shared/enums"
	"druz9/slot/domain"
)

// ListSlots implements GET /slot.
type ListSlots struct {
	Slots   domain.SlotRepo
	Reviews domain.ReviewRepo
}

// ListSlotsInput mirrors the openapi query filters.
type ListSlotsInput struct {
	Section    *enums.Section
	Difficulty *enums.Difficulty
	From       *time.Time
	To         *time.Time
	PriceMax   *int
	Limit      int
}

// Do returns the filtered slot feed, enriching each row with the
// interviewer's aggregate rating stats. The repo is expected to cap the
// response server-side; we hydrate stats in Go to keep the SQL small.
func (uc *ListSlots) Do(ctx context.Context, in ListSlotsInput) ([]domain.Slot, error) {
	slots, err := uc.Slots.List(ctx, domain.ListFilter{
		Section:    in.Section,
		Difficulty: in.Difficulty,
		From:       in.From,
		To:         in.To,
		PriceMax:   in.PriceMax,
		Limit:      in.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("slot.ListSlots: %w", err)
	}

	// Cache stats per interviewer to avoid N+1 lookups.
	type stats struct {
		Avg   *float32
		Count *int
	}
	cache := map[string]stats{}
	for i := range slots {
		id := slots[i].InterviewerID
		key := id.String()
		st, ok := cache[key]
		if !ok {
			avg, count, err := uc.Reviews.InterviewerStats(ctx, id)
			if err != nil {
				return nil, fmt.Errorf("slot.ListSlots: interviewer stats: %w", err)
			}
			// Only surface stats once there is at least one review.
			if count > 0 {
				a := avg
				c := count
				st = stats{Avg: &a, Count: &c}
			}
			cache[key] = st
		}
		slots[i].InterviewerAvgRating = st.Avg
		slots[i].InterviewerReviewsCount = st.Count
	}
	return slots, nil
}
