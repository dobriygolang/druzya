// Package storage — monolith-side wiring + thin HTTP handlers for the
// storage bounded context. All persistence + business rules live in the
// druz9/storage module (domain/app/infra); this file only glues together:
//
//   - REST handlers (parse → call use-case → JSON-serialize)
//   - StorageGate middleware (TTL-cache поверх ReadCurrentUsage use-case)
//   - hourly recomputer cron-loop (зовёт RecomputeUsage)
//   - NewStorage constructor для bootstrap'а — возвращает (*Module, *StorageGate)
//
// Эта папка должна быть готова к выкидыванию: handler'ы держат use-case'ы,
// не *pgxpool.Pool — переезд в отдельный микросервис сводится к подмене
// HTTP/Connect-обвязки.
package storage

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	storageApp "druz9/storage/app"
	storageInfra "druz9/storage/infra"
	storagePorts "druz9/storage/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"encoding/json"
)

// ─── StorageGate ───────────────────────────────────────────────────────────

// StorageGate — публичный объект для перекрёстных модулей (hone обёртывает
// им свои write-routes). Держит use-case ReadCurrentUsage + TTL-кэш per-user
// (used,quota,tier), чтобы каждый POST-запрос не дёргал БД.
//
// Cache TTL = 30s — достаточно короткий чтобы юзер за минуту увидел
// «over quota» после превышения, и достаточно длинный чтобы спам
// /hone/notes/update'ов из редактора не флудил БД.
type StorageGate struct {
	read *storageApp.ReadCurrentUsage
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
		entry, err := g.readCached(r.Context(), uid)
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

func (g *StorageGate) readCached(ctx context.Context, uid uuid.UUID) (quotaCacheEntry, error) {
	now := time.Now()
	g.mu.Lock()
	if e, ok := g.cache[uid]; ok && now.Sub(e.at) < g.ttl {
		g.mu.Unlock()
		return e, nil
	}
	g.mu.Unlock()

	q, err := g.read.Run(ctx, uid)
	if err != nil {
		return quotaCacheEntry{}, err //nolint:wrapcheck // already wrapped in app layer
	}
	e := quotaCacheEntry{
		usedBytes:  q.UsedBytes,
		quotaBytes: q.QuotaBytes,
		tier:       q.Tier,
		at:         now,
	}
	g.mu.Lock()
	g.cache[uid] = e
	g.mu.Unlock()
	return e, nil
}

// ─── Hourly recomputer ─────────────────────────────────────────────────────

type storageRecomputer struct {
	uc       *storageApp.RecomputeUsage
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
			if err := r.uc.Run(ctx); err != nil {
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

// ─── Wiring ────────────────────────────────────────────────────────────────

// NewStorage wires the storage quota module: hourly recompute background
// goroutine + REST endpoints. Возвращает Module и *StorageGate — последний
// inject'ится в hone bootstrap для enforcement'а на write-routes.
//
// Sig signature сохранена ровно такой, какой её зовёт bootstrap.go (раньше
// services.NewStorage). Bootstrap-side импорт обновится отдельным PR'ом.
func NewStorage(d services.Deps) (*services.Module, *StorageGate) {
	repo := storageInfra.NewPostgresRepo(d.Pool)

	getQuotaUC := &storageApp.GetQuota{Repo: repo}
	archiveOldestUC := &storageApp.ArchiveOldestNotes{Repo: repo}
	archiveNoteUC := &storageApp.ArchiveNote{Repo: repo}
	restoreNoteUC := &storageApp.RestoreNote{Repo: repo}
	readUsageUC := &storageApp.ReadCurrentUsage{Repo: repo}
	recomputeUC := &storageApp.RecomputeUsage{Repo: repo}

	gate := &StorageGate{
		read:  readUsageUC,
		log:   d.Log,
		cache: make(map[uuid.UUID]quotaCacheEntry),
		ttl:   30 * time.Second,
	}

	server := &storagePorts.Server{
		GetQuotaUC:           getQuotaUC,
		ArchiveOldestNotesUC: archiveOldestUC,
		ArchiveNoteUC:        archiveNoteUC,
		RestoreNoteUC:        restoreNoteUC,
		Log:                  d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewStorageServiceHandler(server)
	transcoder := services.MustTranscode("storage", connectPath, connectHandler)

	rec := &storageRecomputer{
		uc:       recomputeUC,
		log:      d.Log,
		interval: time.Hour,
		gate:     gate,
	}

	mod := &services.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/storage/quota", transcoder.ServeHTTP)
			r.Post("/storage/archive/notes/oldest", transcoder.ServeHTTP)
			r.Post("/storage/archive/note/{id}", transcoder.ServeHTTP)
			r.Post("/storage/archive/note/{id}/restore", transcoder.ServeHTTP)
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
