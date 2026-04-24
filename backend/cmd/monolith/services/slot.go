package services

import (
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"
	slotApp "druz9/slot/app"
	slotDomain "druz9/slot/domain"
	slotInfra "druz9/slot/infra"
	slotPorts "druz9/slot/ports"

	"github.com/go-chi/chi/v5"
)

// NewSlot wires the human-mock-interview slot bounded context. The
// CreateSlot RPC enforces role=interviewer inside the server itself; the
// gated middleware only ensures bearer auth.
//
// Returns the *Module plus the slot BookingRepo so the caller (bootstrap)
// can pass it into NewReview — the review service needs to look up
// bookings to validate CreateReview requests.
//
// The interviewer-stats hydration on ListSlots and the has_review flag on
// ListMyBookings are wired through the SlotInterviewerStatsAdapter and
// SlotBookingHasReviewAdapter helpers — both safe to construct before
// review's pg is live (they degrade to "no rating" / has_review=false).
func NewSlot(d Deps) (*Module, slotDomain.BookingRepo) {
	if d.Log == nil {
		panic("slot: nil logger")
	}
	pg := slotInfra.NewPostgres(d.Pool)
	meet := slotInfra.NewMockMeetRoom()
	create := &slotApp.CreateSlot{Slots: pg, Now: time.Now}
	list := &slotApp.ListSlots{Slots: pg, Reviews: SlotInterviewerStatsAdapter{}}
	book := &slotApp.BookSlot{Slots: pg, Meet: meet, Bus: d.Bus, Log: d.Log, Now: time.Now}
	cancelUC := &slotApp.CancelSlot{Slots: pg, Bus: d.Bus, Log: d.Log}
	myBookings := &slotApp.ListMyBookings{Bookings: pg, HasReview: SlotBookingHasReviewAdapter{}}
	hostedBookings := &slotApp.ListHostedBookings{Bookings: pg, HasReview: SlotBookingHasReviewAdapter{}}
	server := slotPorts.NewSlotServer(list, create, book, cancelUC, myBookings, hostedBookings, d.Log)

	connectPath, connectHandler := druz9v1connect.NewSlotServiceHandler(server)
	transcoder := mustTranscode("slot", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/slot", transcoder.ServeHTTP)
			r.Post("/slot", transcoder.ServeHTTP)
			r.Post("/slot/{slotId}/book", transcoder.ServeHTTP)
			r.Delete("/slot/{slotId}/cancel", transcoder.ServeHTTP)
			// /slot/my/bookings now goes through the proto transcoder
			// (ListMyBookings RPC) — no more chi-direct shim.
			r.Get("/slot/my/bookings", transcoder.ServeHTTP)
			r.Get("/slot/my/hosted", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { slotApp.SubscribeHandlers(b) },
		},
	}, pg
}
