// Package infra: cache.go contains the Redis-backed read-through cache for
// the guild bounded context. It mirrors profile/infra/cache.go (Phase 1) and
// rating/infra/cache.go (Phase 2):
//
//   - Tiny KV interface (Get/Set/Del) so tests inject an in-memory fake;
//   - singleflight collapses concurrent misses against the same key;
//   - Redis errors NEVER fail the request — they are logged and we fall back
//     to the upstream Postgres repo;
//   - Write-path hooks (Invalidate / InvalidateUser / InvalidateTop) bust
//     the relevant keys; the top-list relies primarily on TTL because guild
//     ELO mutates rarely (week-end sweeps).
//
// Cache key map (60s TTL on per-guild reads, 5m TTL on the global top-list):
//
//	guild:v1:by_id:<guild_uuid>      → JSON(domain.Guild + members)
//	guild:v1:my:<user_uuid>          → JSON(domain.Guild + members)
//	guild:v1:idx:user_to_guild:<uid> → guild_uuid (string), so Invalidate(guildID)
//	                                   can also clear the user's :my key without
//	                                   knowing every membership up-front.
//	guild:v1:top:<limit>             → JSON([]domain.TopGuildSummary)
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/guild/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultGuildCacheTTL is the TTL applied to per-guild and per-user keys.
// 60s mirrors the Phase 1 baseline for read-mostly user-scoped projections.
const DefaultGuildCacheTTL = 60 * time.Second

// DefaultTopGuildsCacheTTL is the TTL applied to the global top-list. The
// leaderboard mutates rarely (only when guild_elo or wars_won changes) so
// 5 minutes is fine; we still invalidate explicitly on Contribute.
const DefaultTopGuildsCacheTTL = 5 * time.Minute

// CacheKeyVersion is the prefix bump used when the on-disk JSON shape
// changes. Bump together with breaking changes to the domain entities.
const CacheKeyVersion = "v1"

// KV is the minimal Redis subset used by CachedRepo. *redis.Client satisfies
// it via the redisKV adapter; tests inject an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
var ErrCacheMiss = errors.New("guild.cache: miss")

// ── redis adapter ──────────────────────────────────────────────────────────

// redisKV adapts *redis.Client to the KV interface.
type redisKV struct{ rdb *redis.Client }

// NewRedisKV exposes the adapter so wiring code can construct CachedRepo
// without leaking the redisKV type.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("guild.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("guild.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("guild.cache.redisKV.Del: %w", err)
	}
	return nil
}

// ── key helpers ────────────────────────────────────────────────────────────

func keyByID(guildID uuid.UUID) string {
	return fmt.Sprintf("guild:%s:by_id:%s", CacheKeyVersion, guildID.String())
}

func keyMyByUser(userID uuid.UUID) string {
	return fmt.Sprintf("guild:%s:my:%s", CacheKeyVersion, userID.String())
}

func keyUserToGuild(userID uuid.UUID) string {
	return fmt.Sprintf("guild:%s:idx:user_to_guild:%s", CacheKeyVersion, userID.String())
}

func keyTop(limit int) string {
	return fmt.Sprintf("guild:%s:top:%d", CacheKeyVersion, limit)
}

// ── cache wrapper ──────────────────────────────────────────────────────────

