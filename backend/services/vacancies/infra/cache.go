// cache.go — Redis read-through cache for VacancyRepo. Mirrors the profile
// cache pattern (KV interface, singleflight, fail-safe Redis).
//
//   - GetByID: 1h TTL, key vacancies:v1:by_id:<id>
//   - ListByFilter: 10min TTL, key vacancies:v1:list:<sha256(filter)>
//
// Writes (UpsertByExternal, UpdateNormalizedSkills) invalidate the per-id key
// and bust ALL list keys via a single tag — implemented as a versioned
// namespace counter (a much cheaper trick than SCAN-and-DELETE).
package infra

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"druz9/vacancies/domain"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// DefaultListTTL — 10 minutes per spec; balances freshness with cost.
const DefaultListTTL = 10 * time.Minute

// DefaultByIDTTL — 1 hour per spec; vacancy bodies barely change inside one
// fetch cycle.
const DefaultByIDTTL = time.Hour

// CacheKeyVersion is bumped when the JSON shape of cached values changes.
const CacheKeyVersion = "v1"

// KV is the tiny subset of Redis used by the cache. Production wires
// redisKV{*redis.Client}; tests inject an in-memory map.
type KV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
	// Incr is used by the namespace-version trick (see invalidateLists).
	Incr(ctx context.Context, key string) (int64, error)
}

// ErrCacheMiss is the sentinel returned by KV.Get on absent key.
var ErrCacheMiss = errors.New("vacancies.cache: miss")

// redisKV adapts *redis.Client.
type redisKV struct{ rdb *redis.Client }

// NewRedisKV exposes the adapter.
func NewRedisKV(rdb *redis.Client) KV { return redisKV{rdb: rdb} }

func (r redisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("vacancies.cache.Get: %w", err)
	}
	return v, nil
}

func (r redisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("vacancies.cache.Set: %w", err)
	}
	return nil
}

func (r redisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("vacancies.cache.Del: %w", err)
	}
	return nil
}

func (r redisKV) Incr(ctx context.Context, key string) (int64, error) {
	v, err := r.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("vacancies.cache.Incr: %w", err)
	}
	return v, nil
}

// CachedVacancyRepo wraps a delegate VacancyRepo with read-through caching.
type CachedVacancyRepo struct {
	delegate domain.VacancyRepo
	kv       KV
	listTTL  time.Duration
	byIDTTL  time.Duration
	log      *slog.Logger
	sf       singleflight.Group
}

var _ domain.VacancyRepo = (*CachedVacancyRepo)(nil)

// NewCachedVacancyRepo wraps delegate in caching with the supplied TTLs.
// Pass 0 for either TTL to use the package defaults.
func NewCachedVacancyRepo(delegate domain.VacancyRepo, kv KV, listTTL, byIDTTL time.Duration, log *slog.Logger) *CachedVacancyRepo {
	if listTTL <= 0 {
		listTTL = DefaultListTTL
	}
	if byIDTTL <= 0 {
		byIDTTL = DefaultByIDTTL
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(discardWriter{}, nil))
	}
	return &CachedVacancyRepo{
		delegate: delegate, kv: kv,
		listTTL: listTTL, byIDTTL: byIDTTL, log: log,
	}
}

func keyByID(id int64) string {
	return fmt.Sprintf("vacancies:%s:by_id:%d", CacheKeyVersion, id)
}

func keyListNamespace() string {
	return fmt.Sprintf("vacancies:%s:list_ns", CacheKeyVersion)
}

func (c *CachedVacancyRepo) keyList(ctx context.Context, f domain.ListFilter) string {
	// Snapshot the namespace counter; the resulting key is invalidated
	// implicitly by Incr-ing the counter.
	ns, err := c.kv.Get(ctx, keyListNamespace())
	if err != nil {
		// On miss / error: use "0" — first INCR after invalidate jumps to 1.
		ns = "0"
	}
	hashIn := struct {
		NS        string
		Sources   []string
		Skills    []string
		SalaryMin int
		Location  string
		Limit     int
		Offset    int
	}{NS: ns, SalaryMin: f.SalaryMin, Location: strings.ToLower(strings.TrimSpace(f.Location)),
		Limit: f.Limit, Offset: f.Offset}
	for _, s := range f.Sources {
		hashIn.Sources = append(hashIn.Sources, string(s))
	}
	sort.Strings(hashIn.Sources)
	hashIn.Skills = append(hashIn.Skills, f.Skills...)
	for i, s := range hashIn.Skills {
		hashIn.Skills[i] = strings.ToLower(strings.TrimSpace(s))
	}
	sort.Strings(hashIn.Skills)
	b, _ := json.Marshal(hashIn)
	sum := sha256.Sum256(b)
	return fmt.Sprintf("vacancies:%s:list:%s", CacheKeyVersion, hex.EncodeToString(sum[:16]))
}

