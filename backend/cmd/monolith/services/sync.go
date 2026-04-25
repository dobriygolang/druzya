// Package services — sync foundation (Phase C-3).
//
// Этот файл — НЕ полный sync-протокол. Это identity-слой: регистрация
// устройств с tier-gate'ом (Free=1, Pro/Pro+=∞). Pull/push deltas,
// conflict resolution, transport — отдельная задача (см. 00030
// migration header).
//
// Endpoints:
//
//	POST /api/v1/sync/devices         → register (returns device_id)
//	GET  /api/v1/sync/devices         → list active devices
//	POST /api/v1/sync/devices/{id}/revoke → revoke (logout from device)
//
// Tier resolution: читаем users.storage_tier (это уже Phase C-1). Free
// → max 1 active device; Pro/Pro+ → unlimited.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewSync wires the sync foundation module + exposes the heartbeat
// middleware (consumed by router.go via Deps.SyncHeartbeat).
//
// Phase C-4 расширил модуль до полного sync-протокола:
//   - device CRUD (C-3)
//   - heartbeat middleware (C-3.1)
//   - replication pull/push (C-4)
//   - tombstone GC cron (C-4)
func NewSync(d Deps) (*Module, *SyncHeartbeat) {
	h := &syncHandler{pool: d.Pool, log: d.Log}
	hb := newHeartbeat(d.Pool, d.Log)
	repl := &syncReplicationHandler{pool: d.Pool, log: d.Log, broker: d.SyncEventBroker}
	gc := &tombstoneGC{
		pool:      d.Pool,
		log:       d.Log,
		interval:  24 * time.Hour, // daily
		retention: 90 * 24 * time.Hour,
	}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Post("/sync/devices", h.register)
			r.Get("/sync/devices", h.list)
			r.Post("/sync/devices/{id}/revoke", h.revoke)
			r.Post("/sync/pull", repl.pull)
			r.Post("/sync/push", repl.push)
		},
		Background: []func(ctx context.Context){
			// `go` обязателен — bootstrap зовёт Background синхронно
			// (см. App.Run). gc.Run блокирует на ticker-loop'е.
			func(ctx context.Context) { go gc.Run(ctx) },
		},
	}, hb
}

type syncHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// ─── Register ──────────────────────────────────────────────────────────────

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

func (h *syncHandler) register(w http.ResponseWriter, r *http.Request) {
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

	// Tier-gate в TX, чтобы избежать race'а: два параллельных register'а
	// от Free-юзера не должны оба пройти.
	tx, err := h.pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		h.writeServerError(w, r, "begin", err, uid)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var tier string
	if qErr := tx.QueryRow(r.Context(),
		`SELECT storage_tier FROM users WHERE id=$1`, uid,
	).Scan(&tier); qErr != nil {
		h.writeServerError(w, r, "tier-lookup", qErr, uid)
		return
	}

	if tier == "free" {
		var activeCount int
		if qErr := tx.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM devices
			  WHERE user_id=$1 AND revoked_at IS NULL`, uid,
		).Scan(&activeCount); qErr != nil {
			h.writeServerError(w, r, "active-count", qErr, uid)
			return
		}
		if activeCount >= 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"code":    "device_limit_free",
					"message": "Free tier supports 1 device. Upgrade to Pro for multi-device sync.",
					"tier":    tier,
				},
			})
			return
		}
	}

	var resp deviceResponse
	err = tx.QueryRow(r.Context(),
		`INSERT INTO devices (user_id, name, platform, app_version)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, platform, app_version, last_seen_at, created_at`,
		uid, req.Name, req.Platform, req.AppVersion,
	).Scan(&resp.ID, &resp.Name, &resp.Platform, &resp.AppVersion, &resp.LastSeenAt, &resp.CreatedAt)
	if err != nil {
		h.writeServerError(w, r, "insert", err, uid)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		h.writeServerError(w, r, "commit", err, uid)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// ─── List ──────────────────────────────────────────────────────────────────

func (h *syncHandler) list(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":{"code":"unauthenticated"}}`, http.StatusUnauthorized)
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT id, name, platform, app_version, last_seen_at, created_at
		   FROM devices
		  WHERE user_id=$1 AND revoked_at IS NULL
		  ORDER BY last_seen_at DESC`,
		uid,
	)
	if err != nil {
		h.writeServerError(w, r, "list", err, uid)
		return
	}
	defer rows.Close()
	out := make([]deviceResponse, 0, 4)
	for rows.Next() {
		var d deviceResponse
		if err := rows.Scan(&d.ID, &d.Name, &d.Platform, &d.AppVersion, &d.LastSeenAt, &d.CreatedAt); err != nil {
			h.writeServerError(w, r, "scan", err, uid)
			return
		}
		out = append(out, d)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"devices": out})
}

// ─── Revoke ────────────────────────────────────────────────────────────────

func (h *syncHandler) revoke(w http.ResponseWriter, r *http.Request) {
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
	cmd, err := h.pool.Exec(r.Context(),
		`UPDATE devices SET revoked_at=now()
		  WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
		id, uid,
	)
	if err != nil {
		h.writeServerError(w, r, "revoke", err, uid)
		return
	}
	if cmd.RowsAffected() == 0 {
		http.Error(w, `{"error":{"code":"not_found_or_already_revoked"}}`, http.StatusNotFound)
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

// ─── Heartbeat middleware ─────────────────────────────────────────────────
//
// On every authenticated request:
//   1. Read X-Device-ID header. Empty → skip (legacy client without sync
//      bootstrap; we don't reject — auth gate is the source of truth).
//   2. Look up device row. Не найдено или revoked_at != NULL → ответ 401
//      с {error.code:"device_revoked"}, фронт wipe'ает локальные секреты.
//   3. Update last_seen_at = now(), но НЕ чаще 5 минут per-device (in-mem
//      cache). Иначе каждый RPC = UPDATE — невыносимо для активного юзера.
//
// Middleware применяется ПОСЛЕ auth-gate'а — иначе anonymous-запрос с
// произвольным X-Device-ID мог бы тыкать в чужие device-rows. Сейчас
// мы дополнительно фильтруем по user_id (см. SQL ниже).

// SyncHeartbeat — публичный объект для router.go. Дёргается через
// .Middleware() в auth-gated цепочке.
type SyncHeartbeat struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	mu        sync.Mutex
	lastTouch map[uuid.UUID]time.Time // device_id → last UPDATE timestamp
	throttle  time.Duration
}

