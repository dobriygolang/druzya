package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	whiteboardApp "druz9/whiteboard_rooms/app"
	whiteboardDomain "druz9/whiteboard_rooms/domain"
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
			// Visibility flip + read — отдельный REST endpoint без proto
			// regen (proto-добавление поля Room.visibility — отдельный
			// инкремент; пока экспозируем через JSON).
			vis := &visibilityHandler{rooms: rooms, log: d.Log}
			r.Get("/whiteboard/room/{room_id}/visibility", vis.get)
			r.Post("/whiteboard/room/{room_id}/visibility", vis.set)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/whiteboard/{roomId}", wsh.Handle)
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}

// ─── Visibility REST handler ──────────────────────────────────────────────
//
// Минимальный REST поверх RoomRepo для чтения / переключения visibility.
// Owner-check: caller user_id == room.OwnerID. Иначе 403. Этот handler
// существует отдельно (а не как часть Connect-RPC сервиса) чтобы не
// тащить proto-regen ради одного boolean-флага.

type visibilityHandler struct {
	rooms whiteboardDomain.RoomRepo
	log   *slog.Logger
}

type visibilityResponse struct {
	Visibility string `json:"visibility"`
}

type setVisibilityRequest struct {
	Visibility string `json:"visibility"`
}

func (h *visibilityHandler) get(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "room_id"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, whiteboardDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "visibility.get", slog.Any("err", err),
			slog.String("user_id", uid.String()))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	// Read доступен любому участнику (а не только owner'у) — UI правильно
	// показывает badge на чужих rooms тоже. Однако setVisibility — только
	// owner. Здесь просто проверяем что юзер аутентифицирован.
	_ = uid
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(visibilityResponse{Visibility: string(room.Visibility)})
}

func (h *visibilityHandler) set(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "room_id"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	var body setVisibilityRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	v := whiteboardDomain.Visibility(body.Visibility)
	if v != whiteboardDomain.VisibilityPrivate && v != whiteboardDomain.VisibilityShared {
		http.Error(w, `{"error":{"code":"bad_visibility"}}`, http.StatusBadRequest)
		return
	}

	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, whiteboardDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "visibility.set: get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if room.OwnerID != uid {
		http.Error(w, `{"error":{"code":"forbidden","message":"only owner can change visibility"}}`,
			http.StatusForbidden)
		return
	}
	if err := h.rooms.SetVisibility(r.Context(), roomID, v); err != nil {
		h.log.ErrorContext(r.Context(), "visibility.set: write", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(visibilityResponse{Visibility: string(v)})
}
