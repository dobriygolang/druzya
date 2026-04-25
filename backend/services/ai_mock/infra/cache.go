// Package infra: cache.go is the read-through Redis cache for the ai_mock
// bounded context. It mirrors the pattern established by profile/infra/cache.go
// (singleflight collapsing, redis-error fallback, KV abstraction) so the two
// caches stay easy to reason about together.
//
// What we cache:
//
//   - mock:v1:session:<uuid>  — the live session row, TTL 60s. Invalidated on
//     SendMessage and FinishSession write paths so freshness is sub-second.
//   - mock:v1:report:<uuid>   — the parsed ai_report blob + replay URL,
//     TTL 5min. Invalidated only when the report is regenerated (e.g. a
//     retry from the worker), since once the worker emits a final report the
//     blob is immutable.
//
// What we don't cache:
//
//   - mock_messages — per-message reads are paginated and the WS path streams
//     fresh tokens; caching tail-of-conversation would invite stale reads.
//   - tasks/companies/users — these are static enough that the upstream pgx
//     hit is sub-millisecond; caching them across services is a separate
//     concern (profile/* already does it for user data).
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// CacheKeyVersion bumps when on-disk JSON shapes change. Increment to force
// a rolling-restart cache miss without manual FLUSHDB.
const CacheKeyVersion = "v1"

// DefaultSessionCacheTTL is the per-session-key TTL. 60s matches the bible's
// read-mostly recommendation; write paths invalidate explicitly.
const DefaultSessionCacheTTL = 60 * time.Second

// DefaultReportCacheTTL is the per-report-key TTL. 5min because a finished
// report is immutable until the worker re-runs (rare).
const DefaultReportCacheTTL = 5 * time.Minute

// KV is the tiny subset of Redis the cache needs. *redis.Client satisfies it
// via NewMockRedisKV; tests inject an in-memory map. Kept identical in shape
// to profile/infra so a future shared cache can absorb both.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
// Implementations MUST return this exact error so errors.Is comparisons stay
// cheap on the hot path.
var ErrCacheMiss = errors.New("mock.cache: miss")

// ── redis adapter ─────────────────────────────────────────────────────────

type mockRedisKV struct{ rdb *redis.Client }

// NewMockRedisKV adapts *redis.Client to the KV interface.
func NewMockRedisKV(rdb *redis.Client) KV { return mockRedisKV{rdb: rdb} }

func (r mockRedisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("mock.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r mockRedisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("mock.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r mockRedisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("mock.cache.redisKV.Del: %w", err)
	}
	return nil
}

// ── session cache ─────────────────────────────────────────────────────────

