// extract_cache.go — Phase R6 dedup-cache for ExtractResourceContent.
//
// Problem: ExtractResourceContent UC re-runs the full fetch+LLM pipeline
// every time the same URL is requested (across users, across sessions).
// In particular `seed_resources` cmd and admin retries hit the same URLs
// in tight loops, paying the LLM cost ~12× each.
//
// Solution: deterministic in-memory cache keyed on sha256(URL). TTL 7d.
// Cache hit returns the previously parsed Resource with Manual=false.
// Cache populated only on success (LLM-parsed path); fetcher-fail and
// LLM-fail paths skip cache so retries can recover.
//
// The cache is process-local (no Redis) by intention — Redis wiring is
// downstream of curation/app and would tangle the package boundary.
// TODO(perf): wire shared Redis when curation/app gains a *redis.Client
// dependency at construction time.
package app

import (
	"sync"
	"time"

	"druz9/curation/domain"
)

// extractCacheTTL — cache entries served fresh for this duration after
// last successful Extract. 7 days is comfortably below the lifecycle of
// most learning resources (course updates / blog post edits) while
// erasing the cost of repeated extraction in batch flows.
const extractCacheTTL = 7 * 24 * time.Hour

// extractCacheCapacity — soft cap to keep memory bounded. 8192 entries
// at ~4KB each = ~32MB in the worst case; we sweep oldest entries when
// crossing this watermark to amortise the cost.
const extractCacheCapacity = 8192

type extractCacheEntry struct {
	preview   domain.Resource
	expiresAt time.Time
}

// extractCacheStore — process-local map with TTL eviction. Safe for
// concurrent use. We don't expose getter/setter as methods on the UC
// to keep the UC type minimal; the cache lives as a package-level var.
type extractCacheStore struct {
	mu    sync.RWMutex
	items map[string]extractCacheEntry
}

var globalExtractCache = &extractCacheStore{
	items: make(map[string]extractCacheEntry, 64),
}

// get returns the cached Resource for this key, plus a hit flag. Stale
// entries are pruned on access — no separate sweeper required for the
// common path.
func (s *extractCacheStore) get(key string) (domain.Resource, bool) {
	s.mu.RLock()
	entry, ok := s.items[key]
	s.mu.RUnlock()
	if !ok {
		return domain.Resource{}, false
	}
	if time.Now().After(entry.expiresAt) {
		// Lazy delete; we hold a read lock so upgrade to write only when
		// we actually need to drop the entry.
		s.mu.Lock()
		if cur, still := s.items[key]; still && !time.Now().Before(cur.expiresAt) {
			delete(s.items, key)
		}
		s.mu.Unlock()
		return domain.Resource{}, false
	}
	return entry.preview, true
}

// set stores a Resource under this key with the standard TTL. When the
// store crosses the soft capacity it sweeps a small fraction of entries
// (oldest first by expiresAt) to keep the working set bounded.
func (s *extractCacheStore) set(key string, preview domain.Resource) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= extractCacheCapacity {
		s.sweepLocked(extractCacheCapacity / 8)
	}
	s.items[key] = extractCacheEntry{
		preview:   preview,
		expiresAt: time.Now().Add(extractCacheTTL),
	}
}

// sweepLocked evicts up to n oldest entries. Caller holds the write lock.
// We don't bother with a heap: the rare crossing of capacity tolerates
// an O(n) scan. Sweeping more than required would erase recent hits.
func (s *extractCacheStore) sweepLocked(n int) {
	if n <= 0 {
		return
	}
	type aged struct {
		key string
		at  time.Time
	}
	all := make([]aged, 0, len(s.items))
	for k, v := range s.items {
		all = append(all, aged{key: k, at: v.expiresAt})
	}
	// partial selection: small n vs len(all) — selection sort is fine.
	for i := 0; i < n && i < len(all); i++ {
		minIdx := i
		for j := i + 1; j < len(all); j++ {
			if all[j].at.Before(all[minIdx].at) {
				minIdx = j
			}
		}
		all[i], all[minIdx] = all[minIdx], all[i]
		delete(s.items, all[i].key)
	}
}

// ExtractCacheReset — exported test helper to clear the dedup cache
// between test cases. No production caller should invoke this directly.
func ExtractCacheReset() {
	globalExtractCache.mu.Lock()
	globalExtractCache.items = make(map[string]extractCacheEntry, 64)
	globalExtractCache.mu.Unlock()
}
