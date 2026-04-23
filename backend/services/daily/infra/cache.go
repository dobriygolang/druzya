// Package infra: cache.go contains a Redis-backed read-through cache for
// the StreakRepo — the hottest read in the daily bounded context (every
// /daily/* page hits GetStreak, plus the sanctum hero card).
//
// Mirrors the pattern in profile/infra/cache.go and rating/infra/cache.go:
//
//   - Tiny KV interface (Get/Set/Del) injected at construction so tests
//     don't need miniredis;
//   - singleflight collapses concurrent misses for the same uid;
//   - Anti-fallback policy: Redis Get failures propagate as real errors;
//     Set failures emit cache_set_errors_total so ops can alert without
//     failing the read (we already have the value from upstream).
//   - Update forwards to the delegate then Invalidate(uid). The use case
//     SubmitKata calls StreakRepo.Update on success, so cache freshness is
//     sub-second on writes.
//
// Phase 2 closing: CachedKataRepo and CachedCalendarRepo extend the same
// pattern. CachedKataRepo wraps HistoryLast30 (powers GetStreak history
// rendering and SubmitKata's "already done today?" check) keyed by
// (uid, today) with TTL until the next UTC midnight — so the cached row
// auto-expires when the kata-day rolls over without manual cron. CachedCalendarRepo
// wraps GetActive(uid, today) keyed by (uid, YYYY-MM) with a flat 60s TTL —
// the active interview calendar is rarely-read but bursty around the
// /daily/calendar page mount; the per-month bucket means UpsertCalendar
// always invalidates the bucket the user is currently looking at.
//
// AutopsyRepo is still write-mostly so we leave it alone.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/daily/domain"
	"druz9/shared/pkg/metrics"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultStreakTTL is the per-key TTL applied to streak cache entries.
// 60s keeps mid-flight rollovers fresh enough for the UI; the write path
// (SubmitKata) invalidates explicitly so post-submit reads are immediate.
const DefaultStreakTTL = 60 * time.Second

// CacheKeyVersion bump rolls every key on a schema change without manual
// FLUSHDB.
const CacheKeyVersion = "v1"

// KV is the minimal Redis surface used here. *redis.Client satisfies it
// via NewRedisKV; tests use an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
}

// ErrCacheMiss is the sentinel returned by KV.Get when the key is absent.
var ErrCacheMiss = errors.New("daily.cache: miss")

type redisKV struct{ rdb *redis.Client }

// NewRedisKV adapts *redis.Client to KV.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("daily.cache.redisKV.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("daily.cache.redisKV.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("daily.cache.redisKV.Del: %w", err)
	}
	return nil
}

// keyStreak is the per-user streak Redis key.
func keyStreak(uid uuid.UUID) string {
	return fmt.Sprintf("daily:%s:streak:%s", CacheKeyVersion, uid.String())
}

