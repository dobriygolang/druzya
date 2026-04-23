// cms_cache.go — Redis read-through cache for the podcast CMS surface.
//
// Mirrors the pattern in vacancies/infra/cache.go but trimmed to the four
// reads the CMS surface actually exercises. TTLs (per spec):
//
//   - List           → 5 min
//   - Categories     → 5 min
//   - Single (by id) → 5 min for the metadata, 45 min for the presigned URL
//
// The presigned URL cache lives in a separate key so refreshing the
// metadata (e.g. after admin edits the title) does NOT force every
// listener to re-download a fresh signature. The URL key carries the
// audio_key + ttl in its name, so a freshly uploaded audio key (== new
// object) trivially misses the old URL cache.
package infra

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"druz9/podcast/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Default TTLs per spec.
const (
	DefaultCMSListTTL    = 5 * time.Minute
	DefaultCMSPresignTTL = 45 * time.Minute
	cmsCacheKeyVersion   = "v1"
)

// CMSKV is the slice of Redis the CMS cache uses. Mirrors
// vacancies.infra.KV but kept private to this domain to avoid coupling.
type CMSKV interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, keys ...string) error
	Incr(ctx context.Context, key string) (int64, error)
}

// ErrCMSCacheMiss is the sentinel for an absent key.
var ErrCMSCacheMiss = errors.New("podcast.cms.cache: miss")

// cmsRedisKV adapts *redis.Client.
type cmsRedisKV struct{ rdb *redis.Client }

// NewCMSRedisKV exposes the adapter.
func NewCMSRedisKV(rdb *redis.Client) CMSKV { return cmsRedisKV{rdb: rdb} }

func (r cmsRedisKV) Get(ctx context.Context, key string) (string, error) {
	v, err := r.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrCMSCacheMiss
	}
	if err != nil {
		return "", fmt.Errorf("podcast.cms.cache.Get: %w", err)
	}
	return v, nil
}

func (r cmsRedisKV) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := r.rdb.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("podcast.cms.cache.Set: %w", err)
	}
	return nil
}

func (r cmsRedisKV) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := r.rdb.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("podcast.cms.cache.Del: %w", err)
	}
	return nil
}

func (r cmsRedisKV) Incr(ctx context.Context, key string) (int64, error) {
	v, err := r.rdb.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("podcast.cms.cache.Incr: %w", err)
	}
	return v, nil
}

// CachedCMSRepo wraps PodcastCMSRepo with read-through caching. Writes
// invalidate the affected keys + bump the list namespace counter so all
// list permutations drop atomically.
type CachedCMSRepo struct {
	delegate domain.PodcastCMSRepo
	kv       CMSKV
	listTTL  time.Duration
	log      *slog.Logger
}

var _ domain.PodcastCMSRepo = (*CachedCMSRepo)(nil)