// GetByID is the cached read.
func (c *CachedVacancyRepo) GetByID(ctx context.Context, id int64) (domain.Vacancy, error) {
	key := keyByID(id)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var v domain.Vacancy
		if jerr := json.Unmarshal([]byte(raw), &v); jerr == nil {
			return v, nil
		}
		c.log.Warn("vacancies.cache: corrupt by_id, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("vacancies.cache: redis Get failed (by_id), falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.GetByID(ctx, id)
	})
	if err != nil {
		return domain.Vacancy{}, fmt.Errorf("vacancies.cache.GetByID: %w", err)
	}
	out := v.(domain.Vacancy)
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.byIDTTL); serr != nil {
			c.log.Warn("vacancies.cache: redis Set failed (by_id)",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// ListByFilter caches the entire Page envelope. The cache key embeds the
// list-namespace counter so a single Incr atomically invalidates ALL list
// permutations.
func (c *CachedVacancyRepo) ListByFilter(ctx context.Context, f domain.ListFilter) (domain.Page, error) {
	key := c.keyList(ctx, f)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var p domain.Page
		if jerr := json.Unmarshal([]byte(raw), &p); jerr == nil {
			return p, nil
		}
		c.log.Warn("vacancies.cache: corrupt list, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCacheMiss) {
		c.log.Warn("vacancies.cache: redis Get failed (list), falling back",
			slog.String("key", key), slog.Any("err", err))
	}
	v, err, _ := c.sf.Do(key, func() (any, error) {
		return c.delegate.ListByFilter(ctx, f)
	})
	if err != nil {
		return domain.Page{}, fmt.Errorf("vacancies.cache.ListByFilter: %w", err)
	}
	out := v.(domain.Page)
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.listTTL); serr != nil {
			c.log.Warn("vacancies.cache: redis Set failed (list)",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// Insert + UpsertByExternal forward to the delegate then bust the per-id key
// and bump the list namespace.
func (c *CachedVacancyRepo) Insert(ctx context.Context, v *domain.Vacancy) error {
	if err := c.delegate.Insert(ctx, v); err != nil {
		return fmt.Errorf("vacancies.cache.Insert: %w", err)
	}
	c.invalidateOne(ctx, v.ID)
	c.invalidateLists(ctx)
	return nil
}

func (c *CachedVacancyRepo) UpsertByExternal(ctx context.Context, v *domain.Vacancy) (int64, error) {
	id, err := c.delegate.UpsertByExternal(ctx, v)
	if err != nil {
		return 0, fmt.Errorf("vacancies.cache.UpsertByExternal: %w", err)
	}
	c.invalidateOne(ctx, id)
	c.invalidateLists(ctx)
	return id, nil
}

func (c *CachedVacancyRepo) UpdateNormalizedSkills(ctx context.Context, id int64, skills []string) error {
	if err := c.delegate.UpdateNormalizedSkills(ctx, id, skills); err != nil {
		return fmt.Errorf("vacancies.cache.UpdateNormalizedSkills: %w", err)
	}
	c.invalidateOne(ctx, id)
	c.invalidateLists(ctx)
	return nil
}

func (c *CachedVacancyRepo) invalidateOne(ctx context.Context, id int64) {
	if err := c.kv.Del(ctx, keyByID(id)); err != nil {
		c.log.Warn("vacancies.cache: redis Del failed (by_id)",
			slog.Int64("id", id), slog.Any("err", err))
	}
}

func (c *CachedVacancyRepo) invalidateLists(ctx context.Context) {
	if _, err := c.kv.Incr(ctx, keyListNamespace()); err != nil {
		c.log.Warn("vacancies.cache: redis Incr failed (list_ns)",
			slog.Any("err", err))
	}
}

// discardWriter swallows bytes — default sink for nil log.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
