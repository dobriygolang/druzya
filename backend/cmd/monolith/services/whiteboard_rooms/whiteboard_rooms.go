package whiteboard_rooms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	authApp "druz9/auth/app"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	subDomain "druz9/subscription/domain"
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
func NewWhiteboardRooms(d monolithServices.Deps) *monolithServices.Module {
	rooms := whiteboardInfra.NewRooms(d.Pool)
	parts := whiteboardInfra.NewParticipants(d.Pool)
	handlers := whiteboardApp.NewHandlers(rooms, parts)

	hub := whiteboardPorts.NewHub(d.Log, rooms, handlers)
	wsh := whiteboardPorts.NewWSHandler(
		hub, authServices.WhiteboardTokenVerifier{Issuer: d.TokenIssuer},
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
	// Phase 2: closure для enforce quota'ы перед CreateRoom. nil-safe — при
	// missing QuotaResolver / Usage / TierGetter (subscription not loaded)
	// passthrough'ит без блокировок.
	createCheck := func(ctx context.Context, userID uuid.UUID) error {
		return subscriptionServices.EnforceCreate(ctx, d, userID,
			whiteboardDomainQuotaField,
			func(ctx context.Context, uid uuid.UUID) (int, error) {
				if d.QuotaUsageReader == nil {
					return 0, nil
				}
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
		},
		MountPublicREST: func(r chi.Router) {
			// Guest-join — no-auth endpoint. Принимает имя, выдаёт guest JWT
			// с scope'ом на конкретную room. Handler сам проверяет
			// visibility=private (отказ для гостей) и rate-limit'ит implicit
			// через короткий TTL ephemeral user'а.
			gj := &guestJoinHandler{
				rooms:    rooms,
				issuer:   d.TokenIssuer,
				log:      d.Log,
				guestTTL: 24 * time.Hour,
			}
			r.Post("/whiteboard/room/{room_id}/guest-join", gj.handle)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/whiteboard/{roomId}", wsh.Handle)
		},
		Background: []func(ctx context.Context){
			// Wave-15: ephemeral guest user GC removed — guests are now
			// fully session-only (no INSERT into users), so there's
			// nothing to clean up. The migration that ran with this
			// commit also dropped any historic ephemeral=true rows.

			// Phase 4 — auto-downgrade free-tier shared boards после TTL.
			// Раз в час: shared rooms принадлежащие free-tier owner'ам с
			// expired expires_at → flip visibility='private'. Реализация
			// в quota_enforce.go.
			func(ctx context.Context) {
				go subscriptionServices.RunFreeTierShareDowngradeWhiteboard(ctx, d.Pool, d.Log)
			},
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}

// ─── Guest-join REST handler ──────────────────────────────────────────────
//
// POST /api/v1/whiteboard/room/{room_id}/guest-join {name: "string"}
// Guest flow: создаёт ephemeral user-row (role=guest, ephemeral=true),
// добавляет его в participants, минтит JWT. Token имеет TTL 24h. Доступ
// блокируется если room.visibility=private (только owner может entered).
//
// Этот handler сидит ВНЕ auth chain'а — даже без токена (см.
// router.go MountREST для /whiteboard).

type guestJoinHandler struct {
	rooms    whiteboardDomain.RoomRepo
	issuer   *authApp.TokenIssuer
	log      *slog.Logger
	guestTTL time.Duration
}

type guestJoinRequest struct {
	Name string `json:"name"`
}

type guestJoinResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in_sec"`
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	Role        string `json:"role"`
}

func (h *guestJoinHandler) handle(w http.ResponseWriter, r *http.Request) {
	roomID, err := uuid.Parse(chi.URLParam(r, "room_id"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	var body guestJoinRequest
	if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "guest"
	}
	if len(name) > 40 {
		name = name[:40]
	}

	// Verify room: existence + not expired + not private.
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, whiteboardDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "guest_join: rooms.Get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if time.Now().UTC().After(room.ExpiresAt) {
		http.Error(w, `{"error":{"code":"expired"}}`, http.StatusGone)
		return
	}
	if room.Visibility == whiteboardDomain.VisibilityPrivate {
		http.Error(w, `{"error":{"code":"forbidden","message":"private board: guests not allowed"}}`,
			http.StatusForbidden)
		return
	}

	// Session-only guest: no user-row INSERT, no participants row. The
	// guest's identity lives ENTIRELY inside the JWT (random UUID + the
	// chosen display name in the `display_name` claim). WS handler trusts
	// the JWT scope check to gate room access; cursor labels come from
	// the client-side awareness state seeded with the JWT's display name.
	// FK to users.id is therefore never exercised for guests.
	guestUUID := uuid.New()

	// Mint scoped JWT — Scope привязывает токен к конкретной room. WS handler
	// на upgrade'е проверит что Scope матчит room_id из URL; если злоумышленник
	// возьмёт guest-token room A и попробует подключиться к room B — 403.
	// `name` сохраняется в DisplayName-claim'е, фронт читает его для
	// awareness-cursor'а.
	scope := fmt.Sprintf("whiteboard:%s", roomID.String())
	tok, expiresIn, err := h.issuer.MintScopedWithDisplayName(
		guestUUID, enums.UserRoleGuest, enums.AuthProviderTelegram, scope, name, h.guestTTL,
	)
	if err != nil {
		h.log.ErrorContext(r.Context(), "guest_join: mint", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(guestJoinResponse{
		AccessToken: tok,
		ExpiresIn:   expiresIn,
		UserID:      guestUUID.String(),
		Username:    name,
		Role:        "guest",
	})
}

// whiteboardDomainQuotaField — accessor для domain.QuotaPolicy.ActiveSharedBoards.
// Вынесен top-level чтобы closure в createCheck оставался простым (избегаем
// import цикла between services package and subscription/domain в quota_enforce.go).
func whiteboardDomainQuotaField(p subDomain.QuotaPolicy) int {
	return p.ActiveSharedBoards
}
