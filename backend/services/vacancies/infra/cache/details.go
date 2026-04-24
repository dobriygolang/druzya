// details.go — second cache layer for the rich VacancyDetails view.
//
// Phase 4 model:
//
//   - Listing-cache (cache.go) holds the shallow Vacancy snapshot and is
//     refreshed on a 15-minute tick by the existing Run loop.
//   - DetailsCache (this file) holds VacancyDetails per (Source, ExternalID).
//     Populated lazily on the first GetDetails call; subsequent reads
//     served from cache. TTL: 1 hour. After TTL, the entry is "stale" — we
//     serve the stale value immediately and kick off a background refresh
//     (stale-while-revalidate). Concurrent calls for the same key are
//     coalesced via singleflight so 100 simultaneous opens of the same
//     vacancy issue exactly one upstream fetch.
//
// Anti-fallback policy:
//
//   - On fetcher failure the cache stores VacancyDetails{Vacancy: listing}
//     (no rich fields, no fake content) so the UI degrades to the listing
//     snippet, never to fabricated text. The failure is logged + ticks
//     vacancies_details_fetch_errors_total{source}.
//   - A nil listing → ErrNotFound (handler maps to 404). The detail cache
//     is purely additive on top of the listing cache; there is no path
//     that synthesises a Vacancy out of thin air.
package cache

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/shared/pkg/metrics"
	"druz9/vacancies/domain"

	"golang.org/x/sync/singleflight"
)

// DefaultDetailsTTL is how long a populated DetailsCache entry is "fresh".
// After TTL it is "stale" — served immediately while a background refresh
// runs. Picked to be short enough that updated descriptions land within an
// hour, long enough that the detail-page open is essentially always cache-
// hit.
const DefaultDetailsTTL = time.Hour

// DetailFetcher is the per-source contract for the rich detail endpoint.
// listing is the shallow Vacancy from the listing cache — fetchers can
// pass-through fields (location, company, etc.) so output is always
// complete even when the upstream detail body strips redundant data.
type DetailFetcher interface {
	Source() domain.Source
	FetchDetails(ctx context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error)
}

// listingReader is the slice of *Cache that DetailsCache needs. Declared
// as an interface so tests can stub it.
type listingReader interface {
	Get(source domain.Source, externalID string) (domain.Vacancy, error)
}

// Clock is a tiny seam so tests can fast-forward.
type Clock interface {
	Now() time.Time
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now().UTC() }

// detailEntry is one cached row.
type detailEntry struct {
	v         domain.VacancyDetails
	fetchedAt time.Time
}

// DetailsCache is the lazy second-tier cache.
type DetailsCache struct {
	listing  listingReader
	fetchers map[domain.Source]DetailFetcher
	log      *slog.Logger
	ttl      time.Duration
	clock    Clock

	mu     sync.RWMutex
	bucket map[domain.Source]map[string]detailEntry

	sf singleflight.Group
}

// DetailsOptions configure the constructor.
type DetailsOptions struct {
	TTL   time.Duration
	Clock Clock
}

// NewDetails builds an empty details cache. log is required (anti-fallback
// policy: no silent noop loggers).
func NewDetails(listing listingReader, fetchers []DetailFetcher, log *slog.Logger, opts DetailsOptions) *DetailsCache {
	if log == nil {
		panic("vacancies.cache.NewDetails: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if opts.TTL <= 0 {
		opts.TTL = DefaultDetailsTTL
	}
	if opts.Clock == nil {
		opts.Clock = realClock{}
	}
	m := make(map[domain.Source]DetailFetcher, len(fetchers))
	for _, f := range fetchers {
		m[f.Source()] = f
	}
	return &DetailsCache{
		listing:  listing,
		fetchers: m,
		log:      log,
		ttl:      opts.TTL,
		clock:    opts.Clock,
		bucket:   make(map[domain.Source]map[string]detailEntry),
	}
}

// Get is the public read. It always returns instantly from the cache when
// an entry exists; if the entry is stale it kicks off a background refresh
// and serves the stale value (stale-while-revalidate). Cold misses block
// on the upstream fetch (single-flighted by key).
//
// Errors:
//   - domain.ErrNotFound when the listing cache has nothing for the key.
//   - never returns a partial/error sentinel for fetcher failures — those
//     are downgraded to "listing-only" entries and metric-ticked.
func (c *DetailsCache) Get(ctx context.Context, source domain.Source, externalID string) (domain.VacancyDetails, error) {
	listing, err := c.listing.Get(source, externalID)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.details.Get: %w", err)
	}

	// Cache hit?
	c.mu.RLock()
	entry, hit := c.lookup(source, externalID)
	c.mu.RUnlock()

	now := c.clock.Now()
	if hit {
		if now.Sub(entry.fetchedAt) < c.ttl {
			// fresh
			return entry.v, nil
		}
		// stale — serve stale, kick background refresh (single-flighted)
		go c.refreshBackground(source, externalID, listing)
		return entry.v, nil
	}

	// Cold miss — block on a single-flighted fetch.
	v, err := c.fetchAndStore(ctx, source, externalID, listing)
	if err != nil {
		return domain.VacancyDetails{}, err
	}
	return v, nil
}

