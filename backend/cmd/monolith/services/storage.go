// Package services — storage quota wiring (Phase C).
//
// Strategy:
//   - users.storage_used_bytes пересчитывается hourly cron'ом, который
//     суммирует все per-user байты в hone_notes, hone_whiteboards и
//     coach_episodes одним SQL'ем (UPDATE ... FROM (SELECT user_id, SUM …)).
//     Один проход по таблицам каждый час — копеечно, и снимает
//     необходимость инкрементировать счётчик на каждом write'е (а значит
//     не надо думать про rollback'и при ошибках).
//   - GET /api/v1/storage/quota — отдаёт {used, quota, tier} текущему
//     юзеру. Используется Settings-страницей для отрисовки usage-bar'а.
//
// На этой фазе НЕТ enforcement'а — никаких 413 на write'ы. Сначала
// собираем sample реального использования, потом включаем мягкие
// предупреждения, потом hard-cap. Это сознательный gradual rollout:
// blocking паблик-юзеров до того как мы поняли распределение — самый
// быстрый способ убить продукт.
package services

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewStorage wires the storage quota module: hourly recompute background
// goroutine + REST endpoint. Mounted in bootstrap alongside other modules.
func NewStorage(d Deps) *Module {
	h := &storageHandler{pool: d.Pool, log: d.Log}
	rec := &storageRecomputer{
		pool:     d.Pool,
		log:      d.Log,
		interval: time.Hour,
	}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/storage/quota", h.getQuota)
		},
		Background: []func(ctx context.Context){
			func(ctx context.Context) { rec.Run(ctx) },
		},
	}
}

// ─── REST handler ──────────────────────────────────────────────────────────

type storageHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

type storageQuotaResponse struct {
	UsedBytes  int64  `json:"usedBytes"`
	QuotaBytes int64  `json:"quotaBytes"`
	Tier       string `json:"tier"`
}

func (h *storageHandler) getQuota(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	var resp storageQuotaResponse
	err := h.pool.QueryRow(r.Context(),
		`SELECT storage_used_bytes, storage_quota_bytes, storage_tier
		   FROM users WHERE id = $1`,
		uid,
	).Scan(&resp.UsedBytes, &resp.QuotaBytes, &resp.Tier)
	if err != nil {
		h.log.ErrorContext(r.Context(), "storage.getQuota: query",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// ─── Hourly recomputer ─────────────────────────────────────────────────────

type storageRecomputer struct {
	pool     *pgxpool.Pool
	log      *slog.Logger
	interval time.Duration
}

// Run loops until ctx cancellation. First tick fires after `interval` —
// startup recompute не нужен, hourly granularity. Юзер увидит свежие
// данные максимум через час; для квот это ОК.
func (r *storageRecomputer) Run(ctx context.Context) {
	t := time.NewTicker(r.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.recompute(ctx); err != nil {
				r.log.Warn("storage.recompute failed",
					slog.Any("err", err))
			}
		}
	}
}

// recompute переписывает users.storage_used_bytes для ВСЕХ юзеров
// одним statement'ом. coach_episodes — оценка через length(text); это
// не точный physical size (нет учёта TOAST overhead, JSONB compression),
// но достаточно для UX usage-bar'а.
//
// CTE-форма выбрана из-за того, что hone_whiteboards и coach_episodes
// могут быть большими — JOIN агрегатов в едином UPDATE… FROM
// эффективнее последовательных passes.
func (r *storageRecomputer) recompute(ctx context.Context) error {
	const q = `
WITH usage AS (
    SELECT u.id AS user_id,
           COALESCE(n.bytes,  0) +
           COALESCE(wb.bytes, 0) +
           COALESCE(ep.bytes, 0) AS total
    FROM users u
    LEFT JOIN (
        SELECT user_id, SUM(size_bytes)::bigint AS bytes
        FROM hone_notes
        GROUP BY user_id
    ) n ON n.user_id = u.id
    LEFT JOIN (
        SELECT user_id, SUM(octet_length(state_json::text))::bigint AS bytes
        FROM hone_whiteboards
        GROUP BY user_id
    ) wb ON wb.user_id = u.id
    LEFT JOIN (
        SELECT user_id,
               SUM(octet_length(summary) + octet_length(payload::text))::bigint AS bytes
        FROM coach_episodes
        GROUP BY user_id
    ) ep ON ep.user_id = u.id
)
UPDATE users
   SET storage_used_bytes    = usage.total,
       storage_recomputed_at = now()
  FROM usage
 WHERE users.id = usage.user_id`
	_, err := r.pool.Exec(ctx, q)
	return err //nolint:wrapcheck — caller logs with stable prefix
}