// NewCachedCMSRepo wraps delegate. log is required (anti-fallback).
func NewCachedCMSRepo(delegate domain.PodcastCMSRepo, kv CMSKV, listTTL time.Duration, log *slog.Logger) *CachedCMSRepo {
	if listTTL <= 0 {
		listTTL = DefaultCMSListTTL
	}
	if log == nil {
		panic("podcast.infra.NewCachedCMSRepo: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &CachedCMSRepo{delegate: delegate, kv: kv, listTTL: listTTL, log: log}
}

func cmsKeyByID(id uuid.UUID) string {
	return fmt.Sprintf("podcast:cms:%s:by_id:%s", cmsCacheKeyVersion, id.String())
}

func cmsKeyCategories() string {
	return fmt.Sprintf("podcast:cms:%s:categories", cmsCacheKeyVersion)
}

func cmsKeyListNS() string {
	return fmt.Sprintf("podcast:cms:%s:list_ns", cmsCacheKeyVersion)
}

func (c *CachedCMSRepo) keyList(ctx context.Context, f domain.CMSListFilter) (string, error) {
	ns, err := c.kv.Get(ctx, cmsKeyListNS())
	if err != nil {
		if !errors.Is(err, ErrCMSCacheMiss) {
			return "", fmt.Errorf("podcast.cms.cache.keyList.ns: %w", err)
		}
		ns = "0"
	}
	hashIn := struct {
		NS         string
		CategoryID string
		OnlyPub    bool
		Limit      int
		Offset     int
	}{NS: ns, OnlyPub: f.OnlyPublished, Limit: f.Limit, Offset: f.Offset}
	if f.CategoryID != nil {
		hashIn.CategoryID = f.CategoryID.String()
	}
	b, _ := json.Marshal(hashIn)
	sum := sha256.Sum256(b)
	return fmt.Sprintf("podcast:cms:%s:list:%s", cmsCacheKeyVersion, hex.EncodeToString(sum[:16])), nil
}

// ListCMS — cached.
func (c *CachedCMSRepo) ListCMS(ctx context.Context, f domain.CMSListFilter) ([]domain.CMSPodcast, error) {
	if c.kv == nil {
		out, err := c.delegate.ListCMS(ctx, f)
		if err != nil {
			return out, fmt.Errorf("podcast.cms.cache.ListCMS: %w", err)
		}
		return out, nil
	}
	key, kerr := c.keyList(ctx, f)
	if kerr != nil {
		return nil, fmt.Errorf("podcast.cms.cache.ListCMS: %w", kerr)
	}
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.CMSPodcast
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("podcast.cms.cache: corrupt list, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCMSCacheMiss) {
		return nil, fmt.Errorf("podcast.cms.cache.ListCMS: %w", err)
	}
	out, err := c.delegate.ListCMS(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("podcast.cms.cache.ListCMS: %w", err)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.listTTL); serr != nil {
			c.log.Warn("podcast.cms.cache: Set list failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// GetCMSByID — cached.
func (c *CachedCMSRepo) GetCMSByID(ctx context.Context, id uuid.UUID) (domain.CMSPodcast, error) {
	if c.kv == nil {
		out, err := c.delegate.GetCMSByID(ctx, id)
		if err != nil {
			return out, fmt.Errorf("podcast.cms.cache.GetCMSByID: %w", err)
		}
		return out, nil
	}
	key := cmsKeyByID(id)
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out domain.CMSPodcast
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("podcast.cms.cache: corrupt by_id, refreshing", slog.String("key", key))
	} else if !errors.Is(err, ErrCMSCacheMiss) {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.cache.GetCMSByID: %w", err)
	}
	out, err := c.delegate.GetCMSByID(ctx, id)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.cache.GetCMSByID: %w", err)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.listTTL); serr != nil {
			c.log.Warn("podcast.cms.cache: Set by_id failed",
				slog.String("key", key), slog.Any("err", serr))
		}
	}
	return out, nil
}

// CreateCMS — bust caches.
func (c *CachedCMSRepo) CreateCMS(ctx context.Context, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	out, err := c.delegate.CreateCMS(ctx, in)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.cache.CreateCMS: %w", err)
	}
	c.invalidateLists(ctx)
	return out, nil
}

// UpdateCMS — bust caches.
func (c *CachedCMSRepo) UpdateCMS(ctx context.Context, id uuid.UUID, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	out, err := c.delegate.UpdateCMS(ctx, id, in)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.cms.cache.UpdateCMS: %w", err)
	}
	c.invalidateOne(ctx, id)
	c.invalidateLists(ctx)
	return out, nil
}

// DeleteCMS — bust caches.
func (c *CachedCMSRepo) DeleteCMS(ctx context.Context, id uuid.UUID) (string, error) {
	key, err := c.delegate.DeleteCMS(ctx, id)
	if err != nil {
		return "", fmt.Errorf("podcast.cms.cache.DeleteCMS: %w", err)
	}
	c.invalidateOne(ctx, id)
	c.invalidateLists(ctx)
	return key, nil
}

