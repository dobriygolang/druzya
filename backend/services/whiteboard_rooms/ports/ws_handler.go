package ports

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/whiteboard_rooms/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WSHandler serves GET /ws/whiteboard/{roomId}.
type WSHandler struct {
	Hub          *Hub
	Verifier     domain.TokenVerifier
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Log          *slog.Logger

	Upgrader websocket.Upgrader
}

// NewWSHandler constructs the handler with a permissive CheckOrigin.
// STUB: tighten CheckOrigin before production (mirrors editor/ws_handler.go).
func NewWSHandler(hub *Hub, ver domain.TokenVerifier, rooms domain.RoomRepo, parts domain.ParticipantRepo, log *slog.Logger) *WSHandler {
	return &WSHandler{
		Hub: hub, Verifier: ver, Rooms: rooms, Participants: parts, Log: log,
		Upgrader: websocket.Upgrader{
			ReadBufferSize:  8192,
			WriteBufferSize: 8192,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// Handle upgrades the connection and serves the client.
func (h *WSHandler) Handle(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "roomId")
	roomID, err := uuid.Parse(raw)
	if err != nil {
		http.Error(w, "bad room id", http.StatusBadRequest)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}
	if token == "" || h.Verifier == nil {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	uid, err := h.Verifier.Verify(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	// Participant gate — share-link UX: owner is seeded at create, guest is
	// seeded on first GET /whiteboard/room/{id} (see app.GetRoom). If the
	// client jumped straight to WS without the REST join, reject.
	ok, err := h.Participants.Exists(r.Context(), roomID, uid)
	if err != nil {
		h.Log.Warn("whiteboard_rooms.ws: Participants.Exists", slog.Any("err", err))
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "not a participant", http.StatusForbidden)
		return
	}

	room, err := h.Rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			http.Error(w, "room not found", http.StatusNotFound)
			return
		}
		h.Log.Warn("whiteboard_rooms.ws: Rooms.Get", slog.Any("err", err))
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}

	// Visibility=private gate (defense in depth — same check as in
	// app.GetRoom). Owner всегда пускаем; existing participants (которых
	// owner раньше invited когда было shared) тоже пускаем — мы их не
	// вырезаем при flip'е private. Все остальные → 403.
	if room.Visibility == domain.VisibilityPrivate && uid != room.OwnerID {
		http.Error(w, "private board: not authorized", http.StatusForbidden)
		return
	}

	ws, err := h.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("whiteboard_rooms.ws: upgrade failed", slog.Any("err", err))
		return
	}

	c := newWSConn(ws, roomID, uid, h.Log)
	h.Hub.register(roomID, c)
	go c.writeLoop()

	// Hydrate the new client before entering the read loop: prefer the in-
	// memory lastFullSnapshot (most recent edit still warm in the hub),
	// fall back to the Postgres blob for cold rooms.
	if hydrate := pickHydrationBlob(h.Hub, roomID, room.Snapshot); len(hydrate) > 0 {
		env, _ := json.Marshal(Envelope{
			Kind: "snapshot",
			Data: mustRawSnapshot(hydrate),
		})
		c.enqueue(env)
	}

	h.Hub.readLoop(r.Context(), c)
}

func pickHydrationBlob(hub *Hub, roomID uuid.UUID, fallback []byte) []byte {
	hub.mu.RLock()
	rh := hub.rooms[roomID]
	hub.mu.RUnlock()
	if rh != nil {
		rh.mu.RLock()
		warm := rh.lastFullSnapshot
		rh.mu.RUnlock()
		if len(warm) > 0 {
			return warm
		}
	}
	return fallback
}

func mustRawSnapshot(blob []byte) json.RawMessage {
	b, _ := json.Marshal(snapshotPayload{Update: base64.StdEncoding.EncodeToString(blob)})
	return b
}
