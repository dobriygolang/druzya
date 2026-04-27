// Package sync — monolith wiring + thin HTTP handlers for the sync bounded
// context (druz9/sync module). Endpoints: device CRUD + pull/push
// replication. Heartbeat type lives in heartbeat.go, SSE broker in
// broker.go (both same package). Cross-package consumption goes through
// narrow services.SyncBroker / services.SyncHeartbeatGate interfaces in
// services/types.go — Deps holds those interfaces, не concrete types.
//
// Constructors exported for bootstrap:
//
//	NewSync          → device CRUD + replication routes + tombstone GC + Heartbeat
//	NewSyncEvents    → SSE broker module + Broker
package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	sharedMw "druz9/shared/pkg/middleware"
	syncApp "druz9/sync/app"
	syncDomain "druz9/sync/domain"
	syncInfra "druz9/sync/infra"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewSync wires the sync foundation module + builds the heartbeat
// middleware that router.go consumes via Deps.SyncHeartbeat.
//
// Mounts:
//   - POST /sync/devices              → register
//   - GET  /sync/devices              → list
//   - POST /sync/devices/{id}/revoke  → revoke
//   - POST /sync/pull                 → replication pull
//   - POST /sync/push                 → replication push
//
// Background:
//   - tombstone GC tick (24h, 90d retention)
func NewSync(d monolithServices.Deps) (*monolithServices.Module, *Heartbeat) {
	devices := syncInfra.NewDevices(d.Pool)
	repl := syncInfra.NewReplication(d.Pool)
	catalog := syncInfra.NewCatalog()

	registerUC := &syncApp.RegisterDevice{Devices: devices}
	listUC := &syncApp.ListDevices{Devices: devices}
	revokeUC := &syncApp.RevokeDevice{Devices: devices}
	checkUC := &syncApp.CheckRevoked{Devices: devices}
	heartbeatUC := &syncApp.Heartbeat{Devices: devices}
	pullUC := &syncApp.PullChanges{Repo: repl, Catalog: catalog}
	pushUC := &syncApp.PushChanges{Repo: repl, Catalog: catalog, Publisher: brokerAdapter{d.SyncEventBroker}}
	pruneUC := &syncApp.PruneTombstones{Repo: repl, Retention: 90 * 24 * time.Hour}

	h := &syncHandler{log: d.Log, register: registerUC, list: listUC, revoke: revokeUC}
	replH := &replicationHandler{log: d.Log, pull: pullUC, push: pushUC, catalog: catalog}

	hb := &Heartbeat{
		Log:       d.Log,
		LastTouch: make(map[uuid.UUID]time.Time),
		Throttle:  5 * time.Minute,
		CheckRevokedFn: func(ctx context.Context, userID, deviceID uuid.UUID) error {
			err := checkUC.Run(ctx, userID, deviceID)
			switch {
			case err == nil:
				return nil
			case errors.Is(err, syncDomain.ErrDeviceRevoked):
				return ErrDeviceRevoked
			case errors.Is(err, syncDomain.ErrNotFound):
				return ErrUnknownDevice
			default:
				return fmt.Errorf("sync.heartbeat.checkRevoked: %w", err)
			}
		},
		TouchFn: func(ctx context.Context, deviceID uuid.UUID) error {
			if err := heartbeatUC.Run(ctx, deviceID); err != nil {
				return fmt.Errorf("sync.heartbeat.touch: %w", err)
			}
			return nil
		},
	}

	gc := &tombstoneGC{log: d.Log, uc: pruneUC, interval: 24 * time.Hour}

	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Post("/sync/devices", h.handleRegister)
			r.Get("/sync/devices", h.handleList)
			r.Post("/sync/devices/{id}/revoke", h.handleRevoke)
			r.Post("/sync/pull", replH.handlePull)
			r.Post("/sync/push", replH.handlePush)
		},
		Background: []func(ctx context.Context){
			// `go` обязателен — bootstrap зовёт Background синхронно
			// (см. App.Run). gc.Run блокирует на ticker-loop'е.
			func(ctx context.Context) { go gc.Run(ctx) },
		},
	}, hb
}

// syncHandler — thin HTTP layer over device use-cases.
type syncHandler struct {
	log      *slog.Logger
	register *syncApp.RegisterDevice
	list     *syncApp.ListDevices
	revoke   *syncApp.RevokeDevice
}

// ─── DTOs ─────────────────────────────────────────────────────────────────

type registerDeviceRequest struct {
	Name       string `json:"name"`
	Platform   string `json:"platform"`
	AppVersion string `json:"appVersion"`
}

type deviceResponse struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Platform   string    `json:"platform"`
	AppVersion string    `json:"appVersion"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	CreatedAt  time.Time `json:"createdAt"`
}

func toDeviceResponse(d syncDomain.Device) deviceResponse {
	return deviceResponse{
		ID:         d.ID.String(),
		Name:       d.Name,
		Platform:   d.Platform,
		AppVersion: d.AppVersion,
		LastSeenAt: d.LastSeenAt,
		CreatedAt:  d.CreatedAt,
	}
}

// ─── Register ─────────────────────────────────────────────────────────────

func (h *syncHandler) handleRegister(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	var req registerDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":{"code":"bad_body"}}`, http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Platform == "" {
		http.Error(w, `{"error":{"code":"missing_fields"}}`, http.StatusBadRequest)
		return
	}

	dev, err := h.register.Run(r.Context(), syncApp.RegisterInput{
		UserID: uid, Name: req.Name, Platform: req.Platform, AppVersion: req.AppVersion,
	})
	if err != nil {
		if errors.Is(err, syncDomain.ErrDeviceLimit) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    "device_limit_free",
					"message": "Free tier supports 1 device. Upgrade to Pro for multi-device sync.",
					"tier":    "free",
				},
			})
			return
		}
		h.writeServerError(w, r, "register", err, uid)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(toDeviceResponse(dev))
}

// ─── List ─────────────────────────────────────────────────────────────────

func (h *syncHandler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	devs, err := h.list.Run(r.Context(), uid)
	if err != nil {
		h.writeServerError(w, r, "list", err, uid)
		return
	}
	out := make([]deviceResponse, 0, len(devs))
	for _, d := range devs {
		out = append(out, toDeviceResponse(d))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"devices": out})
}

// ─── Revoke ───────────────────────────────────────────────────────────────

func (h *syncHandler) handleRevoke(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, `{"error":{"code":"bad_id"}}`, http.StatusBadRequest)
		return
	}
	if err := h.revoke.Run(r.Context(), uid, id); err != nil {
		if errors.Is(err, syncDomain.ErrNotFound) {
			http.Error(w, `{"error":{"code":"not_found_or_already_revoked"}}`, http.StatusNotFound)
			return
		}
		h.writeServerError(w, r, "revoke", err, uid)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (h *syncHandler) writeServerError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "sync.handler error",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
}

// ─── Tombstone GC ─────────────────────────────────────────────────────────

type tombstoneGC struct {
	log      *slog.Logger
	uc       *syncApp.PruneTombstones
	interval time.Duration
}

func (g *tombstoneGC) Run(ctx context.Context) {
	t := time.NewTicker(g.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, cutoff, err := g.uc.Once(ctx)
			if err != nil {
				g.log.Warn("sync.tombstoneGC: failed",
					slog.Any("err", err), slog.Time("cutoff", cutoff))
				continue
			}
			if n > 0 {
				g.log.Info("sync.tombstoneGC: pruned",
					slog.Int64("rows", n), slog.Time("cutoff", cutoff))
			}
		}
	}
}
