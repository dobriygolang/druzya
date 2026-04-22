// Package infra: cache.go contains the Redis-backed read-through cache for
// the profile bounded context. It wraps a delegate ProfileRepo (typically the
// Postgres one) and serves the most-frequently-read endpoints out of Redis
// with an explicit TTL and an explicit Invalidate hook so write-paths can
// bust the cache deterministically.
//
// Design notes:
//
//   - We deliberately introduce a tiny KV interface (Get/Set/Del) instead of
//     pinning to *redis.Client directly. Production wires
//     redisKV{*redis.Client}; tests inject an in-memory implementation. This
//     keeps the test suite hermetic without adding a miniredis dependency.
//
//   - A username → user-id index key is maintained so that GetPublic can be
//     invalidated by user-id alone (no separate username lookup on the write
//     path). On miss we fetch by username from the upstream and write both
//     keys.
//
//   - singleflight collapses concurrent cache misses for the same key into a
//     single upstream call, preventing thundering-herd against Postgres when
//     a hot profile expires.
//
//   - Redis errors NEVER fail the request — they are logged and we fall back
//     to the upstream. This makes the cache an availability-positive
//     component. Tests cover the fallback path explicitly.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultProfileCacheTTL is the per-key TTL applied to profile cache entries.
// 60 seconds is the bible's recommended baseline for read-mostly user data;
// write paths invalidate explicitly so freshness on edit is sub-second.
const DefaultProfileCacheTTL = 60 * time.Second

// CacheKeyVersion is the prefix bump used when the on-disk JSON shape
// changes. Increment to force a rolling-restart cache miss without manual
// FLUSHDB. Bumped together with breaking changes to domain.Bundle /
// domain.PublicBundle.
const CacheKeyVersion = "v1"

// KV is the tiny subset of Redis used by the cache. *redis.Client satisfies
// it via the redisKV adapter below; tests provide an in-memory map.
//
// We intentionally do NOT widen this interface — every additional method
// inflates the test surface and the in-memory fake. Stick to Get/Set/Del.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
// Implementations MUST return this exact error (not a wrapped variant) so
// that errors.Is comparisons in the cache logic stay cheap.
var ErrCacheMiss = errors.New("profile.cache: miss")

// ── redis adapter ──────────────────────────────────────────────────────────

// redisKV adapts *redis.Client to the KV interface, mapping redis.Nil onto
// our local ErrCacheMiss sentinel.
type redisKV struct{ rdb *redis.Client }

// NewRedisKV exposes the adapter so wiring code can construct a CachedRepo
// without leaking the redisKV type.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("profile.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("profile.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("profile.cache.redisKV.Del: %w", err)
	}
	return nil
}

// ── cache wrapper ──────────────────────────────────────────────────────────

