// Async embedding worker — догоняет coach_episodes у которых
// embedded_at IS NULL. Нужно чтобы Memory.Append оставался мгновенным
// (sub-1ms write), а embedding (200-500ms через Ollama) — фоновый.
//
// Lifecycle: monolith bootstrap'а запускает Run в горутине, передавая
// rootCtx. Cancel rootCtx → loop останавливается чисто.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
)

// EmbedWorker — кронообразный backgrounder.
type EmbedWorker struct {
	Episodes domain.EpisodeRepo
	Embed    domain.Embedder
	Log      *slog.Logger
	// Tick — interval между batch'ами. По умолчанию 30 сек (см. Run).
	Tick time.Duration
	// Batch — сколько episodes брать за раз. По умолчанию 32.
	Batch int
}

// Run крутит loop до cancel. Безопасно spawn'ить как `go w.Run(ctx)`.
func (w *EmbedWorker) Run(ctx context.Context) {
	tick := w.Tick
	if tick <= 0 {
		tick = 30 * time.Second
	}
	batch := w.Batch
	if batch <= 0 {
		batch = 32
	}
	t := time.NewTicker(tick)
	defer t.Stop()
	w.tickOnce(ctx, batch)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.tickOnce(ctx, batch)
		}
	}
}

func (w *EmbedWorker) tickOnce(ctx context.Context, batch int) {
	rows, err := w.Episodes.PendingEmbeddings(ctx, batch)
	if err != nil {
		if w.Log != nil {
			w.Log.Warn("intelligence.EmbedWorker: pending lookup failed", slog.Any("err", err))
		}
		return
	}
	if len(rows) == 0 {
		return
	}
	for _, ep := range rows {
		if ctx.Err() != nil {
			return
		}
		vec, model, err := w.Embed.Embed(ctx, ep.Summary)
		if err != nil {
			if w.Log != nil {
				w.Log.Debug("intelligence.EmbedWorker: embed failed (will retry)",
					slog.String("episode_id", ep.ID.String()),
					slog.Any("err", err))
			}
			continue
		}
		if err := w.Episodes.SetEmbedding(ctx, ep.ID, vec, model); err != nil {
			if w.Log != nil {
				w.Log.Warn("intelligence.EmbedWorker: set embedding failed",
					slog.String("episode_id", ep.ID.String()),
					slog.Any("err", err))
			}
		}
	}
}
