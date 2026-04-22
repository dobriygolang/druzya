package services

import (
	"time"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"
	slotApp "druz9/slot/app"
	slotInfra "druz9/slot/infra"
	slotPorts "druz9/slot/ports"

	"github.com/go-chi/chi/v5"
)

// NewSlot wires the human-mock-interview slot bounded context. The
// CreateSlot RPC enforces role=interviewer inside the server itself; the
// gated middleware only ensures bearer auth.
func NewSlot(d Deps) *Module {
	pg := slotInfra.NewPostgres(d.Pool)
	meet := slotInfra.NewMockMeetRoom()
	create := &slotApp.CreateSlot{Slots: pg, Now: time.Now}
	list := &slotApp.ListSlots{Slots: pg, Reviews: pg}
	book := &slotApp.BookSlot{Slots: pg, Meet: meet, Bus: d.Bus, Log: d.Log, Now: time.Now}
	cancelUC := &slotApp.CancelSlot{Slots: pg, Bus: d.Bus, Log: d.Log}
	server := slotPorts.NewSlotServer(list, create, book, cancelUC, d.Log)

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
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { slotApp.SubscribeHandlers(b) },
		},
	}
}
