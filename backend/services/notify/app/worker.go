package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Worker drains the Queue and dispatches notifications to the correct Sender.
//
// Fall-through semantics: if the chosen Sender returns ErrNoTarget (e.g. no
// Telegram chat_id), the worker tries the next enabled channel in priority
// order before marking the row as skipped (status stays "pending" with a
// reason). Real errors flip status to "failed".
type Worker struct {
	Queue     domain.Queue
	Prefs     domain.PreferencesRepo
	Logs      domain.LogRepo
	Templates domain.TemplateStore
	Senders   map[enums.NotificationChannel]domain.Sender
	RateLimit domain.RateLimiter
	Log       *slog.Logger

	// PoolSize is the goroutine count. Defaults to 2 when 0.
	PoolSize int
}

// Run starts the worker pool and blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	if w.PoolSize <= 0 {
		w.PoolSize = 2
	}
	var wg sync.WaitGroup
	wg.Add(w.PoolSize)
	for i := 0; i < w.PoolSize; i++ {
		go func(id int) {
			defer wg.Done()
			w.loop(ctx, id)
		}(i)
	}
	wg.Wait()
	w.Log.Info("notify.worker: drained")
}

func (w *Worker) loop(ctx context.Context, id int) {
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		n, err := w.Queue.Dequeue(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				// Normal idle tick — loop again (DeadlineExceeded from BRPOP
				// timeout is benign).
				continue
			}
			w.Log.WarnContext(ctx, "notify.worker: dequeue", slog.Int("worker", id), slog.Any("err", err))
			time.Sleep(500 * time.Millisecond)
			continue
		}
		w.process(ctx, n)
	}
}

// process handles one Notification end-to-end: insert log row, render, send
// (with channel fallback), mark the row.
func (w *Worker) process(ctx context.Context, n domain.Notification) {
	// Record a pending row so we can audit even if the send crashes.
	entry, err := w.Logs.Insert(ctx, domain.LogEntry{
		UserID:  n.UserID,
		Channel: n.Channel,
		Type:    n.Type,
		Payload: n.Payload,
		Status:  "pending",
	})
	if err != nil {
		w.Log.ErrorContext(ctx, "notify.worker: log insert",
			slog.String("id", n.ID.String()), slog.Any("err", err))
		return
	}

	pref, err := w.Prefs.Get(ctx, n.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		w.fail(ctx, entry.ID, fmt.Errorf("prefs: %w", err))
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		pref = domain.DefaultPreferences()
		pref.UserID = n.UserID
	}

	// Rate-limit Telegram specifically.
	if n.Channel == enums.NotificationChannelTelegram && w.RateLimit != nil {
		ok, retryIn, rerr := w.RateLimit.Allow(ctx, n.UserID)
		if rerr != nil {
			w.Log.WarnContext(ctx, "notify.worker: ratelimit",
				slog.String("user_id", n.UserID.String()), slog.Any("err", rerr))
		}
		if !ok {
			// STUB: bible §3.11 asks for a digest after 1 min. For MVP we just
			// drop the single message and log — the dedup window prevents
			// storms anyway. Follow-up: assemble a digest text.
			w.Log.InfoContext(ctx, "notify.worker: rate_limited_drop",
				slog.String("user_id", n.UserID.String()),
				slog.Int("retry_in_s", int(retryIn.Seconds())))
			_ = w.Logs.MarkFailed(ctx, entry.ID, "rate_limited")
			return
		}
	}

	tpl, err := w.Templates.Render(n.Type, n.Locale, n.Payload)
	if err != nil {
		w.fail(ctx, entry.ID, fmt.Errorf("render: %w", err))
		return
	}

	// Channel fallback ordered list: start with the chosen channel, then fall
	// through the rest of the user's enabled channels in priority order.
	channels := orderWithFallback(n.Channel, pref)

	var sendErr error
	for _, ch := range channels {
		sender, ok := w.Senders[ch]
		if !ok {
			continue
		}
		identity := identityForChannel(ch, pref)
		sendErr = sender.Send(ctx, n.UserID, identity, tpl)
		if sendErr == nil {
			_ = w.Logs.MarkSent(ctx, entry.ID, time.Now().UTC())
			return
		}
		if errors.Is(sendErr, domain.ErrNoTarget) {
			w.Log.InfoContext(ctx, "notify.worker: no_target_fallback",
				slog.String("channel", string(ch)),
				slog.String("user_id", n.UserID.String()))
			continue
		}
		// Real error: stop trying — a 500 on Telegram might also mean the
		// network is down, so don't blast email too.
		break
	}
	if sendErr != nil {
		w.fail(ctx, entry.ID, sendErr)
		return
	}
	// All fallbacks returned ErrNoTarget.
	_ = w.Logs.MarkFailed(ctx, entry.ID, "no_target_any_channel")
}

func (w *Worker) fail(ctx context.Context, id uuid.UUID, err error) {
	w.Log.WarnContext(ctx, "notify.worker: send failed",
		slog.String("id", id.String()), slog.Any("err", err))
	_ = w.Logs.MarkFailed(ctx, id, err.Error())
}

// orderWithFallback returns the unique, priority-ordered channel list starting
// with primary and then the rest of `pref.Channels`.
func orderWithFallback(primary enums.NotificationChannel, pref domain.Preferences) []enums.NotificationChannel {
	out := []enums.NotificationChannel{primary}
	seen := map[enums.NotificationChannel]bool{primary: true}
	for _, c := range []enums.NotificationChannel{
		enums.NotificationChannelTelegram,
		enums.NotificationChannelEmail,
		enums.NotificationChannelPush,
	} {
		if seen[c] {
			continue
		}
		if pref.HasChannel(c) {
			out = append(out, c)
			seen[c] = true
		}
	}
	return out
}

// identityForChannel extracts the per-channel recipient identifier from prefs.
// For MVP only Telegram has a stored identity; email/push identities are
// placeholders ("" → Sender returns ErrNoTarget).
func identityForChannel(c enums.NotificationChannel, pref domain.Preferences) string {
	switch c { //nolint:exhaustive // only channels with stored identity here
	case enums.NotificationChannelTelegram:
		return pref.TelegramChatID
	}
	return ""
}
