// Package cache holds the single in-process vacancy cache that replaces the
// old Postgres-backed catalogue.
//
// Shape: map[Source]map[ExternalID]Vacancy behind a sync.RWMutex. Each
// per-source bucket is replaced atomically on a successful Refresh; if a
// parser errors the prior bucket survives so one portal outage doesn't
// blank the entire catalogue.
//
// Refresh model:
//
//   - Run() loops every Interval (default 15 min), calling each parser in
//     parallel.
//   - RefreshOnce(ctx) performs a single bounded pass — used for
//     refresh-on-boot in main and as a test seam.
//
// Anti-fallback policy:
//
//   - Constructors panic on nil log.
//   - Per-source failures emit
//     vacancies_cache_refresh_errors_total{source} and a Warn log; they do
//     NOT zero the bucket.
//   - Boot-time fail-open serves whatever returned within the budget — that
//     is preferable to blocking startup forever on a hung portal.
package cache

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"druz9/shared/pkg/metrics"
	"druz9/vacancies/domain"
)

// DefaultInterval is the inter-tick wait of the background refresher.
const DefaultInterval = 15 * time.Minute

// DefaultPerSourceTimeout caps a single parser.Fetch call per refresh.
const DefaultPerSourceTimeout = 30 * time.Second

// DefaultBootBudget caps the first synchronous refresh in main.
const DefaultBootBudget = 30 * time.Second

// Parser mirrors domain.Parser but is re-declared here to keep this package
// importable without pulling in the wider service interface set. domain.Parser
// satisfies it structurally.
type Parser interface {
	Source() domain.Source
	Fetch(ctx context.Context) ([]domain.Vacancy, error)
}

// Cache is the in-process snapshot of every parser's last successful fetch.
type Cache struct {
	parsers          []Parser
	log              *slog.Logger
	interval         time.Duration
	perSourceTimeout time.Duration

	mu      sync.RWMutex
	buckets map[domain.Source]map[string]domain.Vacancy
}

// Options configure the Cache constructor.
type Options struct {
	Interval         time.Duration
	PerSourceTimeout time.Duration
}

// New builds an empty cache. log is required (anti-fallback policy).
func New(parsers []Parser, log *slog.Logger, opts Options) *Cache {
	if log == nil {
		panic("vacancies.cache.New: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if opts.Interval <= 0 {
		opts.Interval = DefaultInterval
	}
	if opts.PerSourceTimeout <= 0 {
		opts.PerSourceTimeout = DefaultPerSourceTimeout
	}
	return &Cache{
		parsers:          parsers,
		log:              log,
		interval:         opts.Interval,
		perSourceTimeout: opts.PerSourceTimeout,
		buckets:          make(map[domain.Source]map[string]domain.Vacancy, len(parsers)),
	}
}

// Run loops on Interval until ctx is done. Designed to be called from a
// Background goroutine after the first synchronous RefreshOnce has warmed
// the cache.
func (c *Cache) Run(ctx context.Context) {
	t := time.NewTicker(c.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.RefreshOnce(ctx)
		}
	}
}

// RefreshOnce performs one parallel pass over every parser, replacing the
// per-source bucket on success and logging+ticking the error metric on
// failure. Returns the resulting per-source counts so callers (boot path,
// admin tooling) can report.
func (c *Cache) RefreshOnce(ctx context.Context) map[domain.Source]int {
	var wg sync.WaitGroup
	type result struct {
		src    domain.Source
		bucket map[string]domain.Vacancy
		err    error
	}
	results := make(chan result, len(c.parsers))
	for _, p := range c.parsers {
		wg.Add(1)
		go func(p Parser) {
			defer wg.Done()
			pctx, cancel := context.WithTimeout(ctx, c.perSourceTimeout)
			defer cancel()
			items, err := p.Fetch(pctx)
			if err != nil {
				results <- result{src: p.Source(), err: err}
				return
			}
			bucket := make(map[string]domain.Vacancy, len(items))
			for _, v := range items {
				if v.ExternalID == "" || v.Title == "" {
					continue
				}
				v.Source = p.Source()
				if v.Category == "" {
					v.Category = Categorize(v)
				}
				bucket[v.ExternalID] = v
			}
			results <- result{src: p.Source(), bucket: bucket}
		}(p)
	}
	wg.Wait()
	close(results)

	counts := make(map[domain.Source]int, len(c.parsers))
	c.mu.Lock()
	defer c.mu.Unlock()
	for r := range results {
		if r.err != nil {
			metrics.VacanciesCacheRefreshErrorsTotal.WithLabelValues(string(r.src)).Inc()
			c.log.Warn("vacancies.cache: refresh failed; keeping prior bucket",
				slog.String("source", string(r.src)),
				slog.Any("err", r.err))
			counts[r.src] = len(c.buckets[r.src])
			continue
		}
		c.buckets[r.src] = r.bucket
		counts[r.src] = len(r.bucket)
		c.log.Info("vacancies.cache: bucket refreshed",
			slog.String("source", string(r.src)),
			slog.Int("count", len(r.bucket)))
	}
	return counts
}

