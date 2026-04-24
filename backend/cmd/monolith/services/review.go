// Package services — wiring for the review (mock-interview feedback) bounded
// context. Owns the `reviews` table and exposes three RPCs:
//
//	POST   /api/v1/review                       — CreateReview (auth)
//	GET    /api/v1/review                       — ListReviewsByInterviewer
//	GET    /api/v1/review/stats/{interviewer_id}— GetInterviewerStats
//
// The slot service consumes review aggregates via the SlotReviewBridge
// helpers below — these adapters are the only cross-service couplings;
// the database layer stays single-owner per service.
package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	reviewApp "druz9/review/app"
	reviewDomain "druz9/review/domain" //nolint:gci
	reviewInfra "druz9/review/infra"
	reviewPorts "druz9/review/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	slotDomain "druz9/slot/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// reviewLive is populated by NewReview and consumed by the SlotReviewBridge
// adapters that slot's wiring later passes into ListSlots / ListMyBookings.
// Package-level singleton because the monolith only ever wires one review
// instance per process.
var reviewLive struct {
	StatsUC *reviewApp.GetInterviewerStats
	Repo    reviewDomain.ReviewRepo
}

// SlotBookingLookup wraps slot's BookingRepo to satisfy review's
// BookingLookup port. Lives here (not in slot or review) because it's
// the only place that knows about both sides.
type SlotBookingLookup struct {
	Bookings slotDomain.BookingRepo
}

// LookupBooking satisfies reviewApp.BookingLookup.
func (s SlotBookingLookup) LookupBooking(ctx context.Context, bookingID uuid.UUID) (reviewApp.BookingMeta, error) {
	bw, err := s.Bookings.GetWithSlotByID(ctx, bookingID)
	if err != nil {
		// Map slot's not-found to review's so CreateReview can surface a
		// clean 404 instead of leaking the slot-side sentinel.
		if errors.Is(err, slotDomain.ErrBookingNotFound) || errors.Is(err, slotDomain.ErrNotFound) {
			return reviewApp.BookingMeta{}, reviewDomain.ErrNotFound
		}
		return reviewApp.BookingMeta{}, fmt.Errorf("slot booking lookup: %w", err)
	}
	return reviewApp.BookingMeta{
		BookingID:     bw.Booking.ID,
		CandidateID:   bw.Booking.CandidateID,
		InterviewerID: bw.Slot.InterviewerID,
		SlotStatus:    string(bw.Slot.Status),
	}, nil
}

// NewReview wires the review bounded context. Slot's BookingRepo is
// supplied as a parameter — bootstrap must call NewSlot first to construct
// the repo, then pass it here.
func NewReview(d Deps, slotBookings slotDomain.BookingRepo) *Module {
	if d.Log == nil {
		panic("review: nil logger")
	}
	if slotBookings == nil {
		panic("review: nil slotBookings — slot must be wired before review")
	}
	pg := reviewInfra.NewPostgres(d.Pool)

	create := &reviewApp.CreateReview{
		Reviews:  pg,
		Bookings: SlotBookingLookup{Bookings: slotBookings},
		Now:      time.Now,
	}
	list := &reviewApp.ListByInterviewer{Reviews: pg}
	stats := &reviewApp.GetInterviewerStats{Reviews: pg}

	server := reviewPorts.NewReviewServer(create, list, stats, d.Log)
	connectPath, connectHandler := druz9v1connect.NewReviewServiceHandler(server)
	transcoder := mustTranscode("review", connectPath, connectHandler)

	// Stash for slot's adapters.
	reviewLive.StatsUC = stats
	reviewLive.Repo = pg

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/review", transcoder.ServeHTTP)
			r.Get("/review", transcoder.ServeHTTP)
			r.Get("/review/stats/{interviewer_id}", transcoder.ServeHTTP)
		},
	}
}

// SlotInterviewerStatsAdapter satisfies slot.domain.ReviewRepo by delegating
// to review.app.GetInterviewerStats. Tiny on purpose — the slot domain only
// needs (avg, count) per interviewer.
type SlotInterviewerStatsAdapter struct{}

func (SlotInterviewerStatsAdapter) InterviewerStats(ctx context.Context, interviewerID uuid.UUID) (float32, int, error) {
	if reviewLive.StatsUC == nil {
		// Review module not wired yet — degrade gracefully (slot card just
		// shows "Нет рейтинга") instead of crashing the listing.
		return 0, 0, nil
	}
	st, err := reviewLive.StatsUC.Do(ctx, interviewerID)
	if err != nil {
		return 0, 0, fmt.Errorf("review stats: %w", err)
	}
	return st.AvgRating, st.ReviewsCount, nil
}

// SlotBookingHasReviewAdapter satisfies slot.domain.BookingHasReviewProvider.
// Direction is passed through as a string (slot has no direct dep on
// review.domain) and parsed back into the typed enum here.
type SlotBookingHasReviewAdapter struct{}

func (SlotBookingHasReviewAdapter) HasReview(ctx context.Context, bookingID uuid.UUID, direction string) (bool, error) {
	if reviewLive.Repo == nil {
		return false, nil
	}
	dir := reviewDomain.Direction(direction)
	if !dir.IsValid() {
		dir = reviewDomain.DirCandidateToInterviewer
	}
	has, err := reviewLive.Repo.HasReview(ctx, bookingID, dir)
	if err != nil {
		return false, fmt.Errorf("review has-review: %w", err)
	}
	return has, nil
}

// Compile-time assertions.
var (
	_ slotDomain.ReviewRepo               = SlotInterviewerStatsAdapter{}
	_ slotDomain.BookingHasReviewProvider = SlotBookingHasReviewAdapter{}
	_ reviewApp.BookingLookup             = SlotBookingLookup{}
)