// ListCategories — cached.
func (c *CachedCMSRepo) ListCategories(ctx context.Context) ([]domain.PodcastCategory, error) {
	if c.kv == nil {
		out, err := c.delegate.ListCategories(ctx)
		if err != nil {
			return out, fmt.Errorf("podcast.cms.cache.ListCategories: %w", err)
		}
		return out, nil
	}
	key := cmsKeyCategories()
	if raw, err := c.kv.Get(ctx, key); err == nil {
		var out []domain.PodcastCategory
		if jerr := json.Unmarshal([]byte(raw), &out); jerr == nil {
			return out, nil
		}
		c.log.Warn("podcast.cms.cache: corrupt categories, refreshing")
	} else if !errors.Is(err, ErrCMSCacheMiss) {
		return nil, fmt.Errorf("podcast.cms.cache.ListCategories: %w", err)
	}
	out, err := c.delegate.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("podcast.cms.cache.ListCategories: %w", err)
	}
	if data, jerr := json.Marshal(out); jerr == nil {
		if serr := c.kv.Set(ctx, key, data, c.listTTL); serr != nil {
			c.log.Warn("podcast.cms.cache: Set categories failed",
				slog.Any("err", serr))
		}
	}
	return out, nil
}

// GetCategoryByID — passthrough (single-row reads on a tiny table not
// worth the cache plumbing).
func (c *CachedCMSRepo) GetCategoryByID(ctx context.Context, id uuid.UUID) (domain.PodcastCategory, error) {
	cat, err := c.delegate.GetCategoryByID(ctx, id)
	if err != nil {
		return cat, fmt.Errorf("podcast.cms.cache.GetCategoryByID: %w", err)
	}
	return cat, nil
}

// CreateCategory — passthrough + bust the categories cache.
func (c *CachedCMSRepo) CreateCategory(ctx context.Context, in domain.PodcastCategory) (domain.PodcastCategory, error) {
	out, err := c.delegate.CreateCategory(ctx, in)
	if err != nil {
		return domain.PodcastCategory{}, fmt.Errorf("podcast.cms.cache.CreateCategory: %w", err)
	}
	if c.kv != nil {
		if derr := c.kv.Del(ctx, cmsKeyCategories()); derr != nil {
			c.log.Warn("podcast.cms.cache: Del categories failed", slog.Any("err", derr))
		}
	}
	return out, nil
}

func (c *CachedCMSRepo) invalidateOne(ctx context.Context, id uuid.UUID) {
	if c.kv == nil {
		return
	}
	if err := c.kv.Del(ctx, cmsKeyByID(id)); err != nil {
		c.log.Warn("podcast.cms.cache: Del by_id failed",
			slog.String("id", id.String()), slog.Any("err", err))
	}
}

func (c *CachedCMSRepo) invalidateLists(ctx context.Context) {
	if c.kv == nil {
		return
	}
	if _, err := c.kv.Incr(ctx, cmsKeyListNS()); err != nil {
		c.log.Warn("podcast.cms.cache: Incr list_ns failed", slog.Any("err", err))
	}
}

// ─── presigned URL cache ─────────────────────────────────────────────────

// PresignCache wraps a PodcastObjectStore so PresignGet results are
// memoised in Redis for the configured TTL. The cached value is only the
// URL string — refreshing it costs one HMAC, but for catalog-list
// responses with N podcasts, caching cuts (N × HMAC) → 1 lookup.
//
// Cache key embeds the audio key + ttl bucket so a freshly uploaded
// audio key (different object key) is a guaranteed miss.
type PresignCache struct {
	store domain.PodcastObjectStore
	kv    CMSKV
	ttl   time.Duration
	log   *slog.Logger
}