func newHeartbeat(pool *pgxpool.Pool, log *slog.Logger) *SyncHeartbeat {
	return &SyncHeartbeat{
		pool:      pool,
		log:       log,
		lastTouch: make(map[uuid.UUID]time.Time),
		throttle:  5 * time.Minute,
	}
}

// Middleware reads X-Device-ID, проверяет revocation, throttled-обновляет
// last_seen_at. Без header'а — passthrough (легаси-клиент или ещё не
// прошедший bootstrap).
func (s *SyncHeartbeat) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, hasUser := sharedMw.UserIDFromContext(r.Context())
		didStr := r.Header.Get("X-Device-ID")
		if didStr == "" {
			// Fallback на ?deviceId= query — для SSE / preview-ботов /
			// прочих случаев когда custom-header передать нельзя.
			didStr = r.URL.Query().Get("deviceId")
		}
		if didStr == "" || !hasUser {
			next.ServeHTTP(w, r)
			return
		}
		did, err := uuid.Parse(didStr)
		if err != nil {
			// Битый header'е — игнорируем, не валим запрос.
			next.ServeHTTP(w, r)
			return
		}

		// 1. Revocation check — single SELECT, не трогаем БД-write hot
		// path. Если БД упадёт — fail-open: лучше пропустить запрос чем
		// положить весь продукт.
		var revokedAt *time.Time
		err = s.pool.QueryRow(r.Context(),
			`SELECT revoked_at FROM devices WHERE id=$1 AND user_id=$2`,
			did, uid,
		).Scan(&revokedAt)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Device-id чужой / удалённый — фронт должен заново
				// register'нуть. 401 чтобы interceptor сбросил локальный
				// device-id.
				s.writeRevoked(w)
				return
			}
			// Иная DB-ошибка → fail-open.
			s.log.WarnContext(r.Context(), "sync.heartbeat: revocation check failed",
				slog.Any("err", err), slog.String("device_id", didStr))
			next.ServeHTTP(w, r)
			return
		}
		if revokedAt != nil {
			s.writeRevoked(w)
			return
		}

		// 2. Throttled last_seen_at update.
		s.mu.Lock()
		last, ok := s.lastTouch[did]
		shouldTouch := !ok || time.Since(last) >= s.throttle
		if shouldTouch {
			s.lastTouch[did] = time.Now()
		}
		s.mu.Unlock()
		if shouldTouch {
			// Fire-and-forget — не блокируем запрос на UPDATE'е.
			go s.touchAsync(did)
		}

		// Кладём device-id в context — downstream'ные handler'ы
		// (Hone Delete, etc) читают его и записывают в sync_tombstones
		// с origin_device_id. Это позволяет pull endpoint'у не возвращать
		// устройству его же tombstone'ы.
		r = r.WithContext(sharedMw.WithDeviceID(r.Context(), did))
		next.ServeHTTP(w, r)
	})
}

func (s *SyncHeartbeat) touchAsync(did uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := s.pool.Exec(ctx,
		`UPDATE devices SET last_seen_at = now() WHERE id=$1 AND revoked_at IS NULL`,
		did,
	); err != nil {
		s.log.Warn("sync.heartbeat.touch failed",
			slog.Any("err", err), slog.String("device_id", did.String()))
	}
}

func (s *SyncHeartbeat) writeRevoked(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(
		`{"error":{"code":"device_revoked","message":"This device has been signed out from another device."}}`,
	))
}
