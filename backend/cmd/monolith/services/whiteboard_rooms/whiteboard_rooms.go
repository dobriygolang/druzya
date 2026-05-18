package whiteboard_rooms

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	subDomain "druz9/subscription/domain"
	whiteboardApp "druz9/whiteboard_rooms/app"
	whiteboardDomain "druz9/whiteboard_rooms/domain"
	whiteboardInfra "druz9/whiteboard_rooms/infra"
	whiteboardPorts "druz9/whiteboard_rooms/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewWhiteboardRooms wires the whiteboard surface: Connect-RPC CRUD plus the
// solo-persistence REST snapshot endpoint. Web is the only client surface;
// Hone deep-links here.
func NewWhiteboardRooms(d monolithServices.Deps) *monolithServices.Module {
	if d.QuotaUsageReader == nil {
		panic("whiteboard_rooms: QuotaUsageReader is required")
	}
	rooms := whiteboardInfra.NewRooms(d.Pool)
	parts := whiteboardInfra.NewParticipants(d.Pool)
	handlers := whiteboardApp.NewHandlers(rooms, parts)

	// ws_url stays on the EditorRoom DTO for back-compat; the web client
	// ignores it, so we hand back an empty string.
	wsURL := func(_ uuid.UUID) string { return "" }
	// EnforceCreate hooks the free-tier quota check before the room is
	// persisted. QuotaUsageReader is required (asserted above), so the
	// inner closure can rely on it being non-nil.
	createCheck := func(ctx context.Context, userID uuid.UUID) error {
		return subscriptionServices.EnforceCreate(ctx, d, userID,
			whiteboardDomainQuotaField,
			func(ctx context.Context, uid uuid.UUID) (int, error) {
				return d.QuotaUsageReader.CountActiveSharedBoards(ctx, uid)
			})
	}
	server := whiteboardPorts.NewWhiteboardRoomsServer(handlers, wsURL, d.Log, createCheck)

	connectPath, connectHandler := druz9v1connect.NewWhiteboardRoomsServiceHandler(server)
	transcoder := monolithServices.MustTranscode("whiteboard_rooms", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/whiteboard/room", transcoder.ServeHTTP)
			r.Get("/whiteboard/room", transcoder.ServeHTTP)
			r.Get("/whiteboard/room/{room_id}", transcoder.ServeHTTP)
			r.Delete("/whiteboard/room/{room_id}", transcoder.ServeHTTP)
			r.Get("/whiteboard/room/{room_id}/visibility", transcoder.ServeHTTP)
			r.Post("/whiteboard/room/{room_id}/visibility", transcoder.ServeHTTP)
			// Solo snapshot endpoint — hand-rolled REST (not Connect-RPC).
			// GET → {snapshot_b64} | 404. PUT body {snapshot_b64} → 204.
			// Owner-only write; any authenticated user can read.
			sh := &snapshotHandler{rooms: rooms, log: d.Log}
			r.Get("/whiteboard/room/{room_id}/snapshot", sh.get)
			r.Put("/whiteboard/room/{room_id}/snapshot", sh.put)
		},
		Background: []func(ctx context.Context){
			// Auto-downgrade free-tier shared boards once their TTL lapses:
			// hourly tick flips shared rooms owned by free-tier accounts back
			// to private. Implementation lives in subscription quota_enforce.go.
			func(ctx context.Context) {
				go subscriptionServices.RunFreeTierShareDowngradeWhiteboard(ctx, d.Pool, d.Log)
			},
		},
	}
}

// Snapshot REST handler.
//
// GET  /api/v1/whiteboard/room/{room_id}/snapshot → {snapshot_b64} | 404
// PUT  /api/v1/whiteboard/room/{room_id}/snapshot   body: {snapshot_b64}
//
// Snapshot is an opaque base64 blob (raw Excalidraw scene JSON). The server
// does not validate the structure — the web client decides what to serialise.
// Owner-only write; any authenticated user can read (read-only deeplinks).
type snapshotHandler struct {
	rooms whiteboardDomain.RoomRepo
	log   *slog.Logger
}

type snapshotPutRequest struct {
	SnapshotB64 string `json:"snapshot_b64"`
}

type snapshotGetResponse struct {
	SnapshotB64 string `json:"snapshot_b64"`
}

func (h *snapshotHandler) get(w http.ResponseWriter, r *http.Request) {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
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
		h.log.ErrorContext(r.Context(), "whiteboard.snapshot.get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if len(room.Snapshot) == 0 {
		http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snapshotGetResponse{
		SnapshotB64: base64.StdEncoding.EncodeToString(room.Snapshot),
	})
}

func (h *snapshotHandler) put(w http.ResponseWriter, r *http.Request) {
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
	var body snapshotPutRequest
	if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	blob, err := base64.StdEncoding.DecodeString(body.SnapshotB64)
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_b64"}}`, http.StatusBadRequest)
		return
	}
	// Cap on blob size — Excalidraw scenes обычно <100 KiB; 8 MiB hard cap
	// защищает от accidental gigabyte uploads.
	if len(blob) > 8<<20 {
		http.Error(w, `{"error":{"code":"too_large"}}`, http.StatusRequestEntityTooLarge)
		return
	}
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, whiteboardDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "whiteboard.snapshot.put.get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if room.OwnerID != uid {
		http.Error(w, `{"error":{"code":"forbidden"}}`, http.StatusForbidden)
		return
	}
	// Bump expires_at on each save — active rooms живут пока юзер их трогает.
	newExpires := time.Now().UTC().Add(whiteboardDomain.DefaultTTL)
	if err := h.rooms.UpdateSnapshot(r.Context(), roomID, blob, newExpires); err != nil {
		h.log.ErrorContext(r.Context(), "whiteboard.snapshot.put.update", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// whiteboardDomainQuotaField — accessor для domain.QuotaPolicy.ActiveSharedBoards.
// Вынесен top-level чтобы closure в createCheck оставался простым (избегаем
// import цикла between services package and subscription/domain в quota_enforce.go).
func whiteboardDomainQuotaField(p subDomain.QuotaPolicy) int {
	return p.ActiveSharedBoards
}