// CachedRepo wraps a delegate ProfileRepo with read-through Redis caching.
// It implements domain.ProfileRepo so wiring is a one-line swap.
type CachedRepo struct {
	delegate domain.ProfileRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// Compile-time assertion — CachedRepo satisfies the same interface as the
// Postgres repo, so wiring code can swap them transparently.
var _ domain.ProfileRepo = (*CachedRepo)(nil)

// NewCachedRepo wraps delegate with Redis caching.
//
// If log is nil, a discard logger is used so this struct is safe to construct
// in tests without plumbing a slog.Handler.
func NewCachedRepo(delegate domain.ProfileRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedRepo {
	if ttl <= 0 {
		ttl = DefaultProfileCacheTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// keyByID returns the Redis key for the full bundle by user-id.
func keyByID(uid uuid.UUID) string {
	return fmt.Sprintf("profile:%s:by_id:%s", CacheKeyVersion, uid.String())
}

// keyPublic returns the Redis key for the public bundle by username.
// The username is lower-cased to make the cache case-insensitive (matching
// the way the public profile is typically queried from the URL).
func keyPublic(username string) string {
	return fmt.Sprintf("profile:%s:public:%s", CacheKeyVersion, strings.ToLower(username))
}

// keyUsernameIndex maps lower(username) → user-id, used by Invalidate to bust
// the public key when only the user-id is known.
func keyUsernameIndex(uid uuid.UUID) string {
	return fmt.Sprintf("profile:%s:idx:uid_to_username:%s", CacheKeyVersion, uid.String())
}

// GetByUserID is the cached path for /profile/me. Read-through with
// singleflight collapsing.
func (c *CachedRepo) GetByUserID(ctx context.Context, userID uuid.UUID) (domain.Bundle, error) {
	key := keyByID(userID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var b domain.Bundle
		if jerr := json.Unmarshal([]byte(raw), &b); jerr == nil {
			return b, nil
		}
		// Corrupt cache entry — log and fall through to refresh.
		c.log.Warn("profile.cache: corrupt by_id entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Redis error: log and fall back to upstream WITHOUT failing the request.
		c.log.Warn("profile.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetByUserID(ctx, userID)
	})
	if err != nil {
		return domain.Bundle{}, fmt.Errorf("profile.cache.GetByUserID: %w", err)
	}
	b, ok := v.(domain.Bundle)
	if !ok {
		return domain.Bundle{}, fmt.Errorf("profile.cache: singleflight returned %T", v)
	}
	c.writeBundle(ctx, key, b)
	// Maintain the username index so Invalidate(uid) can bust the public key.
	if b.User.Username != "" {
		_ = c.kv.Set(ctx, keyUsernameIndex(userID), []byte(strings.ToLower(b.User.Username)), c.ttl)
	}
	return b, nil
}

// GetPublic is the cached path for /profile/{username}.
func (c *CachedRepo) GetPublic(ctx context.Context, username string) (domain.PublicBundle, error) {
	key := keyPublic(username)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var b domain.PublicBundle
		if jerr := json.Unmarshal([]byte(raw), &b); jerr == nil {
			return b, nil
		}
		c.log.Warn("profile.cache: corrupt public entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("profile.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetPublic(ctx, username)
	})
	if err != nil {
		return domain.PublicBundle{}, fmt.Errorf("profile.cache.GetPublic: %w", err)
	}
	b, ok := v.(domain.PublicBundle)
	if !ok {
		return domain.PublicBundle{}, fmt.Errorf("profile.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(b); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			c.log.Warn("profile.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
		// Maintain the reverse index too for symmetric invalidation.
		if b.User.ID != uuid.Nil {
			_ = c.kv.Set(ctx, keyUsernameIndex(b.User.ID), []byte(strings.ToLower(b.User.Username)), c.ttl)
		}
	}
	return b, nil
}

// writeBundle is the shared marshal+set used by GetByUserID. Errors are
// logged and swallowed.
func (c *CachedRepo) writeBundle(ctx context.Context, key string, b domain.Bundle) {
	data, err := json.Marshal(b)
	if err != nil {
		c.log.Warn("profile.cache: marshal Bundle failed",
			slog.String("key", key), slog.Any("err", err))
		return
	}
	if err := c.kv.Set(ctx, key, data, c.ttl); err != nil {
		c.log.Warn("profile.cache: redis Set failed",
			slog.String("key", key), slog.Any("err", err))
	}
}

// Invalidate busts every cache key tied to userID. Safe to call without a
// known username — the reverse index lets us derive the public key.
//
// This is the canonical write-path hook: any code that mutates the user's
// profile (settings, XP, rating, career stage) MUST call Invalidate or the
// dedicated Bump helper on the wired CachedRepo.
func (c *CachedRepo) Invalidate(ctx context.Context, userID uuid.UUID) {
	keys := []string{keyByID(userID)}
	if raw, err := c.kv.Get(ctx, keyUsernameIndex(userID)); err == nil && raw != "" {
		keys = append(keys, keyPublic(raw), keyUsernameIndex(userID))
	} else {
		// Even without the index we still try to delete the index key — it's
		// a no-op if absent and saves a stale pointer.
		keys = append(keys, keyUsernameIndex(userID))
	}
	if err := c.kv.Del(ctx, keys...); err != nil {
		c.log.Warn("profile.cache: redis Del failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// InvalidateUsername busts the public key for username only. Used when a
// request mutates someone else's profile (admin tools) and we don't have the
// uid handy.
func (c *CachedRepo) InvalidateUsername(ctx context.Context, username string) {
	if username == "" {
		return
	}
	if err := c.kv.Del(ctx, keyPublic(username)); err != nil {
		c.log.Warn("profile.cache: redis Del failed (username)",
			slog.String("username", username), slog.Any("err", err))
	}
}

// ── pass-through methods ───────────────────────────────────────────────────
//
// These don't currently cache; they delegate straight through. We invalidate
// after writes so subsequent reads repopulate.

// EnsureDefaults forwards to the delegate. New users have nothing to evict.
func (c *CachedRepo) EnsureDefaults(ctx context.Context, userID uuid.UUID) error {
	if err := c.delegate.EnsureDefaults(ctx, userID); err != nil {
		return fmt.Errorf("profile.cache.EnsureDefaults: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// ApplyXPDelta forwards then invalidates.
func (c *CachedRepo) ApplyXPDelta(ctx context.Context, userID uuid.UUID, addXP int, newLevel int, remainderXP int64) error {
	if err := c.delegate.ApplyXPDelta(ctx, userID, addXP, newLevel, remainderXP); err != nil {
		return fmt.Errorf("profile.cache.ApplyXPDelta: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// UpdateCareerStage forwards then invalidates.
func (c *CachedRepo) UpdateCareerStage(ctx context.Context, userID uuid.UUID, stage domain.CareerStage) error {
	if err := c.delegate.UpdateCareerStage(ctx, userID, stage); err != nil {
		return fmt.Errorf("profile.cache.UpdateCareerStage: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// GetSettings is uncached — settings are written rarely but read on the
// settings page only, so the cost/benefit doesn't pencil out today.
// TODO Phase 2: cache settings under profile:v1:settings:<uid> if hot.
func (c *CachedRepo) GetSettings(ctx context.Context, userID uuid.UUID) (domain.Settings, error) {
	s, err := c.delegate.GetSettings(ctx, userID)
	if err != nil {
		return domain.Settings{}, fmt.Errorf("profile.cache.GetSettings: %w", err)
	}
	return s, nil
}

// UpdateSettings forwards then invalidates the bundle (display_name lives
// inside the cached User and would otherwise go stale).
func (c *CachedRepo) UpdateSettings(ctx context.Context, userID uuid.UUID, s domain.Settings) error {
	if err := c.delegate.UpdateSettings(ctx, userID, s); err != nil {
		return fmt.Errorf("profile.cache.UpdateSettings: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// ListSkillNodes — uncached pass-through (atlas page only, separate hot path).
func (c *CachedRepo) ListSkillNodes(ctx context.Context, userID uuid.UUID) ([]domain.SkillNode, error) {
	out, err := c.delegate.ListSkillNodes(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("profile.cache.ListSkillNodes: %w", err)
	}
	return out, nil
}

// ListRatings — uncached pass-through; ratings are joined into the bundle and
// cached together, so direct callers (event handlers) always read fresh.
func (c *CachedRepo) ListRatings(ctx context.Context, userID uuid.UUID) ([]domain.SectionRating, error) {
	out, err := c.delegate.ListRatings(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("profile.cache.ListRatings: %w", err)
	}
	return out, nil
}

// CountRecentActivity — uncached; report endpoint is its own cache concern.
func (c *CachedRepo) CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (domain.Activity, error) {
	a, err := c.delegate.CountRecentActivity(ctx, userID, since)
	if err != nil {
		return domain.Activity{}, fmt.Errorf("profile.cache.CountRecentActivity: %w", err)
	}
	return a, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

// discardWriter is an io.Writer that swallows all bytes. Used as the default
// slog handler destination when callers pass nil.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
