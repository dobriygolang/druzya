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
	// Scope-aware verify: guest-токены минтятся с Scope="whiteboard:<roomID>"
	// (см. cmd/monolith/services/whiteboard_rooms.go guestJoinHandler.handle).
	// Для обычных user-токенов Scope пустой → VerifyScoped пропускает (см.
	// parseSubjectScoped в adapters.go). Cross-room replay guest-token'а ловим
	// здесь — token room A → mismatch → 401.
	expectedScope := "whiteboard:" + roomID.String()
	uid, jwtRole, _, err := h.Verifier.VerifyScopedFull(token, expectedScope)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	isGuest := jwtRole == "guest"

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

	if isGuest {
		// Wave-15: гость не имеет participant-row; идентичность —
		// transient UUID в JWT. Visibility-проверка единственная защита
		// от cross-room replay (guest-scope уже сверили).
		if room.Visibility != domain.VisibilityShared {
			http.Error(w, "private board: guests not allowed", http.StatusForbidden)
			return
		}
	} else {
		// Participant gate — share-link UX: owner is seeded at create.
		ok, pErr := h.Participants.Exists(r.Context(), roomID, uid)
		if pErr != nil {
			h.Log.Warn("whiteboard_rooms.ws: Participants.Exists", slog.Any("err", pErr))
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "not a participant", http.StatusForbidden)
			return
		}
		if room.Visibility == domain.VisibilityPrivate && uid != room.OwnerID {
			http.Error(w, "private board: not authorized", http.StatusForbidden)
			return
		}
	}

	ws, err := h.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("whiteboard_rooms.ws: upgrade failed", slog.Any("err", err))
		return
	}

	c := newWSConn(ws, roomID, uid, h.Log)
	h.Hub.register(roomID, c)
	go c.writeLoop()

	// DEBUG: лог connect — даёт понять «зашёл ли guest вообще» и сколько
	// peers сейчас в комнате. Грепай в проде: `wb.ws.connect`.
	h.Hub.mu.RLock()
	rh := h.Hub.rooms[roomID]
	h.Hub.mu.RUnlock()
	peers := 0
	if rh != nil {
		rh.mu.RLock()
		peers = len(rh.clients)
		rh.mu.RUnlock()
	}
	h.Log.Debug("wb.ws.connect",
		slog.String("room", roomID.String()),
		slog.String("user", uid.String()),
		slog.Int("peers_after", peers),
		slog.String("visibility", string(room.Visibility)))

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
