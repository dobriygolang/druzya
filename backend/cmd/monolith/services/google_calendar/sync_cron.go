// sync_cron.go — periodic pull (5-min tick) over all connected users.
// Webhook push subscription (Google Calendar push notifications via
// watchChannel) deferred post-MVP — pull is good enough at 5-min cadence
// for senior interview prep scheduling.
package google_calendar

import (
	"context"
	"log/slog"
	"time"

	gcApp "druz9/google_calendar/app"
	gcDomain "druz9/google_calendar/domain"
)

const syncInterval = 5 * time.Minute

type syncCron struct {
	h     *gcApp.Handlers
	creds gcDomain.CredentialsRepo
	log   *slog.Logger
	stop  chan struct{}
}

func newSyncCron(h *gcApp.Handlers, creds gcDomain.CredentialsRepo, log *slog.Logger) *syncCron {
	return &syncCron{h: h, creds: creds, log: log, stop: make(chan struct{})}
}

func (c *syncCron) Run(ctx context.Context) {
	go func() {
		t := time.NewTicker(syncInterval)
		defer t.Stop()
		// First tick: short delay so other modules finish bootstrap.
		first := time.NewTimer(30 * time.Second)
		defer first.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-c.stop:
				return
			case <-first.C:
				c.tick(ctx)
			case <-t.C:
				c.tick(ctx)
			}
		}
	}()
}

func (c *syncCron) Stop(_ context.Context) error {
	select {
	case <-c.stop:
	default:
		close(c.stop)
	}
	return nil
}

func (c *syncCron) tick(ctx context.Context) {
	users, err := c.creds.ListConnected(ctx)
	if err != nil {
		if c.log != nil {
			c.log.WarnContext(ctx, "google_calendar.cron: ListConnected failed", slog.Any("err", err))
		}
		return
	}
	if len(users) == 0 {
		return
	}
	for _, uid := range users {
		// Bounded per-user — кратко, чтобы один stalled API call не блокировал
		// весь pool юзеров. 8s = ~2x median Google API latency.
		callCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		if _, err := c.h.SyncEvents(callCtx, uid); err != nil {
			if c.log != nil {
				c.log.WarnContext(callCtx, "google_calendar.cron: SyncEvents failed",
					slog.String("user_id", uid.String()), slog.Any("err", err))
			}
		}
		cancel()
	}
}