// CachedSessionRepo wraps a delegate domain.SessionRepo with read-through
// Redis caching for Get(). Mutating methods (UpdateStatus / UpdateStress /
// UpdateReport) forward to the delegate and invalidate the cached entry so
// subsequent reads see fresh data.
//
// Compile-time assertion below pins the interface match — wiring code can
// swap CachedSessionRepo in for the raw Sessions adapter transparently.
type CachedSessionRepo struct {
	delegate domain.SessionRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

var _ domain.SessionRepo = (*CachedSessionRepo)(nil)

// NewCachedSessionRepo wraps delegate with Redis caching. Pass nil for log to
// silently discard cache events; pass 0 for ttl to use DefaultSessionCacheTTL.
func NewCachedSessionRepo(delegate domain.SessionRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedSessionRepo {
	if ttl <= 0 {
		ttl = DefaultSessionCacheTTL
	}
	if log == nil {
		panic("ai_mock.infra.NewCachedSessionRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &CachedSessionRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// keySession returns the Redis key for a session.
func keySession(id uuid.UUID) string {
	return fmt.Sprintf("mock:%s:session:%s", CacheKeyVersion, id.String())
}

// Create forwards to the delegate. The new row has nothing to evict.
func (c *CachedSessionRepo) Create(ctx context.Context, s domain.Session) (domain.Session, error) {
	out, err := c.delegate.Create(ctx, s)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.cache.Sessions.Create: %w", err)
	}
	// Pre-warm the cache so the immediate /session/:id read hits.
	c.writeSession(ctx, out)
	return out, nil
}

// Get is the cached read path with singleflight collapsing.
func (c *CachedSessionRepo) Get(ctx context.Context, id uuid.UUID) (domain.Session, error) {
	key := keySession(id)
	if c.kv != nil {
		if raw, err := c.kv.Get(ctx, key); err == nil {
			var s domain.Session
			if jerr := json.Unmarshal([]byte(raw), &s); jerr == nil {
				return s, nil
			}
			c.log.Warn("mock.cache: corrupt session entry, refreshing", slog.String("key", key))
		} else if !errors.Is(err, ErrCacheMiss) {
			c.log.Warn("mock.cache: redis Get failed, falling back",
				slog.String("key", key), slog.Any("err", err))
		}
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.Get(ctx, id)
	})
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.cache.Sessions.Get: %w", err)
	}
	s, ok := v.(domain.Session)
	if !ok {
		return domain.Session{}, fmt.Errorf("mock.cache: singleflight returned %T", v)
	}
	c.writeSession(ctx, s)
	return s, nil
}

// UpdateStatus forwards then invalidates.
func (c *CachedSessionRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status string, finishedAt bool) error {
	if err := c.delegate.UpdateStatus(ctx, id, status, finishedAt); err != nil {
		return fmt.Errorf("mock.cache.Sessions.UpdateStatus: %w", err)
	}
	c.Invalidate(ctx, id)
	return nil
}

// UpdateStress forwards then invalidates.
func (c *CachedSessionRepo) UpdateStress(ctx context.Context, id uuid.UUID, profile domain.StressProfile) error {
	if err := c.delegate.UpdateStress(ctx, id, profile); err != nil {
		return fmt.Errorf("mock.cache.Sessions.UpdateStress: %w", err)
	}
	c.Invalidate(ctx, id)
	return nil
}

// UpdateReport forwards then invalidates BOTH the session key (because
// s.Report changes) and the report cache (because the parsed report changes).
func (c *CachedSessionRepo) UpdateReport(ctx context.Context, id uuid.UUID, reportJSON []byte) error {
	if err := c.delegate.UpdateReport(ctx, id, reportJSON); err != nil {
		return fmt.Errorf("mock.cache.Sessions.UpdateReport: %w", err)
	}
	c.Invalidate(ctx, id)
	c.invalidateReport(ctx, id)
	return nil
}

// Invalidate busts the cached session row. Safe to call on a cold cache.
// Public so app-layer code (event handlers, admin tools) can call it directly
// without going through a mutating method.
func (c *CachedSessionRepo) Invalidate(ctx context.Context, id uuid.UUID) {
	if c.kv == nil {
		return
	}
	if err := c.kv.Del(ctx, keySession(id)); err != nil {
		c.log.Warn("mock.cache: redis Del failed",
			slog.Any("session_id", id), slog.Any("err", err))
	}
}

// invalidateReport mirrors the report key used by CachedReportRepo. Kept on
// CachedSessionRepo because UpdateReport is the single write path that needs
// it — wiring code does NOT have to inject the report cache here.
func (c *CachedSessionRepo) invalidateReport(ctx context.Context, id uuid.UUID) {
	if c.kv == nil {
		return
	}
	if err := c.kv.Del(ctx, keyReport(id)); err != nil {
		c.log.Warn("mock.cache: redis Del failed (report)",
			slog.Any("session_id", id), slog.Any("err", err))
	}
}

func (c *CachedSessionRepo) writeSession(ctx context.Context, s domain.Session) {
	if c.kv == nil {
		return
	}
	data, err := json.Marshal(s)
	if err != nil {
		c.log.Warn("mock.cache: marshal Session failed",
			slog.Any("session_id", s.ID), slog.Any("err", err))
		return
	}
	if err := c.kv.Set(ctx, keySession(s.ID), data, c.ttl); err != nil {
		c.log.Warn("mock.cache: redis Set failed",
			slog.Any("session_id", s.ID), slog.Any("err", err))
	}
}

// ── report cache ──────────────────────────────────────────────────────────

// CachedReport is the on-wire shape we cache for /session/:id/report. We
// cache the parsed draft so the read path skips the per-request
// json.Unmarshal in the GetReport use case.
type CachedReport struct {
	Status string             `json:"status"`
	Report domain.ReportDraft `json:"report"`
}

// ReportCache is a tiny helper around the same KV. It does NOT wrap any repo
// because GetReport sits in app/ and reads directly from SessionRepo (the
// report blob is on the session row). The ports/server.go layer can call
// LookupReport / StoreReport to avoid re-parsing on hot reads.
type ReportCache struct {
	kv  KV
	ttl time.Duration
	log *slog.Logger
}

// NewReportCache builds a report cache. Pass 0 for ttl to use the default.
func NewReportCache(kv KV, ttl time.Duration, log *slog.Logger) *ReportCache {
	if ttl <= 0 {
		ttl = DefaultReportCacheTTL
	}
	if log == nil {
		panic("ai_mock.infra.NewReportCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &ReportCache{kv: kv, ttl: ttl, log: log}
}

// keyReport returns the Redis key for a report.
func keyReport(id uuid.UUID) string {
	return fmt.Sprintf("mock:%s:report:%s", CacheKeyVersion, id.String())
}

// Lookup reads the cached report. Returns (nil, false) on miss or any kind
// of upstream Redis error — Redis errors are NEVER fatal, the caller falls
// through to the slow path.
func (c *ReportCache) Lookup(ctx context.Context, sessionID uuid.UUID) (*CachedReport, bool) {
	if c == nil || c.kv == nil {
		return nil, false
	}
	raw, err := c.kv.Get(ctx, keyReport(sessionID))
	if err != nil {
		if !errors.Is(err, ErrCacheMiss) {
			c.log.Warn("mock.cache: report Get failed, falling back",
				slog.Any("session_id", sessionID), slog.Any("err", err))
		}
		return nil, false
	}
	var out CachedReport
	if jerr := json.Unmarshal([]byte(raw), &out); jerr != nil {
		c.log.Warn("mock.cache: corrupt report entry, refreshing",
			slog.Any("session_id", sessionID))
		return nil, false
	}
	return &out, true
}

// Store writes a parsed report into the cache. Errors are logged + swallowed.
func (c *ReportCache) Store(ctx context.Context, sessionID uuid.UUID, r CachedReport) {
	if c == nil || c.kv == nil {
		return
	}
	data, err := json.Marshal(r)
	if err != nil {
		c.log.Warn("mock.cache: marshal report failed",
			slog.Any("session_id", sessionID), slog.Any("err", err))
		return
	}
	if err := c.kv.Set(ctx, keyReport(sessionID), data, c.ttl); err != nil {
		c.log.Warn("mock.cache: redis Set report failed",
			slog.Any("session_id", sessionID), slog.Any("err", err))
	}
}

// Invalidate busts a single cached report. Called on UpdateReport (worker
// regeneration) so that a subsequent GetReport sees the new blob.
func (c *ReportCache) Invalidate(ctx context.Context, sessionID uuid.UUID) {
	if c == nil || c.kv == nil {
		return
	}
	if err := c.kv.Del(ctx, keyReport(sessionID)); err != nil {
		c.log.Warn("mock.cache: redis Del report failed",
			slog.Any("session_id", sessionID), slog.Any("err", err))
	}
}