// Get returns the cached vacancy keyed on (source, externalID).
func (c *Cache) Get(source domain.Source, externalID string) (domain.Vacancy, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	bucket, ok := c.buckets[source]
	if !ok {
		return domain.Vacancy{}, fmt.Errorf("vacancies.cache.Get: %w", domain.ErrNotFound)
	}
	v, ok := bucket[externalID]
	if !ok {
		return domain.Vacancy{}, fmt.Errorf("vacancies.cache.Get: %w", domain.ErrNotFound)
	}
	return v, nil
}

// ListBySource returns a flat copy of one source's bucket. Used by the
// AnalyzeURL flow for sources whose URL slug doesn't match the cache key
// (e.g. MTS — URL has slug, cache is keyed by numeric id, so we scan).
func (c *Cache) ListBySource(source domain.Source) []domain.Vacancy {
	c.mu.RLock()
	defer c.mu.RUnlock()
	bucket, ok := c.buckets[source]
	if !ok {
		return nil
	}
	out := make([]domain.Vacancy, 0, len(bucket))
	for _, v := range bucket {
		out = append(out, v)
	}
	return out
}

// Upsert inserts/updates a single vacancy in its source bucket. Used by the
// AnalyzeURL flow so a freshly-resolved single posting becomes immediately
// addressable by Get without waiting for the next tick.
func (c *Cache) Upsert(v domain.Vacancy) {
	if v.ExternalID == "" || v.Source == "" {
		return
	}
	if v.Category == "" {
		v.Category = Categorize(v)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	bucket, ok := c.buckets[v.Source]
	if !ok {
		bucket = make(map[string]domain.Vacancy, 1)
		c.buckets[v.Source] = bucket
	}
	bucket[v.ExternalID] = v
}

// snapshot copies every vacancy in every bucket into a flat slice. Holds the
// read lock for the duration so List/Facets see a coherent state.
func (c *Cache) snapshot() []domain.Vacancy {
	c.mu.RLock()
	defer c.mu.RUnlock()
	total := 0
	for _, b := range c.buckets {
		total += len(b)
	}
	out := make([]domain.Vacancy, 0, total)
	for _, b := range c.buckets {
		for _, v := range b {
			out = append(out, v)
		}
	}
	return out
}

// List applies the filter in memory, sorts fetched_at desc (secondary by
// external_id desc for determinism), and pages the result.
func (c *Cache) List(filter domain.ListFilter) domain.Page {
	all := c.snapshot()
	matched := make([]domain.Vacancy, 0, len(all))
	for _, v := range all {
		if matchesFilter(v, filter) {
			matched = append(matched, v)
		}
	}
	slices.SortStableFunc(matched, func(a, b domain.Vacancy) int {
		if a.FetchedAt.Equal(b.FetchedAt) {
			return strings.Compare(b.ExternalID, a.ExternalID)
		}
		if a.FetchedAt.After(b.FetchedAt) {
			return -1
		}
		return 1
	})
	limit := filter.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	total := len(matched)
	if offset >= total {
		return domain.Page{Items: []domain.Vacancy{}, Total: total, Limit: limit, Offset: offset}
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return domain.Page{
		Items:  matched[offset:end],
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}
}

// Facets aggregates the four sidebar histograms over the *unfiltered*
// snapshot. Phase 1.6 — kept for callers that explicitly want the
// catalogue-wide counts (e.g. boot diagnostics). UI now goes through
// FacetsForFilter, which respects active sidebar selections.
func (c *Cache) Facets() domain.Facets {
	return c.FacetsForFilter(domain.ListFilter{})
}

// FacetsForFilter computes per-axis counts under the same standard
// e-commerce facet rule used by Algolia / Booking / Yandex.Market:
// each axis ignores its OWN selection so toggling stays reversible
// (otherwise selecting a single option would zero the other options
// and lock the user in). Non-axis filters DO apply: salary / location
// / skills always narrow the dataset because they're free-form.
//
// Concretely:
//   - Companies counts apply (categories, sources, salary, location, skills)
//   - Categories counts apply (companies, sources, salary, location, skills)
//   - Sources counts apply (companies, categories, salary, location, skills)
//   - Locations counts apply (companies, categories, sources, salary, skills)
//
// Cost: 4 linear passes over the snapshot. Cache snapshot is in-memory
// and small (<10k rows), so 40k matchesFilter() calls per request stay
// in single-digit-ms range.
func (c *Cache) FacetsForFilter(f domain.ListFilter) domain.Facets {
	all := c.snapshot()
	companies := map[string]int{}
	for _, v := range all {
		if v.Company == "" {
			continue
		}
		// Drop only the Companies axis from f.
		probe := f
		probe.Companies = nil
		if !matchesFilter(v, probe) {
			continue
		}
		companies[v.Company]++
	}
	categories := map[string]int{}
	for _, v := range all {
		probe := f
		probe.Categories = nil
		if !matchesFilter(v, probe) {
			continue
		}
		categories[string(v.Category)]++
	}
	sources := map[string]int{}
	for _, v := range all {
		probe := f
		probe.Sources = nil
		if !matchesFilter(v, probe) {
			continue
		}
		sources[string(v.Source)]++
	}
	locations := map[string]int{}
	for _, v := range all {
		if v.Location == "" {
			continue
		}
		probe := f
		probe.Location = ""
		if !matchesFilter(v, probe) {
			continue
		}
		locations[v.Location]++
	}
	return domain.Facets{
		Companies:  toEntriesSorted(companies),
		Categories: categoryEntriesOrdered(categories),
		Sources:    toEntriesSorted(sources),
		Locations:  toEntriesSorted(locations),
	}
}

// Counts returns the per-source bucket sizes — used by the boot log.
func (c *Cache) Counts() map[domain.Source]int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[domain.Source]int, len(c.buckets))
	for s, b := range c.buckets {
		out[s] = len(b)
	}
	return out
}

