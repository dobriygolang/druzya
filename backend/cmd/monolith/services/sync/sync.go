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
	"errors"
	"fmt"
	"log/slog"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	syncApp "druz9/sync/app"
	syncDomain "druz9/sync/domain"
	syncInfra "druz9/sync/infra"
	syncPorts "druz9/sync/ports"

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

	server := &syncPorts.Server{RegisterUC: registerUC, ListUC: listUC, RevokeUC: revokeUC, Log: d.Log}
	connectPath, connectHandler := druz9v1connect.NewSyncServiceHandler(server)
	transcoder := monolithServices.MustTranscode("sync", connectPath, connectHandler)

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
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/sync/devices", transcoder.ServeHTTP)
			r.Get("/sync/devices", transcoder.ServeHTTP)
			r.Post("/sync/devices/{id}/revoke", transcoder.ServeHTTP)
			// /sync/pull and /sync/push remain chi — they shuttle binary
			// blobs (yjs CRDT updates etc.).
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
