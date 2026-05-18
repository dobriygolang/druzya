package editor

import (
	"context"
	"encoding/json"
	"errors"
	"go/format"
	"log/slog"
	"net/http"
	"strings"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	editorApp "druz9/editor/app"
	editorDomain "druz9/editor/domain"
	editorInfra "druz9/editor/infra"
	editorPorts "druz9/editor/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/pkg/ratelimit"
	subDomain "druz9/subscription/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewEditor wires the solo code editor surface. Peer-collab dropped: Yjs
// WS hub, freeze gates, invite-link tokens, replay upload, guest-join.
// Что осталось:
//
//   - Connect-RPC: CreateRoom, GetRoom, RunCode, GetVisibility/SetVisibility.
//   - REST aliases for the above + Format + Delete + snapshot save/load.
//
// Frontend single surface — frontend/src/pages/editor/EditorPage.tsx; Hone
// больше не открывает editor inline (B/E hotkey deeplink'и в web).
func NewEditor(d monolithServices.Deps) *monolithServices.Module {
	rooms := editorInfra.NewRooms(d.Pool)
	parts := editorInfra.NewParticipants(d.Pool)

	create := &editorApp.CreateRoom{
		Rooms: rooms, Participants: parts,
		Log: d.Log, Now: d.Now, RoomTTL: 6 * time.Hour,
	}
	get := &editorApp.GetRoom{Rooms: rooms, Participants: parts}
	// Freeze / Invite / Replay use cases — peer-collab artefacts. Still
	// instantiated as nil stubs так что NewEditorServer signature
	// остаётся неизменной (proto RPC declarations не пересобраны). Все
	// эти RPCs возвращают connect.CodeUnimplemented через nil-guard'ы
	// внутри use case'ов (см. editorApp.Freeze.Do / CreateInvite.Do /
	// Replay.Do — ranger возвращает Unimplemented если Notifier == nil).
	var freeze *editorApp.Freeze
	var invite *editorApp.CreateInvite
	var replayUC *editorApp.Replay
	_ = freeze
	_ = invite
	_ = replayUC

	// Judge0 wiring for RunCode. JUDGE0_URL must be set in non-dev profiles —
	// the use case fails loudly otherwise (anti-fallback policy: better an
	// honest 503 with "sandbox unavailable" than a placeholder result).
	var runner editorDomain.CodeRunner
	if u := strings.TrimSpace(d.Cfg.Judge0.URL); u != "" {
		runner = editorInfra.NewJudge0RunClient(u, d.Log)
		d.Log.Info("editor: Judge0 RunCode wired", "url", u)
	} else {
		d.Log.Warn("editor: JUDGE0_URL not set — /editor/room/{id}/run will return 503 (sandbox unavailable)")
		runner = editorInfra.NewJudge0RunClient("", d.Log)
	}

	// Pick the distributed limiter when Redis is available; fall back to
	// the in-memory bucket for dev / CI / single-process runs only.
	var limiter editorDomain.RunCodeRateLimiter
	if d.Redis != nil {
		limiter = editorInfra.NewRedisRunCodeLimiter(
			ratelimit.NewRedisFixedWindow(d.Redis),
			editorInfra.DefaultRunCodeMinuteCap,
			editorInfra.DefaultRunCodeDayCap,
		)
		d.Log.Info("editor: Redis RunCode limiter wired",
			"minute_cap", editorInfra.DefaultRunCodeMinuteCap,
			"day_cap", editorInfra.DefaultRunCodeDayCap)
	} else {
		limiter = editorApp.NewUserRateLimiter(editorInfra.DefaultRunCodeMinuteCap, time.Minute)
		d.Log.Warn("editor: REDIS_URL not set — falling back to in-memory RunCode limiter (single-process only)")
	}
	runUC := &editorApp.RunCode{
		Rooms:        rooms,
		Participants: parts,
		Runner:       runner,
		Limiter:      limiter,
		Now:          d.Now,
	}
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
		create, get, invite, freeze, replayUC, runUC, "", d.Log, editorCreateCheck,
	)
	server.Rooms = rooms // for the visibility GET/SET RPCs

	connectPath, connectHandler := druz9v1connect.NewEditorServiceHandler(server)
	transcoder := monolithServices.MustTranscode("editor", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/editor/room", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/run", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}/visibility", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/visibility", transcoder.ServeHTTP)
			edh := &editorDeleteHandler{
				uc:  &editorApp.DeleteRoom{Rooms: rooms},
				log: d.Log,
			}
			r.Delete("/editor/room/{roomId}", edh.handle)
			fh := &editorFormatHandler{log: d.Log}
			r.Post("/editor/room/{roomId}/format", fh.handle)
			// Solo snapshot persistence.
			sh := &editorSnapshotHandler{rooms: rooms, log: d.Log}
			r.Get("/editor/room/{roomId}/snapshot", sh.get)
			r.Put("/editor/room/{roomId}/snapshot", sh.put)
		},
		// MountPublicREST / MountWS / hub shutdown удалены: guest-join был
		// peer-collab only, WS hub снесён целиком.
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				go subscriptionServices.RunFreeTierShareDowngradeEditor(ctx, d.Pool, d.Log)
			},
		},
	}
}

