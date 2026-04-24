// Package app — vacancies use cases. Each file owns one verb.
//
//	list.go    — paginated read for the catalogue page (cache-backed)
//	save.go    — per-user kanban CRUD (snapshot-based)
//	analyze.go — single-URL paste-the-link UX (POST /vacancies/analyze)
package app

import (
	"context"
	"fmt"

	"druz9/vacancies/domain"
)

// CacheReader is the cache surface the read use cases need. The concrete
// implementation is *infra/cache.Cache; declared as an interface here so
// tests can inject a fake.
//
// ListBySource returns one source's bucket as a flat slice — used by
// AnalyzeURL to reverse-resolve URL slugs back to cache keys when the
// upstream URL identifier doesn't match what we use as the key (MTS).
type CacheReader interface {
	List(filter domain.ListFilter) domain.Page
	Get(source domain.Source, externalID string) (domain.Vacancy, error)
	ListBySource(source domain.Source) []domain.Vacancy
	Facets() domain.Facets
}

// ListVacancies is the use case behind GET /vacancies.
type ListVacancies struct {
	Cache CacheReader
}

// Do clamps the filter and reads from the cache. No error path — the cache
// is always available; an empty bucket returns an empty page.
func (l *ListVacancies) Do(_ context.Context, f domain.ListFilter) (domain.Page, error) {
	if f.Limit < 0 {
		f.Limit = 0
	}
	return l.Cache.List(f), nil
}

// GetVacancy is the use case behind GET /vacancies/{source}/{external_id}.
type GetVacancy struct {
	Cache CacheReader
}

// Do reads one vacancy by composite identity.
func (g *GetVacancy) Do(_ context.Context, source domain.Source, externalID string) (domain.Vacancy, error) {
	v, err := g.Cache.Get(source, externalID)
	if err != nil {
		return domain.Vacancy{}, fmt.Errorf("vacancies.GetVacancy: %w", err)
	}
	return v, nil
}

// DetailsReader is the lazy-detail-cache surface the GetVacancyDetails use
// case needs. The concrete implementation is *infra/cache.DetailsCache.
type DetailsReader interface {
	Get(ctx context.Context, source domain.Source, externalID string) (domain.VacancyDetails, error)
}

// GetVacancyDetails is the use case behind the rich detail endpoint.
// It returns VacancyDetails (listing snapshot + per-source rich blocks).
type GetVacancyDetails struct {
	Details DetailsReader
}

// Do reads the rich details, falling through to ErrNotFound when neither
// the listing nor the detail endpoint has the key.
func (g *GetVacancyDetails) Do(ctx context.Context, source domain.Source, externalID string) (domain.VacancyDetails, error) {
	v, err := g.Details.Get(ctx, source, externalID)
	if err != nil {
		return domain.VacancyDetails{}, fmt.Errorf("vacancies.GetVacancyDetails: %w", err)
	}
	return v, nil
}

// GetFacets is the use case behind GET /vacancies/facets.
type GetFacets struct {
	Cache CacheReader
}

// Do returns the four sidebar histograms over the *unfiltered* cache.
func (g *GetFacets) Do(_ context.Context) (domain.Facets, error) {
	return g.Cache.Facets(), nil
}
