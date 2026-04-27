package editor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/format"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	authApp "druz9/auth/app"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	editorApp "druz9/editor/app"
	editorDomain "druz9/editor/domain"
	editorInfra "druz9/editor/infra"
	editorPorts "druz9/editor/ports"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	subDomain "druz9/subscription/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewEditor wires the collaborative-code editor (bible §3.1): rooms, role
// resolution, invite tokens, replay uploader, freeze + the WS hub. The
// invite secret falls back to the JWT secret when EDITOR_INVITE_SECRET is
// unset — same behaviour as the pre-refactor monolith.
func NewEditor(d monolithServices.Deps) *monolithServices.Module {
	rooms := editorInfra.NewRooms(d.Pool)
	parts := editorInfra.NewParticipants(d.Pool)
	replay := editorInfra.NewStubReplayUploader(d.Cfg.MinIO.Endpoint, time.Hour)
	hub := editorPorts.NewHub(d.Log)
	hub.RoomResolver = rooms.Get
	hub.RoleResolver = parts.GetRole

	inviteSecret := os.Getenv("EDITOR_INVITE_SECRET")
	if inviteSecret == "" {
		inviteSecret = d.Cfg.Auth.JWTSecret
	}

	create := &editorApp.CreateRoom{
		Rooms: rooms, Participants: parts,
		Log: d.Log, Now: d.Now, RoomTTL: 6 * time.Hour,
	}
	get := &editorApp.GetRoom{Rooms: rooms, Participants: parts}
	freeze := &editorApp.Freeze{
		Rooms: rooms, Participants: parts,
		Notifier: hub, Log: d.Log,
	}
	invite := &editorApp.CreateInvite{
		Rooms:   rooms,
		Secret:  []byte(inviteSecret),
		TTL:     24 * time.Hour,
		BaseURL: d.Cfg.Notify.PublicBaseURL,
		Now:     d.Now,
	}
	replayUC := &editorApp.Replay{
		Rooms: rooms, Participants: parts,
		Uploader: replay,
		Flush:    hub.FlushRoom,
	}
	// Judge0 wiring for RunCode. If JUDGE0_URL is empty we still construct
	// the use case with a client whose BaseURL is "" — Run will surface
	// ErrSandboxUnavailable → HTTP 503 with a helpful message, matching the
	// anti-fallback policy used by the daily service.
	var runner editorDomain.CodeRunner
	if u := strings.TrimSpace(d.Cfg.Judge0.URL); u != "" {
		runner = editorInfra.NewJudge0RunClient(u, d.Log)
		d.Log.Info("editor: Judge0 RunCode wired", "url", u)
	} else {
		d.Log.Warn("editor: JUDGE0_URL not set — /editor/room/{id}/run will return 503 (sandbox unavailable)")
		runner = editorInfra.NewJudge0RunClient("", d.Log)
	}
	runUC := &editorApp.RunCode{
		Rooms:        rooms,
		Participants: parts,
		Runner:       runner,
		Limiter:      editorApp.NewUserRateLimiter(10, time.Minute),
		Now:          d.Now,
	}
	// Phase 2 quota check для CreateRoom: free-tier лимит на active shared
	// rooms. nil-safe (см. EnforceCreate semantics).
	editorCreateCheck := func(ctx context.Context, userID uuid.UUID) error {
		return subscriptionServices.EnforceCreate(ctx, d, userID,
			editorDomainQuotaField,
			func(ctx context.Context, uid uuid.UUID) (int, error) {
				if d.QuotaUsageReader == nil {
					return 0, nil
				}
				return d.QuotaUsageReader.CountActiveSharedRooms(ctx, uid)
			})
	}
	server := editorPorts.NewEditorServer(
		create, get, invite, freeze, replayUC, runUC, "/ws/editor", d.Log, editorCreateCheck,
	)
	wsh := editorPorts.NewWSHandler(hub, authServices.EditorTokenVerifier{Issuer: d.TokenIssuer}, rooms, parts, d.Log)

	connectPath, connectHandler := druz9v1connect.NewEditorServiceHandler(server)
	transcoder := monolithServices.MustTranscode("editor", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/editor/room", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/invite", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/freeze", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}/replay", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/run", transcoder.ServeHTTP)
			// Visibility flip + read — mirror whiteboard. Owner-only set.
			ev := &editorVisibilityHandler{rooms: rooms, log: d.Log, quotaCheck: editorCreateCheck}
			r.Get("/editor/room/{roomId}/visibility", ev.get)
			r.Post("/editor/room/{roomId}/visibility", ev.set)
			// DeleteRoom — REST shortcut. Editor domain pока не имеет
			// DeleteRoom RPC в proto (whiteboard_rooms имеет), и регенерация
			// proto + clients тяжёлый change. Inline SQL handler покрывает
			// UX-кейс «owner хочет удалить комнату» без proto-изменений.
			edh := &editorDeleteHandler{
				uc:  &editorApp.DeleteRoom{Rooms: rooms},
				log: d.Log,
			}
			r.Delete("/editor/room/{roomId}", edh.handle)
			// Format — реальный gofmt через go/format std-lib. Inline-handler,
			// не RPC: для format'а не нужны participant-checks (это idempotent
			// transformation), не нужен sandbox, не нужен rate-limit.
			fh := &editorFormatHandler{log: d.Log}
			r.Post("/editor/room/{roomId}/format", fh.handle)
		},
		MountPublicREST: func(r chi.Router) {
			egj := &editorGuestJoinHandler{
				rooms:    rooms,
				parts:    parts,
				issuer:   d.TokenIssuer,
				log:      d.Log,
				guestTTL: 24 * time.Hour,
			}
			r.Post("/editor/room/{roomId}/guest-join", egj.handle)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/editor/{roomId}", wsh.Handle)
		},
		Background: []func(ctx context.Context){
			// Phase 4 — auto-downgrade free-tier shared code-rooms после TTL.
			// Mirror'ит whiteboard cron из quota_enforce.go.
			func(ctx context.Context) {
				go subscriptionServices.RunFreeTierShareDowngradeEditor(ctx, d.Pool, d.Log)
			},
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}

// ─── Editor delete REST handler ───────────────────────────────────────────
//
// DELETE /api/v1/editor/room/{id}. Owner-only. Каскад удаляет участников
// через FK ON DELETE CASCADE (см. migrations). WS hub при следующем
// broadcast'е увидит «room not found» и закроет коннекты.
type editorDeleteHandler struct {
	uc  *editorApp.DeleteRoom
	log *slog.Logger
}

func (h *editorDeleteHandler) handle(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "roomId"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	if err := h.uc.Run(r.Context(), roomID, uid); err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			// Либо не owner, либо room уже не существует. Возвращаем 404 без
			// различения — не утечка инфы про чужие комнаты.
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.delete: exec", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Editor visibility REST handler ───────────────────────────────────────
//
// Mirror whiteboard's visibilityHandler — get/set, owner-only set.

type editorVisibilityHandler struct {
	rooms editorDomain.RoomRepo
	log   *slog.Logger
	// quotaCheck — calls EnforceCreate с editorDomainQuotaField. nil-safe
	// (если subscription module не loaded → permissive). Mirror того же
	// closure'а который CreateRoom использует, чтобы flip private→shared
	// эквивалентно «созданию shared room'ы» с точки зрения quota.
	quotaCheck func(ctx context.Context, userID uuid.UUID) error
}

type editorVisibilityResponse struct {
	Visibility string `json:"visibility"`
}

type editorSetVisibilityRequest struct {
	Visibility string `json:"visibility"`
}

func (h *editorVisibilityHandler) get(w http.ResponseWriter, r *http.Request) {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "roomId"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.visibility.get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	v := room.Visibility
	if v == "" {
		v = editorDomain.VisibilityShared
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(editorVisibilityResponse{Visibility: string(v)})
}

func (h *editorVisibilityHandler) set(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "roomId"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	var body editorSetVisibilityRequest
	if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	v := editorDomain.Visibility(body.Visibility)
	if !v.IsValid() {
		http.Error(w, `{"error":{"code":"bad_visibility"}}`, http.StatusBadRequest)
		return
	}
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.visibility.set: get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if room.OwnerID != uid {
		http.Error(w, `{"error":{"code":"forbidden","message":"only owner can change visibility"}}`,
			http.StatusForbidden)
		return
	}
	// Quota: flip private→shared эквивалентен созданию shared-room'ы. Иначе
	// юзер мог бы обойти лимит создавая комнату как private (без чека) и
	// flip'ая её shared'ом потом. shared→private / shared→shared / etc —
	// quota не проверяем.
	if v == editorDomain.VisibilityShared && room.Visibility != editorDomain.VisibilityShared {
		if h.quotaCheck != nil {
			if qerr := h.quotaCheck(r.Context(), uid); qerr != nil {
				if errors.Is(qerr, subscriptionServices.ErrQuotaExceeded) {
					http.Error(w, `{"error":{"code":"quota_exceeded","message":"shared rooms limit reached on your tier"}}`,
						http.StatusPaymentRequired)
					return
				}
				h.log.WarnContext(r.Context(), "editor.visibility.set: quota check", slog.Any("err", qerr))
			}
		}
	}
	if err := h.rooms.SetVisibility(r.Context(), roomID, v); err != nil {
		h.log.ErrorContext(r.Context(), "editor.visibility.set: write", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(editorVisibilityResponse{Visibility: string(v)})
}

// ─── Editor guest-join REST handler ───────────────────────────────────────
//
// Mirror whiteboard guestJoinHandler. Создаёт ephemeral user-row + adds as
// participant + mints JWT. visibility=private → 403.

type editorGuestJoinHandler struct {
	rooms    editorDomain.RoomRepo
	parts    editorDomain.ParticipantRepo
	issuer   *authApp.TokenIssuer
	log      *slog.Logger
	guestTTL time.Duration
}

type editorGuestJoinRequest struct {
	Name string `json:"name"`
}

type editorGuestJoinResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in_sec"`
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	Role        string `json:"role"`
}

func (h *editorGuestJoinHandler) handle(w http.ResponseWriter, r *http.Request) {
	roomID, err := uuid.Parse(chi.URLParam(r, "roomId"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	var body editorGuestJoinRequest
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

	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.guest_join: rooms.Get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if time.Now().UTC().After(room.ExpiresAt) {
		http.Error(w, `{"error":{"code":"expired"}}`, http.StatusGone)
		return
	}
	if room.Visibility == editorDomain.VisibilityPrivate {
		http.Error(w, `{"error":{"code":"forbidden","message":"private room: guests not allowed"}}`,
			http.StatusForbidden)
		return
	}

	// Wave-15: guest is fully session-only — no INSERT into users, no
	// participants row. Identity = transient UUID + chosen display name
	// carried inside the JWT (`dn` claim). WS handler trusts the JWT
	// scope check; cursor labels come from the client-side awareness
	// state seeded with `dn`.
	guestUUID := uuid.New()

	scope := fmt.Sprintf("editor:%s", roomID.String())
	tok, expiresIn, err := h.issuer.MintScopedWithDisplayName(
		guestUUID, enums.UserRoleGuest, enums.AuthProviderTelegram, scope, name, h.guestTTL,
	)
	if err != nil {
		h.log.ErrorContext(r.Context(), "editor.guest_join: mint", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(editorGuestJoinResponse{
		AccessToken: tok,
		ExpiresIn:   expiresIn,
		UserID:      guestUUID.String(),
		Username:    name,
		Role:        "guest",
	})
}

// editorDomainQuotaField — accessor для domain.QuotaPolicy.ActiveSharedRooms.
// См. whiteboardDomainQuotaField для аналогичного pattern'а в whiteboard_rooms.go.
func editorDomainQuotaField(p subDomain.QuotaPolicy) int {
	return p.ActiveSharedRooms
}

// ─── Format handler (real gofmt) ─────────────────────────────────────────
//
// POST /api/v1/editor/room/{roomId}/format  body: {code, language}
// → 200 {code: <formatted>, changed: bool, language: "go"|"python"|...}
//
// Только Go формат сейчас (go/format stdlib — то же что gofmt CLI). Python
// требует black/yapf binary в runtime (не gotcha — добавим в Phase 2 через
// /usr/bin/python3 -m black). JS/TS — prettier требует node + npm bundle,
// тоже отдельный ticket. Для go/python/js/ts если formatter недоступен —
// отдаём 200 с changed=false, original code, без error'а: UX «format не
// получился» = silent no-op, а не red toast.
type editorFormatHandler struct {
	log *slog.Logger
}

type editorFormatRequest struct {
	Code     string `json:"code"`
	Language string `json:"language"`
}

type editorFormatResponse struct {
	Code     string `json:"code"`
	Changed  bool   `json:"changed"`
	Language string `json:"language"`
	Error    string `json:"error,omitempty"`
}

func (h *editorFormatHandler) handle(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	_ = uid // format non-destructive; participant-check не нужен, любой залогиненный.

	var body editorFormatRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	if body.Code == "" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(editorFormatResponse{Code: "", Changed: false, Language: body.Language})
		return
	}
	lang := strings.ToLower(strings.TrimSpace(body.Language))
	resp := editorFormatResponse{Code: body.Code, Language: lang}
	switch lang {
	case "go", "language_go", "1":
		formatted, err := format.Source([]byte(body.Code))
		if err != nil {
			// Syntax error → возвращаем оригинал + error. UI покажет toast
			// «format failed: <syntax err>», юзер чинит код, повторяет.
			resp.Error = err.Error()
		} else {
			s := string(formatted)
			resp.Changed = s != body.Code
			resp.Code = s
		}
	case "python", "language_python", "2",
		"javascript", "language_javascript", "3",
		"typescript", "language_typescript", "4":
		// Не реализовано — formatter binary'и не bundled. Отдаём original
		// code без error'а; frontend показывает «format unsupported for
		// this language» если хочет, или silent no-op.
		resp.Error = "formatter not available for this language"
	default:
		resp.Error = "unknown language"
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