// ─── Editor delete REST handler ───────────────────────────────────────────
//
// DELETE /api/v1/editor/room/{id}. Owner-only. Каскад удаляет участников
// через FK ON DELETE CASCADE (см. migrations).
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
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.delete: exec", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// editorDomainQuotaField — accessor для domain.QuotaPolicy.ActiveSharedRooms.
func editorDomainQuotaField(p subDomain.QuotaPolicy) int {
	return p.ActiveSharedRooms
}

// ─── Snapshot REST handler ────────────────────────────────────────────────
//
// GET  /api/v1/editor/room/{roomId}/snapshot → {code} | 404
// PUT  /api/v1/editor/room/{roomId}/snapshot   body: {code}
//
// Owner-only write; чтение любому залогиненному (read-only deeplinks).
// Code blob — plain UTF-8 string (no base64, не binary), хранится в
// editor_rooms.code TEXT column.
type editorSnapshotHandler struct {
	rooms editorDomain.RoomRepo
	log   *slog.Logger
}

type editorSnapshotPutRequest struct {
	Code string `json:"code"`
}

type editorSnapshotGetResponse struct {
	Code string `json:"code"`
}

func (h *editorSnapshotHandler) get(w http.ResponseWriter, r *http.Request) {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "roomId"))
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	code, err := h.rooms.GetCode(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.snapshot.get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(editorSnapshotGetResponse{Code: code})
}

func (h *editorSnapshotHandler) put(w http.ResponseWriter, r *http.Request) {
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
	var body editorSnapshotPutRequest
	if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	// Cap on body — обычно <50 KiB; 2 MiB cap защищает от accidental
	// gigabyte uploads.
	if len(body.Code) > 2<<20 {
		http.Error(w, `{"error":{"code":"too_large"}}`, http.StatusRequestEntityTooLarge)
		return
	}
	room, err := h.rooms.Get(r.Context(), roomID)
	if err != nil {
		if errors.Is(err, editorDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "editor.snapshot.put.get", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if room.OwnerID != uid {
		http.Error(w, `{"error":{"code":"forbidden"}}`, http.StatusForbidden)
		return
	}
	if err := h.rooms.SaveCode(r.Context(), roomID, body.Code); err != nil {
		h.log.ErrorContext(r.Context(), "editor.snapshot.put.save", slog.Any("err", err))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Format handler (real gofmt) ─────────────────────────────────────────
//
// POST /api/v1/editor/room/{roomId}/format  body: {code, language}
// → 200 {code: <formatted>, changed: bool, language: "go"|"python"|...}
//
// Только Go формат сейчас (go/format stdlib — то же что gofmt CLI).
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
	_ = uid

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
			resp.Error = err.Error()
		} else {
			s := string(formatted)
			resp.Changed = s != body.Code
			resp.Code = s
		}
	case "python", "language_python", "2",
		"javascript", "language_javascript", "3",
		"typescript", "language_typescript", "4":
		resp.Error = "formatter not available for this language"
	default:
		resp.Error = "unknown language"
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// Compile-time: ensure unused imports are exercised when wire-up still
// references them through transcoder above.
var _ = (*editorApp.GetRoom)(nil)
