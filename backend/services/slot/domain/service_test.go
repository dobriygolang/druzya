package domain

import (
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

func baseSlot(startsAt time.Time) Slot {
	return Slot{
		ID:            uuid.New(),
		InterviewerID: uuid.New(),
		StartsAt:      startsAt,
		DurationMin:   60,
		Section:       enums.SectionAlgorithms,
		Language:      LanguageRu,
		PriceRub:      0,
		Status:        enums.SlotStatusAvailable,
	}
}

func TestValidateSlot_OK(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(2 * time.Hour))
	if err := ValidateSlot(s, now); err != nil {
		t.Fatalf("expected valid slot, got %v", err)
	}
}

func TestValidateSlot_PastStartRejected(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(-time.Minute))
	if err := ValidateSlot(s, now); err != ErrPastStart {
		t.Fatalf("want ErrPastStart, got %v", err)
	}
	// Equal-to-now is also rejected (must be strictly future).
	s.StartsAt = now
	if err := ValidateSlot(s, now); err != ErrPastStart {
		t.Fatalf("want ErrPastStart for now==starts_at, got %v", err)
	}
}

func TestValidateSlot_DurationBounds(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))

	s.DurationMin = 14 // below min
	if err := ValidateSlot(s, now); err != ErrInvalidDuration {
		t.Fatalf("want ErrInvalidDuration for 14min, got %v", err)
	}
	s.DurationMin = 15 // boundary inclusive
	if err := ValidateSlot(s, now); err != nil {
		t.Fatalf("want valid at 15min boundary, got %v", err)
	}
	s.DurationMin = 180 // boundary inclusive
	if err := ValidateSlot(s, now); err != nil {
		t.Fatalf("want valid at 180min boundary, got %v", err)
	}
	s.DurationMin = 181 // above max
	if err := ValidateSlot(s, now); err != ErrInvalidDuration {
		t.Fatalf("want ErrInvalidDuration for 181min, got %v", err)
	}
}

func TestValidateSlot_PriceNegative(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	s.PriceRub = -1
	if err := ValidateSlot(s, now); err != ErrInvalidPrice {
		t.Fatalf("want ErrInvalidPrice, got %v", err)
	}
}

func TestValidateSlot_BadSection(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	s.Section = enums.Section("bogus")
	if err := ValidateSlot(s, now); err != ErrInvalidSection {
		t.Fatalf("want ErrInvalidSection, got %v", err)
	}
}

func TestValidateSlot_BadDifficulty(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	bad := enums.Difficulty("nightmare")
	s.Difficulty = &bad
	if err := ValidateSlot(s, now); err != ErrInvalidDifficulty {
		t.Fatalf("want ErrInvalidDifficulty, got %v", err)
	}
	easy := enums.DifficultyEasy
	s.Difficulty = &easy
	if err := ValidateSlot(s, now); err != nil {
		t.Fatalf("want valid easy, got %v", err)
	}
}

func TestCanBook_SelfBookingRejected(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	if err := CanBook(s, s.InterviewerID, now); err != ErrSelfBooking {
		t.Fatalf("want ErrSelfBooking, got %v", err)
	}
}

func TestCanBook_PastSlotRejected(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(-time.Minute))
	candidate := uuid.New()
	if err := CanBook(s, candidate, now); err != ErrPastStart {
		t.Fatalf("want ErrPastStart, got %v", err)
	}
}

func TestCanBook_NotAvailableRejected(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	s.Status = enums.SlotStatusBooked
	candidate := uuid.New()
	if err := CanBook(s, candidate, now); err != ErrNotAvailable {
		t.Fatalf("want ErrNotAvailable, got %v", err)
	}
}

func TestCanBook_OK(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	s := baseSlot(now.Add(time.Hour))
	candidate := uuid.New()
	if err := CanBook(s, candidate, now); err != nil {
		t.Fatalf("want nil, got %v", err)
	}
}

func TestConflictsWith_Overlap(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	existing := []Slot{
		{
			ID: uuid.New(), StartsAt: base, DurationMin: 60,
			Status: enums.SlotStatusAvailable,
		},
	}
	// Starts mid-way through the first slot → overlap.
	newSlot := Slot{
		ID: uuid.New(), StartsAt: base.Add(30 * time.Minute), DurationMin: 60,
		Status: enums.SlotStatusAvailable,
	}
	if !ConflictsWith(existing, newSlot) {
		t.Fatal("mid-slot overlap must be reported")
	}

	// Touches end exactly → NO overlap (exclusive bound).
	newSlot = Slot{
		ID: uuid.New(), StartsAt: base.Add(60 * time.Minute), DurationMin: 30,
		Status: enums.SlotStatusAvailable,
	}
	if ConflictsWith(existing, newSlot) {
		t.Fatal("back-to-back slot must NOT overlap")
	}

	// Fully disjoint.
	newSlot = Slot{
		ID: uuid.New(), StartsAt: base.Add(2 * time.Hour), DurationMin: 60,
		Status: enums.SlotStatusAvailable,
	}
	if ConflictsWith(existing, newSlot) {
		t.Fatal("disjoint slot must NOT overlap")
	}
}

func TestConflictsWith_IgnoresTerminalStatuses(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	newSlot := Slot{
		ID: uuid.New(), StartsAt: base.Add(30 * time.Minute), DurationMin: 60,
		Status: enums.SlotStatusAvailable,
	}
	for _, term := range []enums.SlotStatus{
		enums.SlotStatusCancelled, enums.SlotStatusCompleted, enums.SlotStatusNoShow,
	} {
		existing := []Slot{
			{
				ID: uuid.New(), StartsAt: base, DurationMin: 60, Status: term,
			},
		}
		if ConflictsWith(existing, newSlot) {
			t.Fatalf("status=%q must be ignored for conflict check", term)
		}
	}
}

func TestSlotEndsAt(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	s := Slot{StartsAt: start, DurationMin: 45}
	want := start.Add(45 * time.Minute)
	if got := s.EndsAt(); !got.Equal(want) {
		t.Fatalf("want %v got %v", want, got)
	}
}
