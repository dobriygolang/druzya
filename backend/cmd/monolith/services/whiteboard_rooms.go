package services

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
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	subDomain "druz9/subscription/domain"
	whiteboardApp "druz9/whiteboard_rooms/app"
	whiteboardDomain "druz9/whiteboard_rooms/domain"
	whiteboardInfra "druz9/whiteboard_rooms/infra"
	whiteboardPorts "druz9/whiteboard_rooms/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
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
	// Phase 2: closure для enforce quota'ы перед CreateRoom. nil-safe — при
	// missing QuotaResolver / Usage / TierGetter (subscription not loaded)
	// passthrough'ит без блокировок.
	createCheck := func(ctx context.Context, userID uuid.UUID) error {
		return EnforceCreate(ctx, d, userID,
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
		MountPublicREST: func(r chi.Router) {
			// Guest-join — no-auth endpoint. Принимает имя, выдаёт guest JWT
			// с scope'ом на конкретную room. Handler сам проверяет
			// visibility=private (отказ для гостей) и rate-limit'ит implicit
			// через короткий TTL ephemeral user'а.
			gj := &guestJoinHandler{
				rooms:    rooms,
				parts:    parts,
				pool:     d.Pool,
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
			// Cron-GC orphan guest user-row'ов. Guest создаётся через
			// guest-join (ephemeral=true), participants link его к одной
			// конкретной room. Когда room удаляется или expires + cleanup'ится,
			// participant cascade-удаляется (FK ON DELETE CASCADE), но user-row
			// остаётся orphaned. Этот GC чистит таких — раз в час WHERE
			// ephemeral=true AND нет ссылок ни в whiteboard_room_participants,
			// ни в editor_participants.
			func(ctx context.Context) {
				go runEphemeralUsersGC(ctx, d.Pool, d.Log, time.Hour)
			},
			// Phase 4 — auto-downgrade free-tier shared boards после TTL.
			// Раз в час: shared rooms принадлежащие free-tier owner'ам с
			// expired expires_at → flip visibility='private'. Реализация
			// в quota_enforce.go.
			func(ctx context.Context) {
				go runFreeTierShareDowngradeWhiteboard(ctx, d.Pool, d.Log)
			},
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}

// runEphemeralUsersGC периодически удаляет ephemeral users (role='guest',
// ephemeral=true), на которых уже не ссылается ни одна participants table.
// Idempotent — DELETE с пустым result-set'ом просто no-op'ит.
//
// Защита от race: используем NOT EXISTS вместо NOT IN — корректно при
// concurrent INSERT'ах в participants. Также включён LIMIT через CTE чтобы
// один проход не гасил тысячи записей и не вешал репликацию.
func runEphemeralUsersGC(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	// Первый прогон через 5 минут после старта (даём приложению прогреться).
	first := time.NewTimer(5 * time.Minute)
	defer first.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-first.C:
			gcEphemeralUsersOnce(ctx, pool, log)
		case <-tick.C:
			gcEphemeralUsersOnce(ctx, pool, log)
		}
	}
}

func gcEphemeralUsersOnce(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	const q = `
		WITH orphans AS (
			SELECT u.id
			FROM users u
			WHERE u.ephemeral = TRUE
			  AND u.role = 'guest'
			  AND NOT EXISTS (
				  SELECT 1 FROM whiteboard_room_participants wp
				  WHERE wp.user_id = u.id
			  )
			  AND NOT EXISTS (
				  SELECT 1 FROM editor_participants ep
				  WHERE ep.user_id = u.id
			  )
			LIMIT 500
		)
		DELETE FROM users WHERE id IN (SELECT id FROM orphans)`
	tag, err := pool.Exec(ctx, q)
	if err != nil {
		log.WarnContext(ctx, "ephemeral_users_gc: delete failed", slog.Any("err", err))
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		log.InfoContext(ctx, "ephemeral_users_gc: removed orphans", slog.Int64("count", n))
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
	if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
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
	parts    whiteboardDomain.ParticipantRepo
	pool     *pgxpool.Pool
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

	// Create ephemeral user row. Username unique constraint → дедуплицируем
	// short-suffix'ом (последние 8 символов нового uuid). Email NULL (его
	// схема позволяет — UNIQUE на email допускает NULL).
	guestUUID := uuid.New()
	usernameSuffix := strings.ReplaceAll(guestUUID.String(), "-", "")[:8]
	username := fmt.Sprintf("%s_g%s", sanitizeUsername(name), usernameSuffix)

	_, err = h.pool.Exec(r.Context(),
		`INSERT INTO users (id, username, display_name, role, ephemeral, created_at, updated_at)
		 VALUES ($1, $2, $3, 'guest', TRUE, now(), now())`,
		guestUUID, username, name)
	if err != nil {
		h.log.ErrorContext(r.Context(), "guest_join: insert user", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}

	// Add as participant.
	if _, addErr := h.parts.Add(r.Context(), whiteboardDomain.Participant{
		RoomID:   roomID,
		UserID:   guestUUID,
		JoinedAt: time.Now().UTC(),
	}); addErr != nil {
		h.log.ErrorContext(r.Context(), "guest_join: parts.Add", slog.Any("err", addErr))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}

	// Mint scoped JWT — Scope привязывает токен к конкретной room. WS handler
	// на upgrade'е проверит что Scope матчит room_id из URL; если злоумышленник
	// возьмёт guest-token room A и попробует подключиться к room B — 403.
	scope := fmt.Sprintf("whiteboard:%s", roomID.String())
	tok, expiresIn, err := h.issuer.MintScoped(
		guestUUID, enums.UserRoleGuest, enums.AuthProviderTelegram, scope, h.guestTTL,
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

// sanitizeUsername — оставляет только [a-z0-9_], lowercase, max 16 чаров.
// Для guest'ов составляем username = sanitized(name) + "_g" + uuid_suffix,
// чтобы был UNIQUE-friendly и читаемый при просмотре participants.
func sanitizeUsername(name string) string {
	name = strings.ToLower(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '-':
			b.WriteRune('_')
		}
		if b.Len() >= 16 {
			break
		}
	}
	if b.Len() == 0 {
		return "guest"
	}
	return b.String()
}

// whiteboardDomainQuotaField — accessor для domain.QuotaPolicy.ActiveSharedBoards.
// Вынесен top-level чтобы closure в createCheck оставался простым (избегаем
// import цикла between services package and subscription/domain в quota_enforce.go).
func whiteboardDomainQuotaField(p subDomain.QuotaPolicy) int {
	return p.ActiveSharedBoards
}
