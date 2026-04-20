package ports

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// WSHandler serves GET /ws/editor/{roomId}.
//
// Auth happens at the handshake via `?token=<JWT>` — browsers can't set
// Authorization reliably for ws:// upgrades, so this is the only path.
type WSHandler struct {
	Hub          *Hub
	Verifier     domain.TokenVerifier
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Log          *slog.Logger

	Upgrader websocket.Upgrader
}

// NewWSHandler constructs a handler with a permissive Upgrader.
//
// STUB: Upgrader.CheckOrigin currently allows everything — tighten before
// production (same TODO as arena/mock).
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

// Handle upgrades the connection and serves the client. Registered as
// `r.Get("/editor/{roomId}", hub.Handle)` next to arena/mock WS routes.
func (h *WSHandler) Handle(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "roomId")
	roomID, err := uuid.Parse(raw)
	if err != nil {
		http.Error(w, "bad room id", http.StatusBadRequest)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		// Fallback: Authorization: Bearer ... for non-browser clients.
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

	// Participant gate — the caller must already be in the room. Owner is
	// auto-seeded on create; invitees are added when they accept the HMAC
	// link (HTTP endpoint wiring; out of scope for this PR).
	role, err := h.Participants.GetRole(r.Context(), roomID, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			http.Error(w, "not a participant", http.StatusForbidden)
			return
		}
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	// Also bail early if the room is missing (participant was deleted first).
	room, err := h.Rooms.Get(r.Context(), roomID)
	if err != nil {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	_ = room // room state is consulted on each op via Hub.RoomResolver

	ws, err := h.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("editor.ws: upgrade failed", slog.Any("err", err))
		return
	}

	// Resolvers that the hub uses on every op.
	if h.Hub.RoomResolver == nil {
		h.Hub.RoomResolver = h.Rooms.Get
	}
	if h.Hub.RoleResolver == nil {
		h.Hub.RoleResolver = h.Participants.GetRole
	}

	c := newWSConn(ws, roomID, uid, role, h.Log)
	h.Hub.register(roomID, c)
	go c.writeLoop()
	h.Hub.readLoop(r.Context(), c)
}

// Compile-time — Hub must satisfy app.FreezeNotifier. Import left implicit:
// the interface is defined inside app and duck-typed here by method name.
var _ interface {
	BroadcastFreeze(roomID uuid.UUID, frozen bool, actor uuid.UUID)
} = (*Hub)(nil)

// Compile-time — ensure enums.EditorRole is actually used in this file so
// the import is never pruned by a future refactor.
var _ enums.EditorRole = enums.EditorRoleOwner