// CachedRepo wraps a delegate domain.GuildRepo with read-through Redis
// caching. It implements domain.GuildRepo so wiring is a one-line swap.
type CachedRepo struct {
	delegate domain.GuildRepo
	kv       KV
	ttl      time.Duration
	topTTL   time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// Compile-time assertion — CachedRepo satisfies the upstream interface.
var _ domain.GuildRepo = (*CachedRepo)(nil)

// NewCachedRepo wraps delegate with Redis caching. Pass 0 for either ttl
// argument to use the package defaults; pass nil log for a discard logger.
func NewCachedRepo(delegate domain.GuildRepo, kv KV, ttl, topTTL time.Duration, log *slog.Logger) *CachedRepo {
	if ttl <= 0 {
		ttl = DefaultGuildCacheTTL
	}
	if topTTL <= 0 {
		topTTL = DefaultTopGuildsCacheTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedRepo{delegate: delegate, kv: kv, ttl: ttl, topTTL: topTTL, log: log}
}

// ── reads ──────────────────────────────────────────────────────────────────

// GetGuild is the cached path for /guild/{id}. Read-through with
// singleflight collapsing.
func (c *CachedRepo) GetGuild(ctx context.Context, id uuid.UUID) (domain.Guild, error) {
	key := keyByID(id)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var g domain.Guild
		if jerr := json.Unmarshal([]byte(raw), &g); jerr == nil {
			return g, nil
		}
		c.log.Warn("guild.cache: corrupt by_id entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("guild.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetGuild(ctx, id)
	})
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.cache.GetGuild: %w", err)
	}
	g, ok := v.(domain.Guild)
	if !ok {
		return domain.Guild{}, fmt.Errorf("guild.cache: singleflight returned %T", v)
	}
	c.write(ctx, key, g, c.ttl)
	return g, nil
}

// GetMyGuild is the cached path for /guild/my. We also persist a reverse
// index (user_id → guild_id) so future Invalidate(guildID) calls can flush
// the per-user keys without an extra round-trip to Postgres.
func (c *CachedRepo) GetMyGuild(ctx context.Context, userID uuid.UUID) (domain.Guild, error) {
	key := keyMyByUser(userID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var g domain.Guild
		if jerr := json.Unmarshal([]byte(raw), &g); jerr == nil {
			return g, nil
		}
		c.log.Warn("guild.cache: corrupt my entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("guild.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetMyGuild(ctx, userID)
	})
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.cache.GetMyGuild: %w", err)
	}
	g, ok := v.(domain.Guild)
	if !ok {
		return domain.Guild{}, fmt.Errorf("guild.cache: singleflight returned %T", v)
	}
	c.write(ctx, key, g, c.ttl)
	if g.ID != uuid.Nil {
		_ = c.kv.Set(ctx, keyUserToGuild(userID), []byte(g.ID.String()), c.ttl)
	}
	return g, nil
}

