package services

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"
	sharedMw "druz9/shared/pkg/middleware"
	slotApp "druz9/slot/app"
	"druz9/slot/domain"
	slotInfra "druz9/slot/infra"
	slotPorts "druz9/slot/ports"

	"github.com/go-chi/chi/v5"
)

// NewSlot wires the human-mock-interview slot bounded context. The
// CreateSlot RPC enforces role=interviewer inside the server itself; the
// gated middleware only ensures bearer auth.
func NewSlot(d Deps) *Module {
	if d.Log == nil {
		panic("slot: nil logger")
	}
	pg := slotInfra.NewPostgres(d.Pool)
	meet := slotInfra.NewMockMeetRoom()
	create := &slotApp.CreateSlot{Slots: pg, Now: time.Now}
	list := &slotApp.ListSlots{Slots: pg, Reviews: pg}
	book := &slotApp.BookSlot{Slots: pg, Meet: meet, Bus: d.Bus, Log: d.Log, Now: time.Now}
	cancelUC := &slotApp.CancelSlot{Slots: pg, Bus: d.Bus, Log: d.Log}
	server := slotPorts.NewSlotServer(list, create, book, cancelUC, d.Log)

	connectPath, connectHandler := druz9v1connect.NewSlotServiceHandler(server)
	transcoder := mustTranscode("slot", connectPath, connectHandler)

	bh := &bookingsHandler{repo: pg, log: d.Log}

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/slot", transcoder.ServeHTTP)
			r.Post("/slot", transcoder.ServeHTTP)
			r.Post("/slot/{slotId}/book", transcoder.ServeHTTP)
			r.Delete("/slot/{slotId}/cancel", transcoder.ServeHTTP)
			// /slot/my/bookings — chi-direct (without proto) because it has
			// no analogue in slot.proto today; adding a new RPC requires
			// proto regen which is out of scope for this slice.
			r.Get("/slot/my/bookings", bh.listMine)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { slotApp.SubscribeHandlers(b) },
		},
	}
}

// bookingsHandler exposes per-candidate booking reads via direct chi without
// going through the Connect transcoder. Lives here (alongside wiring) since
// it's a thin shell over BookingRepo.ListByCandidate with no domain logic.
type bookingsHandler struct {
	repo domain.BookingRepo
	log  *slog.Logger
}

type bookingItemDTO struct {
	ID          string `json:"id"`
	SlotID      string `json:"slot_id"`
	MeetURL     string `json:"meet_url,omitempty"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
	StartsAt    string `json:"starts_at"`
	DurationMin int    `json:"duration_min"`
	Section     string `json:"section"`
	Difficulty  string `json:"difficulty,omitempty"`
	Language    string `json:"language"`
	PriceRub    int    `json:"price_rub"`
	SlotStatus  string `json:"slot_status"`
}

type myBookingsResponse struct {
	Items []bookingItemDTO `json:"items"`
}

func (h *bookingsHandler) listMine(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	rows, err := h.repo.ListByCandidate(r.Context(), uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSON(w, http.StatusOK, myBookingsResponse{Items: []bookingItemDTO{}})
			return
		}
		h.log.ErrorContext(r.Context(), "slot.listMine", slog.Any("err", err))
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	out := myBookingsResponse{Items: make([]bookingItemDTO, 0, len(rows))}
	for _, bw := range rows {
		item := bookingItemDTO{
			ID:          bw.Booking.ID.String(),
			SlotID:      bw.Booking.SlotID.String(),
			MeetURL:     bw.Booking.MeetURL,
			Status:      bw.Booking.Status,
			CreatedAt:   bw.Booking.CreatedAt.UTC().Format(time.RFC3339),
			StartsAt:    bw.Slot.StartsAt.UTC().Format(time.RFC3339),
			DurationMin: bw.Slot.DurationMin,
			Section:     string(bw.Slot.Section),
			Language:    bw.Slot.Language,
			PriceRub:    bw.Slot.PriceRub,
			SlotStatus:  string(bw.Slot.Status),
		}
		if bw.Slot.Difficulty != nil {
			item.Difficulty = string(*bw.Slot.Difficulty)
		}
		out.Items = append(out.Items, item)
	}
	writeJSON(w, http.StatusOK, out)
}