// matchesFilter is the in-memory equivalent of the old SQL WHERE clause.
func matchesFilter(v domain.Vacancy, f domain.ListFilter) bool {
	if len(f.Sources) > 0 && !slices.Contains(f.Sources, v.Source) {
		return false
	}
	if len(f.Companies) > 0 && !slices.Contains(f.Companies, v.Company) {
		return false
	}
	if len(f.Categories) > 0 && !slices.Contains(f.Categories, v.Category) {
		return false
	}
	if len(f.Skills) > 0 {
		have := make(map[string]struct{}, len(v.NormalizedSkills))
		for _, s := range v.NormalizedSkills {
			have[strings.ToLower(s)] = struct{}{}
		}
		for _, s := range f.Skills {
			if _, ok := have[strings.ToLower(s)]; !ok {
				return false
			}
		}
	}
	if f.SalaryMin > 0 {
		// Mirror the prior SQL semantics: salary_max NULL or >= floor, AND
		// salary_min NULL or within 50 000 of the floor.
		max := v.SalaryMax
		min := v.SalaryMin
		if max != 0 && max < f.SalaryMin {
			return false
		}
		if min != 0 && min < f.SalaryMin-50000 {
			return false
		}
	}
	if loc := strings.TrimSpace(f.Location); loc != "" {
		if !strings.Contains(strings.ToLower(v.Location), strings.ToLower(loc)) {
			return false
		}
	}
	return true
}

func toEntriesSorted(m map[string]int) []domain.FacetEntry {
	out := make([]domain.FacetEntry, 0, len(m))
	for k, c := range m {
		out = append(out, domain.FacetEntry{Name: k, Count: c})
	}
	slices.SortFunc(out, func(a, b domain.FacetEntry) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return strings.Compare(a.Name, b.Name)
	})
	return out
}

// categoryEntriesOrdered keeps the canonical AllCategories order so the UI
// renders a stable list (rather than re-sorting by count, which makes the
// sidebar jump around on every refresh).
func categoryEntriesOrdered(m map[string]int) []domain.FacetEntry {
	out := make([]domain.FacetEntry, 0, len(domain.AllCategories))
	for _, c := range domain.AllCategories {
		out = append(out, domain.FacetEntry{Name: string(c), Count: m[string(c)]})
	}
	return out
}
