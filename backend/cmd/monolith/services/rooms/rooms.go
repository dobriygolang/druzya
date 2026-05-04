// Package rooms — monolith bootstrap для services/rooms (Phase 9a).
package rooms

import (
	"context"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	roomsApp "druz9/rooms/app"
	roomsInfra "druz9/rooms/infra"
	roomsPorts "druz9/rooms/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewRooms wires Phase 9a Path C low-key collab rooms.
//
// Free-tier guarded: 3 active · 24h TTL. Discovery — только через
// Settings → Developer tools / tutor / mock / club. NO top-level surface.
//
// d.PublicBaseURL — origin для share-link генерации (https://druz9.online).
// nil-safe: пустая строка → relative path.
func NewRooms(d monolithServices.Deps) *monolithServices.Module {
	repo := roomsInfra.NewRooms(d.Pool)
	quota := roomsInfra.NewQuota(d.Pool)

	createUC := &roomsApp.CreateRoom{
		Repo: repo, Quota: quota, Now: d.Now,
		PublicBaseURL: d.Cfg.Notify.PublicBaseURL,
	}
	listUC := &roomsApp.ListMyRooms{Repo: repo}
	extendUC := &roomsApp.ExtendRoom{Repo: repo, Quota: quota, Now: d.Now}
	deleteUC := &roomsApp.DeleteRoom{Repo: repo, Quota: quota, Now: d.Now}
	restoreUC := &roomsApp.RestoreRoom{Repo: repo, Quota: quota, Now: d.Now}

	server := roomsPorts.NewRoomServer(roomsPorts.RoomServer{
		Create: createUC, List: listUC, Extend: extendUC,
		Delete: deleteUC, Restore: restoreUC, Quota: quota,
	})

	connectPath, connectHandler := druz9v1connect.NewRoomServiceHandler(server)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     connectHandler,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/rooms", connectHandler.ServeHTTP)
			r.Post("/rooms/list", connectHandler.ServeHTTP)
			r.Post("/rooms/extend", connectHandler.ServeHTTP)
			r.Post("/rooms/delete", connectHandler.ServeHTTP)
			r.Post("/rooms/restore", connectHandler.ServeHTTP)
		},
	}
}

// NewSweepRunner — TTL daemon entry. Caller register'ит в cleanup_crons.
func NewSweepRunner(d monolithServices.Deps) *roomsApp.SweepExpired {
	return &roomsApp.SweepExpired{
		Repo:  roomsInfra.NewRooms(d.Pool),
		Quota: roomsInfra.NewQuota(d.Pool),
		Now:   d.Now,
		Limit: 500,
	}
}

// NewSweepCron returns module с background loop, который раз в час дёргает
// SweepExpired. Cleaner pattern чем pristine cron-scheduler — Hone и так
// одно daily-ish окно использует. Caller register'ит этот module в
// modules slice как обычно.
func NewSweepCron(d monolithServices.Deps) *monolithServices.Module {
	runner := NewSweepRunner(d)
	return &monolithServices.Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				ticker := time.NewTicker(1 * time.Hour)
				defer ticker.Stop()
				// Initial sweep at boot (catches rooms что expired пока сервис
				// был down). Idempotent — re-archive existing archived = no-op.
				if archived, err := runner.Run(ctx); err == nil {
					d.Log.Info("rooms: TTL sweep initial", "archived", archived)
				}
				for {
					select {
					case <-ctx.Done():
						return
					case <-ticker.C:
						if archived, err := runner.Run(ctx); err != nil {
							d.Log.Warn("rooms: TTL sweep failed", "err", err)
						} else if archived > 0 {
							d.Log.Info("rooms: TTL sweep", "archived", archived)
						}
					}
				}
			},
		},
	}
}