// NewPresignCache wraps store. ttl defaults to DefaultCMSPresignTTL.
// log is required (anti-fallback).
func NewPresignCache(store domain.PodcastObjectStore, kv CMSKV, ttl time.Duration, log *slog.Logger) *PresignCache {
	if ttl <= 0 {
		ttl = DefaultCMSPresignTTL
	}
	if log == nil {
		panic("podcast.infra.NewPresignCache: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &PresignCache{store: store, kv: kv, ttl: ttl, log: log}
}

// Available passes through.
func (p *PresignCache) Available() bool { return p.store != nil && p.store.Available() }

// PutAudio passes through (no caching for writes).
func (p *PresignCache) PutAudio(ctx context.Context, objectKey string, body io.Reader, length int64, contentType string) (string, error) {
	if p.store == nil {
		return "", fmt.Errorf("podcast.minio.cache.PutAudio: %w", domain.ErrObjectStoreUnavailable)
	}
	out, err := p.store.PutAudio(ctx, objectKey, body, length, contentType)
	if err != nil {
		return out, fmt.Errorf("podcast.minio.cache.PutAudio: %w", err)
	}
	return out, nil
}

// PresignGet reads from Redis when present.
func (p *PresignCache) PresignGet(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	if p.store == nil {
		return "", fmt.Errorf("podcast.minio.cache.PresignGet: %w", domain.ErrObjectStoreUnavailable)
	}
	if ttl <= 0 {
		ttl = p.ttl
	}
	if p.kv == nil {
		out, err := p.store.PresignGet(ctx, objectKey, ttl)
		if err != nil {
			return out, fmt.Errorf("podcast.minio.cache.PresignGet: %w", err)
		}
		return out, nil
	}
	key := fmt.Sprintf("podcast:cms:%s:presign:%d:%s",
		cmsCacheKeyVersion, int(ttl.Seconds()), objectKey)
	if v, err := p.kv.Get(ctx, key); err == nil {
		return v, nil
	} else if !errors.Is(err, ErrCMSCacheMiss) {
		// Real Redis failure — fall back to the store rather than
		// failing the whole list response. We log so ops sees it.
		p.log.Warn("podcast.minio.cache: presign Redis Get failed",
			slog.String("object_key", objectKey), slog.Any("err", err))
	}
	url, err := p.store.PresignGet(ctx, objectKey, ttl)
	if err != nil {
		return "", fmt.Errorf("podcast.minio.cache.PresignGet: %w", err)
	}
	// Cache for ttl/2 so the URL is always valid for at least ttl/2 after
	// the cache hit.
	if serr := p.kv.Set(ctx, key, []byte(url), ttl/2); serr != nil {
		p.log.Warn("podcast.minio.cache: presign Set failed",
			slog.String("object_key", objectKey), slog.Any("err", serr))
	}
	return url, nil
}

// Delete passes through and busts the cache key family for objectKey.
func (p *PresignCache) Delete(ctx context.Context, objectKey string) error {
	if p.store == nil {
		return fmt.Errorf("podcast.minio.cache.Delete: %w", domain.ErrObjectStoreUnavailable)
	}
	if err := p.store.Delete(ctx, objectKey); err != nil {
		return fmt.Errorf("podcast.minio.cache.Delete: %w", err)
	}
	// Best-effort: we don't know which TTL bucket the URL was cached
	// under, so we attempt the canonical default. A stale cached URL
	// will simply 404 when followed.
	if p.kv != nil && objectKey != "" {
		key := fmt.Sprintf("podcast:cms:%s:presign:%d:%s",
			cmsCacheKeyVersion, int(p.ttl.Seconds()), objectKey)
		if derr := p.kv.Del(ctx, key); derr != nil {
			p.log.Warn("podcast.minio.cache: presign Del failed",
				slog.String("object_key", objectKey), slog.Any("err", derr))
		}
	}
	return nil
}

// Compile-time guard.
var _ domain.PodcastObjectStore = (*PresignCache)(nil)