// ListTopGuilds caches the global guild leaderboard. Keyed by limit so a
// caller asking for top-20 doesn't share an entry with a caller asking for
// top-100. TTL is intentionally longer (5m) — the leaderboard moves slowly.
func (c *CachedRepo) ListTopGuilds(ctx context.Context, limit int) ([]domain.TopGuildSummary, error) {
	key := keyTop(limit)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.TopGuildSummary
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("guild.cache: corrupt top entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("guild.cache: redis Get failed, falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.ListTopGuilds(ctx, limit)
	})
	if err != nil {
		return nil, fmt.Errorf("guild.cache.ListTopGuilds: %w", err)
	}
	out, ok := v.([]domain.TopGuildSummary)
	if !ok {
		return nil, fmt.Errorf("guild.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.topTTL); serr != nil {
			c.log.Warn("guild.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// ── pass-through reads (uncached) ──────────────────────────────────────────

// ListGuildMembers — uncached pass-through; the members list is already
// embedded in the cached Guild bundle when callers go through GetGuild.
// Direct callers (the use-case layer hydrating GetMyGuild) read fresh.
func (c *CachedRepo) ListGuildMembers(ctx context.Context, guildID uuid.UUID) ([]domain.Member, error) {
	out, err := c.delegate.ListGuildMembers(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("guild.cache.ListGuildMembers: %w", err)
	}
	return out, nil
}

// GetMember — uncached; called only from Contribute which is a write path.
func (c *CachedRepo) GetMember(ctx context.Context, guildID, userID uuid.UUID) (domain.Member, error) {
	m, err := c.delegate.GetMember(ctx, guildID, userID)
	if err != nil {
		return domain.Member{}, fmt.Errorf("guild.cache.GetMember: %w", err)
	}
	return m, nil
}

// ── writes (forward + invalidate) ──────────────────────────────────────────

// UpsertGuild forwards then invalidates the guild's by_id key plus every
// top-N entry (we don't know which limits are populated — best to nuke all).
func (c *CachedRepo) UpsertGuild(ctx context.Context, g domain.Guild) (domain.Guild, error) {
	out, err := c.delegate.UpsertGuild(ctx, g)
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.cache.UpsertGuild: %w", err)
	}
	c.Invalidate(ctx, out.ID)
	c.InvalidateTop(ctx)
	return out, nil
}

// ── invalidation API ───────────────────────────────────────────────────────

// Invalidate busts the per-guild key. Safe to call without a known user-id —
// per-user keys live independently and expire on their own TTL.
func (c *CachedRepo) Invalidate(ctx context.Context, guildID uuid.UUID) {
	if err := c.kv.Del(ctx, keyByID(guildID)); err != nil {
		c.log.Warn("guild.cache: redis Del failed (by_id)",
			slog.Any("guild_id", guildID), slog.Any("err", err))
	}
}

// InvalidateUser busts the per-user `:my` key plus its reverse index.
// Callers that mutate membership (join/leave) should call this in addition
// to Invalidate(guildID).
func (c *CachedRepo) InvalidateUser(ctx context.Context, userID uuid.UUID) {
	if err := c.kv.Del(ctx, keyMyByUser(userID), keyUserToGuild(userID)); err != nil {
		c.log.Warn("guild.cache: redis Del failed (my)",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// InvalidateTop busts the global top-N entries. We don't know which limits
// were populated so we use a small fixed set — anything outside is left to
// expire by TTL. The set covers the limits the UI realistically uses.
func (c *CachedRepo) InvalidateTop(ctx context.Context) {
	keys := make([]string, 0, len(commonTopLimits))
	for _, lim := range commonTopLimits {
		keys = append(keys, keyTop(lim))
	}
	if err := c.kv.Del(ctx, keys...); err != nil {
		c.log.Warn("guild.cache: redis Del failed (top)",
			slog.Any("err", err))
	}
}

// commonTopLimits are the page-sizes the UI ships with. Adding more here is
// cheap (one extra DEL); using a wildcard would require KEYS/SCAN which is
// not appropriate inside a hot write path.
var commonTopLimits = []int{10, 20, 50, 100}

// InvalidateMatchParticipants is the convenience hook called by the
// MatchCompleted subscriber: it nukes the per-guild key for both the
// winner's guild and the listed losers' guilds (if any), plus the top-list
// (the wars_won counter is now stale).
//
// If a participant has no guild, GetMyGuild returns ErrNotFound and we
// silently skip them.
func (c *CachedRepo) InvalidateMatchParticipants(ctx context.Context, userIDs ...uuid.UUID) {
	for _, uid := range userIDs {
		if uid == uuid.Nil {
			continue
		}
		// Look up cached guild via the reverse index — avoids an upstream
		// round trip. If it isn't cached we leave that user's key alone
		// (it'll expire on its own).
		if raw, err := c.kv.Get(ctx, keyUserToGuild(uid)); err == nil && raw != "" {
			if gid, perr := uuid.Parse(raw); perr == nil {
				c.Invalidate(ctx, gid)
			}
		}
		c.InvalidateUser(ctx, uid)
	}
	c.InvalidateTop(ctx)
}

// ── helpers ────────────────────────────────────────────────────────────────

// write marshals and stores a guild bundle, swallowing+logging any error.
func (c *CachedRepo) write(ctx context.Context, key string, g domain.Guild, ttl time.Duration) {
	data, err := json.Marshal(g)
	if err != nil {
		c.log.Warn("guild.cache: marshal Guild failed",
			slog.String("key", key), slog.Any("err", err))
		return
	}
	if err := c.kv.Set(ctx, key, data, ttl); err != nil {
		c.log.Warn("guild.cache: redis Set failed",
			slog.String("key", key), slog.Any("err", err))
	}
}

// discardWriter swallows everything — default slog destination when nil.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
