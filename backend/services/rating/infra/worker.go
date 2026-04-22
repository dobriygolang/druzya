// Package infra: worker.go contains the LeaderboardRecomputeWorker — a
// fire-and-forget background goroutine that periodically rebuilds Redis
// Sorted Sets (ZADD) from Postgres so /rating/leaderboard reads are O(log n)
// independent of the underlying user count.
//
// One ZSET per (section, mode) tuple is written under the key
// `leaderboard:v1:<section>:<mode>` with score = ELO. A small meta key
// `leaderboard:v1:meta:<section>:<mode>` records the last successful
// recompute timestamp so /admin and /status pages can show staleness.
//
// Errors against Postgres or Redis are logged and the worker keeps ticking
// — leaderboard staleness is preferable to a crash loop. Graceful shutdown
// is honoured via the context passed to Run.
package infra

import (
	"context"
	"fmt"
	"log/slog"
	"sync/atomic"
	"time"

	"druz9/rating/domain"
	"druz9/shared/enums"

	"github.com/redis/go-redis/v9"
)

// DefaultRecomputeInterval is the cadence at which leaderboard ZSETs are
// rebuilt. 5 minutes balances Postgres load against UI freshness; the
// per-request cache (LeaderboardCache, redis.go) absorbs sub-minute reads.
const DefaultRecomputeInterval = 5 * time.Minute

// DefaultRecomputeLimit is the cap on entries persisted per (section, mode).
// 1000 covers every realistic leaderboard view (top-100 with room to grow).
const DefaultRecomputeLimit = 1000

// leaderboardSections is the canonical list of sections the worker rebuilds
// each tick. Mode is intentionally a single "all" bucket today — multi-mode
// scoring (ranked / hardcore / cursed) is a follow-up that adds rows here.
var leaderboardSections = []enums.Section{
	enums.SectionAlgorithms,
	enums.SectionSQL,
	enums.SectionGo,
	enums.SectionSystemDesign,
	enums.SectionBehavioral,
}

// LeaderboardZSetClient is the minimal Redis surface used by the worker.
// *redis.Client satisfies it; tests inject an in-memory fake.
type LeaderboardZSetClient interface {
	Del(ctx context.Context, keys ...string) error
	ZAdd(ctx context.Context, key string, members ...ZMember) error
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
}

// ZMember is a minimal redis.Z mirror so the worker doesn't leak the
// concrete redis types into tests.
type ZMember struct {
	Score  float64
	Member string
}

// redisZSetAdapter wraps *redis.Client to satisfy LeaderboardZSetClient.
type redisZSetAdapter struct{ rdb *redis.Client }

// NewRedisZSetClient adapts a *redis.Client for the worker.
func NewRedisZSetClient(rdb *redis.Client) LeaderboardZSetClient {
	return redisZSetAdapter{rdb: rdb}
}

func (a redisZSetAdapter) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := a.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("rating.worker.zsetAdapter.Del: %w", err)
	}
	return nil
}

func (a redisZSetAdapter) ZAdd(ctx context.Context, key string, members ...ZMember) error {
	if len(members) == 0 {
		return nil
	}
	zs := make([]redis.Z, 0, len(members))
	for _, m := range members {
		zs = append(zs, redis.Z{Score: m.Score, Member: m.Member})
	}
	if err := a.rdb.ZAdd(ctx, key, zs...).Err(); err != nil {
		return fmt.Errorf("rating.worker.zsetAdapter.ZAdd: %w", err)
	}
	return nil
}

func (a redisZSetAdapter) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	if err := a.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("rating.worker.zsetAdapter.Set: %w", err)
	}
	return nil
}

// LeaderboardRecomputeWorker rebuilds leaderboard ZSETs on a fixed
// interval. Construct via NewLeaderboardRecomputeWorker and start with
// `go w.Run(ctx)` (the bootstrap wraps that for us).
type LeaderboardRecomputeWorker struct {
	repo     domain.RatingRepo
	rdb      LeaderboardZSetClient
	log      *slog.Logger
	interval time.Duration
	limit    int

	// ticks is incremented on every successful loop iteration — exposed for
	// tests and metrics dashboards.
	ticks atomic.Int64
}

