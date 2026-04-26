package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

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
	// Scope-aware verify: guest-токены минтятся с Scope="editor:<roomID>"
	// (см. cmd/monolith/services/editor.go editorGuestJoinHandler). Обычные
	// user-токены — Scope="" → VerifyScoped принимает любой room.
	expectedScope := "editor:" + roomID.String()
	uid, jwtRole, _, err := h.Verifier.VerifyScopedFull(token, expectedScope)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	isGuest := jwtRole == "guest"

	// Get room first — нужен для visibility check + auto-join logic.
	room, roomErr := h.Rooms.Get(r.Context(), roomID)
	if roomErr != nil {
		if errors.Is(roomErr, domain.ErrNotFound) {
			http.Error(w, "room not found", http.StatusNotFound)
			return
		}
		h.Log.Warn("editor.ws: rooms.Get", slog.Any("err", roomErr))
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}

	// Visibility=private gate: только owner. Existing participants
	// (которых owner раньше invited когда было shared, потом flipped private)
	// пропускаем через participant-check ниже.
	if isGuest && room.Visibility != domain.VisibilityShared {
		// Guest scope-token валиден, но visibility flipped private после
		// выдачи — отказываем здесь.
		http.Error(w, "private room: guests not allowed", http.StatusForbidden)
		return
	}
	if !isGuest && room.Visibility == domain.VisibilityPrivate && uid != room.OwnerID {
		// Если уже participant — пропускаем. Иначе 403.
		if _, gerr := h.Participants.GetRole(r.Context(), roomID, uid); errors.Is(gerr, domain.ErrNotFound) {
			http.Error(w, "private room: not authorized", http.StatusForbidden)
			return
		}
	}

	// Participant gate с auto-join для shared rooms. Раньше WS требовал
	// существующую participant-row для всех — гость пытался коннектиться
	// и получал 403 «not a participant». Mirror'им whiteboard auto-join:
	// для shared visibility, любой залогиненный юзер при первом WS-connect
	// добавляется как participant (role=participant, не viewer — может
	// edit'ить). У owner'а role=owner всегда (DB-инвариант).
	// Participant gate с auto-join — НЕ для гостей. Guest-token несёт
	// transient UUID который не существует в users; INSERT в
	// editor_participants провалит FK. Guest получает in-memory
	// role=viewer, его cursor живёт только пока WS открыт.
	var role enums.EditorRole
	if isGuest {
		role = enums.EditorRoleViewer
	} else {
		var pErr error
		role, pErr = h.Participants.GetRole(r.Context(), roomID, uid)
		if pErr != nil {
			if !errors.Is(pErr, domain.ErrNotFound) {
				http.Error(w, "internal", http.StatusInternalServerError)
				return
			}
			if room.Visibility != domain.VisibilityShared {
				http.Error(w, "not a participant", http.StatusForbidden)
				return
			}
			_, addErr := h.Participants.Add(r.Context(), domain.Participant{
				RoomID:   roomID,
				UserID:   uid,
				Role:     enums.EditorRoleParticipant,
				JoinedAt: time.Now().UTC(),
			})
			if addErr != nil {
				h.Log.Warn("editor.ws: auto-join failed", slog.Any("err", addErr))
				http.Error(w, "internal", http.StatusInternalServerError)
				return
			}
			role = enums.EditorRoleParticipant
			h.Log.Info("editor.ws.auto_join",
				slog.String("room", roomID.String()),
				slog.String("user", uid.String()),
				slog.String("visibility", string(room.Visibility)))
		}
	}

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

	h.Log.Debug("editor.ws.connect",
		slog.String("room", roomID.String()),
		slog.String("user", uid.String()),
		slog.String("role", string(role)),
		slog.String("visibility", string(room.Visibility)))
	h.Hub.register(roomID, c)
	go c.writeLoop()

	// Hydration: новый клиент получает текущий full Y.Doc state до того как
	// войти в read-loop. Иначе guest на refresh видит пустой ytext (editor
	// был чисто-relay до этого фикса). Mirror whiteboard ws_handler.go
	// pickHydrationBlob pattern. Клиенты периодически шлют kind="snapshot"
	// с Y.encodeStateAsUpdate(ydoc); сервер хранит latest и отдаёт здесь.
	if snap := h.Hub.SnapshotOf(roomID); len(snap) > 0 {
		// []byte → base64 в JSON автоматом (Go стандарт). Клиент видит
		// { kind: "snapshot", data: { payload: "<base64>" } }.
		payload, _ := json.Marshal(opPayload{Payload: snap})
		env, _ := json.Marshal(Envelope{Kind: KindSnapshot, Data: payload})
		c.enqueue(env)
	}

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
