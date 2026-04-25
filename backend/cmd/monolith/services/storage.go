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
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StorageGate — публичный объект для перекрёстных модулей (hone обёртывает
// им свои write-routes). Держит ссылку на pgxpool + TTL-кэш per-user
// (used,quota,tier), чтобы каждый POST-запрос не дёргал БД.
//
// Cache TTL = 30s — достаточно короткий чтобы юзер за минуту увидел
// «over quota» после превышения, и достаточно длинный чтобы спам
// /hone/notes/update'ов из редактора не флудил БД.
type StorageGate struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	mu    sync.Mutex
	cache map[uuid.UUID]quotaCacheEntry
	ttl   time.Duration
}

type quotaCacheEntry struct {
	usedBytes  int64
	quotaBytes int64
	tier       string
	at         time.Time
}

// NewStorage wires the storage quota module: hourly recompute background
// goroutine + REST endpoint. Возвращает Module и *StorageGate — последний
// inject'ится в hone bootstrap для enforcement'а на write-routes.
func NewStorage(d Deps) (*Module, *StorageGate) {
	gate := &StorageGate{
		pool:  d.Pool,
		log:   d.Log,
		cache: make(map[uuid.UUID]quotaCacheEntry),
		ttl:   30 * time.Second,
	}
	h := &storageHandler{pool: d.Pool, log: d.Log}
	rec := &storageRecomputer{
		pool:     d.Pool,
		log:      d.Log,
		interval: time.Hour,
		gate:     gate,
	}
	mod := &Module{
		MountREST: func(r chi.Router) {
			r.Get("/storage/quota", h.getQuota)
			// Archive endpoints. Сидят в storage модуле (а не в hone)
			// потому что архивация — это control из storage-домена
			// (юзер хочет освободить ленту), а не из notes/whiteboards.
			// Прямой SQL UPDATE — без cross-domain RPC: тянуть это
			// в proto + Connect для одной таблицы overengineering.
			r.Post("/storage/archive/notes/oldest", h.archiveOldestNotes)
			r.Post("/storage/archive/note/{id}", h.archiveNote)
			r.Post("/storage/archive/note/{id}/restore", h.restoreNote)
		},
		Background: []func(ctx context.Context){
			// `go` обязателен — bootstrap зовёт каждую Background-функцию
			// синхронно (см. App.Run в bootstrap.go). rec.Run блокирует
			// forever на ticker-loop'е; без `go` весь bootstrap зависает.
			func(ctx context.Context) { go rec.Run(ctx) },
		},
	}
	return mod, gate
}

// Middleware возвращает chi-совместимый guard для write-routes. Если юзер
// над квотой — отвечает 413 Payload Too Large с structured JSON, чтобы
// frontend мог показать конкретный prompt («Upgrade to Pro» / «Archive
// oldest»).
//
// Нет user_id в context'е (анонимный запрос) → пропускаем mw без проверки;
// auth gate всё равно ниже отвергнет с 401.
func (g *StorageGate) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		entry, err := g.read(r.Context(), uid)
		if err != nil {
			// Fail-open: при ошибке БД не блокируем запись (юзер
			// потом всё равно упрётся в hourly-cron'овский счётчик).
			g.log.WarnContext(r.Context(), "storage.gate: read failed (fail-open)",
				slog.Any("err", err), slog.String("user_id", uid.String()))
			next.ServeHTTP(w, r)
			return
		}
		if entry.usedBytes >= entry.quotaBytes && entry.quotaBytes > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":       "quota_exceeded",
					"message":    "Storage quota exceeded — upgrade or archive old items",
					"usedBytes":  entry.usedBytes,
					"quotaBytes": entry.quotaBytes,
					"tier":       entry.tier,
				},
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Invalidate сбрасывает кэш для юзера. Дёргается рекомпьютером после
// каждого pass'а — иначе изменения в storage_used_bytes не видны до
// истечения 30s TTL.
func (g *StorageGate) Invalidate(uid uuid.UUID) {
	g.mu.Lock()
	delete(g.cache, uid)
	g.mu.Unlock()
}

// InvalidateAll — после полного recompute pass'а.
func (g *StorageGate) InvalidateAll() {
	g.mu.Lock()
	g.cache = make(map[uuid.UUID]quotaCacheEntry)
	g.mu.Unlock()
}