// NewLeaderboardRecomputeWorker returns a worker that runs every `interval`
// and persists up to `limit` entries per section. interval / limit get
// safe defaults if non-positive.
func NewLeaderboardRecomputeWorker(
	repo domain.RatingRepo,
	rdb LeaderboardZSetClient,
	log *slog.Logger,
	interval time.Duration,
	limit int,
) *LeaderboardRecomputeWorker {
	if interval <= 0 {
		interval = DefaultRecomputeInterval
	}
	if limit <= 0 {
		limit = DefaultRecomputeLimit
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &LeaderboardRecomputeWorker{
		repo: repo, rdb: rdb, log: log,
		interval: interval, limit: limit,
	}
}

// Ticks returns the number of completed recompute iterations. Test-only.
func (w *LeaderboardRecomputeWorker) Ticks() int64 { return w.ticks.Load() }

// Run blocks until ctx is cancelled, recomputing every interval.
//
// It runs an initial pass immediately so a fresh process has a populated
// leaderboard before the first user hits /rating.
func (w *LeaderboardRecomputeWorker) Run(ctx context.Context) {
	w.log.Info("rating.worker: starting", slog.Duration("interval", w.interval))
	w.recomputeAll(ctx)
	w.ticks.Add(1)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			w.log.Info("rating.worker: shutdown")
			return
		case <-ticker.C:
			w.recomputeAll(ctx)
			w.ticks.Add(1)
		}
	}
}

// recomputeAll iterates every section and rebuilds its ZSET. Per-section
// errors are logged and swallowed — one bad section MUST NOT take down the
// recompute loop.
func (w *LeaderboardRecomputeWorker) recomputeAll(ctx context.Context) {
	for _, section := range leaderboardSections {
		if ctx.Err() != nil {
			return
		}
		if err := w.recomputeOne(ctx, section); err != nil {
			w.log.Warn("rating.worker: recompute failed",
				slog.String("section", string(section)), slog.Any("err", err))
		}
	}
}

// recomputeOne rebuilds a single section's ZSET in two writes (DEL + ZADD)
// followed by a small meta key. Order matters: DEL first so a partial write
// on shutdown leaves the ZSET empty rather than stale.
func (w *LeaderboardRecomputeWorker) recomputeOne(ctx context.Context, section enums.Section) error {
	rows, err := w.repo.Top(ctx, section, w.limit)
	if err != nil {
		return fmt.Errorf("repo.Top: %w", err)
	}
	key := LeaderboardZSetKey(section, "all")
	metaKey := LeaderboardMetaKey(section, "all")

	if err := w.rdb.Del(ctx, key); err != nil {
		return fmt.Errorf("rdb.Del: %w", err)
	}
	if len(rows) == 0 {
		// Empty section is fine — record the meta tick and move on.
		_ = w.rdb.Set(ctx, metaKey, time.Now().UTC().Format(time.RFC3339), 0)
		return nil
	}
	members := make([]ZMember, 0, len(rows))
	for _, r := range rows {
		members = append(members, ZMember{
			Score:  float64(r.Elo),
			Member: r.UserID.String(),
		})
	}
	if err := w.rdb.ZAdd(ctx, key, members...); err != nil {
		return fmt.Errorf("rdb.ZAdd: %w", err)
	}
	if err := w.rdb.Set(ctx, metaKey, time.Now().UTC().Format(time.RFC3339), 0); err != nil {
		// Meta failure is informational only — log and proceed.
		w.log.Warn("rating.worker: meta set failed",
			slog.String("key", metaKey), slog.Any("err", err))
	}
	return nil
}

// LeaderboardZSetKey is the canonical Redis key for the (section, mode)
// ZSET. Exposed so callers (admin tools, the leaderboard handler) can read
// the same key the worker writes.
func LeaderboardZSetKey(section enums.Section, mode string) string {
	if mode == "" {
		mode = "all"
	}
	return fmt.Sprintf("leaderboard:%s:%s:%s", CacheKeyVersion, section, mode)
}

// LeaderboardMetaKey is the companion key recording the last recompute time.
func LeaderboardMetaKey(section enums.Section, mode string) string {
	if mode == "" {
		mode = "all"
	}
	return fmt.Sprintf("leaderboard:%s:meta:%s:%s", CacheKeyVersion, section, mode)
}