// CachedStreakRepo wraps a domain.StreakRepo with read-through caching.
type CachedStreakRepo struct {
	delegate domain.StreakRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

// Compile-time: satisfies domain.StreakRepo so wiring is a one-line swap.
var _ domain.StreakRepo = (*CachedStreakRepo)(nil)

// NewCachedStreakRepo wraps delegate. Defaults: TTL = DefaultStreakTTL.
// log is required (anti-fallback policy).
func NewCachedStreakRepo(delegate domain.StreakRepo, kv KV, ttl time.Duration, log *slog.Logger) *CachedStreakRepo {
	if ttl <= 0 {
		ttl = DefaultStreakTTL
	}
	if log == nil {
		panic("daily.infra.NewCachedStreakRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &CachedStreakRepo{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// Get is the cached path. Read-through with singleflight collapsing.
func (c *CachedStreakRepo) Get(ctx context.Context, userID uuid.UUID) (domain.StreakState, error) {
	key := keyStreak(userID)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var s domain.StreakState
		if jerr := json.Unmarshal([]byte(raw), &s); jerr == nil {
			return s, nil
		}
		c.log.Warn("daily.cache: corrupt streak entry, refreshing",
			slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return domain.StreakState{}, fmt.Errorf("daily.cache.Get: redis: %w", err)
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.Get(ctx, userID)
	})
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("daily.cache.Get: %w", err)
	}
	s, ok := v.(domain.StreakState)
	if !ok {
		return domain.StreakState{}, fmt.Errorf("daily.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(s); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("daily_streak").Inc()
			c.log.Warn("daily.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return s, nil
}

// Update forwards to the delegate then busts the user's streak key. This
// is the canonical write hook called by app.SubmitKata after grading.
func (c *CachedStreakRepo) Update(ctx context.Context, userID uuid.UUID, s domain.StreakState) error {
	if err := c.delegate.Update(ctx, userID, s); err != nil {
		return fmt.Errorf("daily.cache.Update: %w", err)
	}
	c.Invalidate(ctx, userID)
	return nil
}

// Invalidate busts the streak key for the given user.
func (c *CachedStreakRepo) Invalidate(ctx context.Context, userID uuid.UUID) {
	if err := c.kv.Del(ctx, keyStreak(userID)); err != nil {
		c.log.Warn("daily.cache: redis Del failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// ── KataRepo cache ────────────────────────────────────────────────────────

// DefaultKataMinTTL is the minimum TTL applied to kata history cache entries.
// Even when the request lands seconds before UTC midnight we keep the entry
// alive briefly so the immediate follow-up read still hits the cache.
const DefaultKataMinTTL = 60 * time.Second

// dateFmt is the canonical YYYY-MM-DD layout used in cache keys.
const dateFmt = "2006-01-02"

// monthFmt is YYYY-MM, used by the calendar key.
const monthFmt = "2006-01"

// keyKataHistory returns the per-user, per-day Redis key for HistoryLast30.
func keyKataHistory(uid uuid.UUID, today time.Time) string {
	return fmt.Sprintf("daily:%s:kata:%s:%s", CacheKeyVersion, uid.String(), today.UTC().Format(dateFmt))
}

// keyCalendar returns the per-user, per-month Redis key for GetActive.
func keyCalendar(uid uuid.UUID, today time.Time) string {
	return fmt.Sprintf("daily:%s:calendar:%s:%s", CacheKeyVersion, uid.String(), today.UTC().Format(monthFmt))
}

// timeUntilNextUTCMidnight returns the duration from now to 00:00 UTC of
// the following day, clamped to >= DefaultKataMinTTL.
func timeUntilNextUTCMidnight(now time.Time, minTTL time.Duration) time.Duration {
	n := now.UTC()
	next := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC).Add(24 * time.Hour)
	d := next.Sub(n)
	if d < minTTL {
		return minTTL
	}
	return d
}

// CachedKataRepo wraps domain.KataRepo. Only HistoryLast30 is cached — it is
// the read hot-path (GetStreak hits it on every /daily/* page mount).
// GetOrAssign is a read-modify-write so we delegate without caching, and
// MarkSubmitted invalidates the cached history.
type CachedKataRepo struct {
	delegate domain.KataRepo
	kv       KV
	minTTL   time.Duration
	log      *slog.Logger
	sf       singleflight.Group
	now      func() time.Time
}

// Compile-time: satisfies domain.KataRepo.
var _ domain.KataRepo = (*CachedKataRepo)(nil)

// NewCachedKataRepo wraps delegate. now defaults to time.Now if nil. log
// is required (anti-fallback policy).
func NewCachedKataRepo(delegate domain.KataRepo, kv KV, minTTL time.Duration, log *slog.Logger, now func() time.Time) *CachedKataRepo {
	if minTTL <= 0 {
		minTTL = DefaultKataMinTTL
	}
	if log == nil {
		panic("daily.infra.NewCachedKataRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if now == nil {
		now = time.Now
	}
	return &CachedKataRepo{delegate: delegate, kv: kv, minTTL: minTTL, log: log, now: now}
}

// GetOrAssign forwards untouched and invalidates the user's history bucket
// for today (the new assignment row needs to surface on the next read).
func (c *CachedKataRepo) GetOrAssign(ctx context.Context, userID uuid.UUID, date time.Time, taskID uuid.UUID, isCursed, isWeeklyBoss bool) (domain.Assignment, bool, error) {
	a, created, err := c.delegate.GetOrAssign(ctx, userID, date, taskID, isCursed, isWeeklyBoss)
	if err != nil {
		return a, created, fmt.Errorf("daily.cache.GetOrAssign: %w", err)
	}
	if created {
		c.InvalidateHistory(ctx, userID, date)
	}
	return a, created, nil
}

// MarkSubmitted forwards then invalidates today's history for the user.
func (c *CachedKataRepo) MarkSubmitted(ctx context.Context, userID uuid.UUID, date time.Time, passed bool) error {
	if err := c.delegate.MarkSubmitted(ctx, userID, date, passed); err != nil {
		return fmt.Errorf("daily.cache.MarkSubmitted: %w", err)
	}
	c.InvalidateHistory(ctx, userID, date)
	return nil
}

// HistoryLast30 is the cached path. Read-through with singleflight collapsing.
func (c *CachedKataRepo) HistoryLast30(ctx context.Context, userID uuid.UUID, today time.Time) ([]domain.HistoryEntry, error) {
	key := keyKataHistory(userID, today)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.HistoryEntry
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("daily.cache: corrupt kata history entry, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return nil, fmt.Errorf("daily.cache.HistoryLast30: redis: %w", err)
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.HistoryLast30(ctx, userID, today)
	})
	if err != nil {
		return nil, fmt.Errorf("daily.cache.HistoryLast30: %w", err)
	}
	out, ok := v.([]domain.HistoryEntry)
	if !ok {
		return nil, fmt.Errorf("daily.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		ttl := timeUntilNextUTCMidnight(c.now(), c.minTTL)
		if serr := c.kv.Set(ctx, key, data, ttl); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("daily_kata").Inc()
			c.log.Warn("daily.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// InvalidateHistory busts the per-user kata history keys for the given day —
// both the rolling 30-day window and the year bucket containing it.
func (c *CachedKataRepo) InvalidateHistory(ctx context.Context, userID uuid.UUID, today time.Time) {
	keys := []string{
		keyKataHistory(userID, today),
		keyKataHistoryYear(userID, today.UTC().Year()),
	}
	if err := c.kv.Del(ctx, keys...); err != nil {
		c.log.Warn("daily.cache: redis Del kata failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}

// DefaultKataYearTTL is the per-key TTL applied to year-grid history cache
// entries. The year-grid is only mounted on /daily/streak — burstier than
// HistoryLast30 but not nearly as hot as the streak number; 5min keeps
// the calendar page snappy on refresh while staying close-enough to
// SubmitKata writes (which invalidate the bucket explicitly).
const DefaultKataYearTTL = 5 * time.Minute

// keyKataHistoryYear is the per-user, per-year Redis key for HistoryByYear.
func keyKataHistoryYear(uid uuid.UUID, year int) string {
	return fmt.Sprintf("daily:%s:kata-year:%s:%d", CacheKeyVersion, uid.String(), year)
}

// HistoryByYear is the cached year-grid path. Same read-through +
// singleflight collapsing pattern as HistoryLast30; SubmitKata indirectly
// invalidates via MarkSubmitted → InvalidateHistory (today's row mutates
// → the year bucket containing today is also stale).
func (c *CachedKataRepo) HistoryByYear(ctx context.Context, userID uuid.UUID, year int) ([]domain.HistoryEntry, error) {
	key := keyKataHistoryYear(userID, year)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.HistoryEntry
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("daily.cache: corrupt kata-year entry, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return nil, fmt.Errorf("daily.cache.HistoryByYear: redis: %w", err)
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.HistoryByYear(ctx, userID, year)
	})
	if err != nil {
		return nil, fmt.Errorf("daily.cache.HistoryByYear: %w", err)
	}
	out, ok := v.([]domain.HistoryEntry)
	if !ok {
		return nil, fmt.Errorf("daily.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, DefaultKataYearTTL); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("daily_kata_year").Inc()
			c.log.Warn("daily.cache: redis Set kata-year failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// ── CalendarRepo cache ────────────────────────────────────────────────────

// DefaultCalendarTTL is the per-key TTL for calendar cache entries.
const DefaultCalendarTTL = 60 * time.Second

// CachedCalendarRepo wraps domain.CalendarRepo. GetActive is read-through;
// Upsert invalidates the bucket containing today (best-effort: the row's
// interview_date may be in a different month, but the user is reading
// today's bucket from the UI, so that's the bucket we bust).
type CachedCalendarRepo struct {
	delegate domain.CalendarRepo
	kv       KV
	ttl      time.Duration
	log      *slog.Logger
	sf       singleflight.Group
	now      func() time.Time
}

// Compile-time: satisfies domain.CalendarRepo.
var _ domain.CalendarRepo = (*CachedCalendarRepo)(nil)

// NewCachedCalendarRepo wraps delegate. now defaults to time.Now if nil.
// log is required (anti-fallback policy).
func NewCachedCalendarRepo(delegate domain.CalendarRepo, kv KV, ttl time.Duration, log *slog.Logger, now func() time.Time) *CachedCalendarRepo {
	if ttl <= 0 {
		ttl = DefaultCalendarTTL
	}
	if log == nil {
		panic("daily.infra.NewCachedCalendarRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if now == nil {
		now = time.Now
	}
	return &CachedCalendarRepo{delegate: delegate, kv: kv, ttl: ttl, log: log, now: now}
}

// calendarEnvelope is the wire-shape stored in Redis. We carry an explicit
// "found" flag so that ErrNotFound can be cached as a negative result without
// confusing it with a JSON unmarshalling failure.
type calendarEnvelope struct {
	Found    bool                     `json:"found"`
	Calendar domain.InterviewCalendar `json:"calendar,omitempty"`
}

// GetActive is the cached path.
func (c *CachedCalendarRepo) GetActive(ctx context.Context, userID uuid.UUID, today time.Time) (domain.InterviewCalendar, error) {
	key := keyCalendar(userID, today)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var env calendarEnvelope
		if jerr := json.Unmarshal([]byte(raw), &env); jerr == nil {
			if !env.Found {
				return domain.InterviewCalendar{}, domain.ErrNotFound
			}
			return env.Calendar, nil
		}
		c.log.Warn("daily.cache: corrupt calendar entry, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		// Anti-fallback: real Redis failure propagates.
		return domain.InterviewCalendar{}, fmt.Errorf("daily.cache.GetActive: redis: %w", err)
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		got, gerr := c.delegate.GetActive(ctx, userID, today)
		if gerr != nil && !errors.Is(gerr, domain.ErrNotFound) {
			return nil, fmt.Errorf("daily.cache.delegate.GetActive: %w", gerr)
		}
		// Возвращаем envelope; gerr (если ErrNotFound) пробрасываем через
		// второй return-value sf-callback'а, чтобы внешний код мог отличить
		// "нет календаря" от настоящих сбоев.
		if gerr != nil {
			return calendarEnvelope{Found: false, Calendar: got}, fmt.Errorf("daily.cache.delegate.GetActive: %w", gerr)
		}
		return calendarEnvelope{Found: true, Calendar: got}, nil
	})
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.cache.GetActive: %w", err)
	}
	env, ok := v.(calendarEnvelope)
	if !ok {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.cache: singleflight returned %T", v)
	}
	if data, jerr := json.Marshal(env); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.ttl); serr != nil {
			metrics.CacheSetErrorsTotal.WithLabelValues("daily_calendar").Inc()
			c.log.Warn("daily.cache: redis Set failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	if !env.Found {
		return domain.InterviewCalendar{}, domain.ErrNotFound
	}
	return env.Calendar, nil
}

// Upsert forwards then invalidates the user's calendar bucket for today.
func (c *CachedCalendarRepo) Upsert(ctx context.Context, cal domain.InterviewCalendar) (domain.InterviewCalendar, error) {
	out, err := c.delegate.Upsert(ctx, cal)
	if err != nil {
		return out, fmt.Errorf("daily.cache.Upsert: %w", err)
	}
	c.Invalidate(ctx, cal.UserID, c.now())
	return out, nil
}

// Invalidate busts the calendar bucket containing the supplied "today".
func (c *CachedCalendarRepo) Invalidate(ctx context.Context, userID uuid.UUID, today time.Time) {
	if err := c.kv.Del(ctx, keyCalendar(userID, today)); err != nil {
		c.log.Warn("daily.cache: redis Del calendar failed",
			slog.Any("user_id", userID), slog.Any("err", err))
	}
}
