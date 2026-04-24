package services

import (
	"context"
	"fmt"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	whiteboardApp "druz9/whiteboard_rooms/app"
	whiteboardInfra "druz9/whiteboard_rooms/infra"
	whiteboardPorts "druz9/whiteboard_rooms/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewWhiteboardRooms wires shared multiplayer whiteboards (bible §9
// Phase 6.5.4). Mirrors editor wiring: Connect service for CRUD,
// raw chi WS for the Yjs relay.
func NewWhiteboardRooms(d Deps) *Module {
	rooms := whiteboardInfra.NewRooms(d.Pool)
	parts := whiteboardInfra.NewParticipants(d.Pool)
	handlers := whiteboardApp.NewHandlers(rooms, parts)

	hub := whiteboardPorts.NewHub(d.Log, rooms, handlers)
	wsh := whiteboardPorts.NewWSHandler(
		hub, whiteboardTokenVerifier{issuer: d.TokenIssuer},
		rooms, parts, d.Log,
	)

	// WS URL builder — public base covers https → wss replacement so the
	// browser client can connect directly without env-specific branching.
	publicBase := d.Cfg.Notify.PublicBaseURL
	wsURL := func(id uuid.UUID) string {
		scheme := "wss"
		host := publicBase
		if len(host) > 7 && host[:7] == "http://" {
			scheme = "ws"
			host = host[7:]
		} else if len(host) > 8 && host[:8] == "https://" {
			host = host[8:]
		}
		return fmt.Sprintf("%s://%s/ws/whiteboard/%s", scheme, host, id.String())
	}
	server := whiteboardPorts.NewWhiteboardRoomsServer(handlers, wsURL, d.Log)

	connectPath, connectHandler := druz9v1connect.NewWhiteboardRoomsServiceHandler(server)
	transcoder := mustTranscode("whiteboard_rooms", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/whiteboard/room", transcoder.ServeHTTP)
			r.Get("/whiteboard/room", transcoder.ServeHTTP)
			r.Get("/whiteboard/room/{room_id}", transcoder.ServeHTTP)
			r.Delete("/whiteboard/room/{room_id}", transcoder.ServeHTTP)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/whiteboard/{roomId}", wsh.Handle)
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}