func (c *DetailsCache) lookup(source domain.Source, externalID string) (detailEntry, bool) {
	b, ok := c.bucket[source]
	if !ok {
		return detailEntry{}, false
	}
	e, ok := b[externalID]
	return e, ok
}

// fetchAndStore is the cold-miss path. Wraps the upstream fetcher in a
// singleflight per (source/externalID) so the thundering-herd case (50
// users open the same vacancy at once) collapses to one fetch.
func (c *DetailsCache) fetchAndStore(ctx context.Context, source domain.Source, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	key := string(source) + "/" + externalID
	out, err, _ := c.sf.Do(key, func() (any, error) {
		// Re-check in case another caller filled the cache while we
		// were waiting on the singleflight.
		c.mu.RLock()
		if e, ok := c.lookup(source, externalID); ok && c.clock.Now().Sub(e.fetchedAt) < c.ttl {
			c.mu.RUnlock()
			return e.v, nil
		}
		c.mu.RUnlock()

		v := c.runFetcher(ctx, source, externalID, listing)
		c.store(source, externalID, v)
		return v, nil
	})
	if err != nil {
		return domain.VacancyDetails{}, err
	}
	return out.(domain.VacancyDetails), nil
}

// refreshBackground is the stale-revalidate path. Uses a fresh context with
// a sane budget (the caller's request context will already have returned).
func (c *DetailsCache) refreshBackground(source domain.Source, externalID string, listing domain.Vacancy) {
	key := string(source) + "/" + externalID
	_, _, _ = c.sf.Do(key, func() (any, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		v := c.runFetcher(ctx, source, externalID, listing)
		c.store(source, externalID, v)
		return v, nil
	})
}

// runFetcher invokes the per-source DetailFetcher. On failure: log + metric
// + degrade to the listing-only snapshot (anti-fallback: never invent
// content, but never blank the screen either).
func (c *DetailsCache) runFetcher(ctx context.Context, source domain.Source, externalID string, listing domain.Vacancy) domain.VacancyDetails {
	f, ok := c.fetchers[source]
	if !ok {
		// No fetcher registered → listing-only with a noisy WARN. This
		// is a wiring bug (parser registered, detail fetcher missing),
		// not an upstream failure.
		c.log.Warn("vacancies.details: no fetcher registered for source",
			slog.String("source", string(source)))
		return domain.VacancyDetails{Vacancy: listing, DetailsFetchedAt: c.clock.Now()}
	}
	v, err := f.FetchDetails(ctx, externalID, listing)
	if err != nil {
		metrics.VacanciesDetailsFetchErrorsTotal.WithLabelValues(string(source)).Inc()
		c.log.Warn("vacancies.details: fetch failed; serving listing-only",
			slog.String("source", string(source)),
			slog.String("external_id", externalID),
			slog.Any("err", err))
		return domain.VacancyDetails{Vacancy: listing, DetailsFetchedAt: c.clock.Now()}
	}
	v.DetailsFetchedAt = c.clock.Now()
	// Always force the embedded Vacancy back to the listing snapshot —
	// the listing cache is the source of truth for every shared field;
	// the detail body might have stripped or transformed them.
	keepRich := v
	keepRich.Vacancy = listing
	return keepRich
}

func (c *DetailsCache) store(source domain.Source, externalID string, v domain.VacancyDetails) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.bucket[source]
	if !ok {
		b = make(map[string]detailEntry, 1)
		c.bucket[source] = b
	}
	b[externalID] = detailEntry{v: v, fetchedAt: c.clock.Now()}
}