func (g *StorageGate) read(ctx context.Context, uid uuid.UUID) (quotaCacheEntry, error) {
	now := time.Now()
	g.mu.Lock()
	if e, ok := g.cache[uid]; ok && now.Sub(e.at) < g.ttl {
		g.mu.Unlock()
		return e, nil
	}
	g.mu.Unlock()

	var e quotaCacheEntry
	err := g.pool.QueryRow(ctx,
		`SELECT storage_used_bytes, storage_quota_bytes, storage_tier
		   FROM users WHERE id = $1`,
		uid,
	).Scan(&e.usedBytes, &e.quotaBytes, &e.tier)
	if err != nil {
		return quotaCacheEntry{}, fmt.Errorf("storage.gate.read: %w", err)
	}
	e.at = now
	g.mu.Lock()
	g.cache[uid] = e
	g.mu.Unlock()
	return e, nil
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

// ─── Archive handlers ──────────────────────────────────────────────────────

// archiveOldestNotes — bulk-helper: помечает archived_at = now() для N
// самых старых (по updated_at) активных заметок юзера. Body: {"count": 10}
// (default 10, max 100). Возвращает {"archived": M}.
//
// Вызывается из «Storage full» dialog'а в UI как быстрый release-pressure
// без открывания списка заметок руками.
func (h *storageHandler) archiveOldestNotes(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	var body struct {
		Count int `json:"count"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // empty body = default
	if body.Count <= 0 {
		body.Count = 10
	}
	if body.Count > 100 {
		body.Count = 100
	}
	cmd, err := h.pool.Exec(r.Context(),
		`UPDATE hone_notes
		    SET archived_at = now(), updated_at = now()
		  WHERE id IN (
		      SELECT id FROM hone_notes
		       WHERE user_id = $1 AND archived_at IS NULL
		       ORDER BY updated_at ASC
		       LIMIT $2
		  )`,
		uid, body.Count,
	)
	if err != nil {
		h.log.ErrorContext(r.Context(), "storage.archiveOldestNotes",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"archived": cmd.RowsAffected()})
}

// archiveNote — single-id archive. URL: /storage/archive/note/{id}.
func (h *storageHandler) archiveNote(w http.ResponseWriter, r *http.Request) {
	h.setArchive(w, r, true)
}

// restoreNote — обратная операция (archived_at = NULL).
func (h *storageHandler) restoreNote(w http.ResponseWriter, r *http.Request) {
	h.setArchive(w, r, false)
}

func (h *storageHandler) setArchive(w http.ResponseWriter, r *http.Request, archived bool) {
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
	var stmt string
	if archived {
		stmt = `UPDATE hone_notes SET archived_at=now(), updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	} else {
		stmt = `UPDATE hone_notes SET archived_at=NULL, updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	}
	cmd, err := h.pool.Exec(r.Context(), stmt, id, uid)
	if err != nil {
		h.log.ErrorContext(r.Context(), "storage.setArchive",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		http.Error(w, `{"error":{"code":"internal"}}`, http.StatusInternalServerError)
		return
	}
	if cmd.RowsAffected() == 0 {
		http.Error(w, `{"error":{"code":"not_found"}}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// ─── Hourly recomputer ─────────────────────────────────────────────────────

type storageRecomputer struct {
	pool     *pgxpool.Pool
	log      *slog.Logger
	interval time.Duration
	gate     *StorageGate
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
				continue
			}
			// Сбрасываем quota-gate cache — иначе свежие used_bytes
			// не видны до истечения 30s TTL, и юзер либо проскочит
			// quota (рекомпьют поднял used выше cap, gate видит
			// старое), либо застрянет в 413 (рекомпьют опустил
			// used после archive, gate не видит).
			if r.gate != nil {
				r.gate.InvalidateAll()
			}
		}
	}
}

// recompute переписывает users.storage_used_bytes для ВСЕХ юзеров
// одним statement'ом. coach_episodes — оценка через length(text); это
// не точный physical size (нет учёта TOAST overhead, JSONB compression),
// но достаточно для UX usage-bar'а.
//
// Архивированные ноты/whiteboards (`archived_at IS NOT NULL`) — НЕ считаем.
// Раньше считались (см. 00029_storage_archive.sql «archived items занимают
// место»), но юзеры жаловались что usage bar показывает «754 B / 1 GB»
// для пустого аккаунта — потому что 200-500-байтный Excalidraw-default-
// state у архивных whiteboard'ов раздувал sum. Сейчас семантика usage =
// «то что тебе видно». Чтобы освободить storage, юзер «Delete forever»
// (hard delete, ниже) — это уже не считается.
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
        WHERE archived_at IS NULL
        GROUP BY user_id
    ) n ON n.user_id = u.id
    LEFT JOIN (
        SELECT user_id, SUM(octet_length(state_json::text))::bigint AS bytes
        FROM hone_whiteboards
        WHERE archived_at IS NULL
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
	if _, err := r.pool.Exec(ctx, q); err != nil {
		return fmt.Errorf("storage.recompute: %w", err)
	}
	return nil
}
