// ozon_detail.go — explicit no-op fetcher for Ozon.
//
// Phase 4 punt: the Ozon careers detail endpoint is geo/JA3-blocked from
// our sandbox (host *.t.o3.ru), and no public detail JSON endpoint was
// discoverable. Anti-fallback: rather than guess at a URL or scrape a
// half-broken landing page, we ship a no-op fetcher that:
//
//   - returns the listing-level snapshot as VacancyDetails
//   - sets SourceOnly=true so the frontend renders a CTA instead of empty
//     rich-block placeholders.
package details

import (
	"context"
	"log/slog"

	"druz9/vacancies/domain"

	cacheLayer "druz9/vacancies/infra/cache"
)

// OzonDetailFetcher implements cache.DetailFetcher.
type OzonDetailFetcher struct {
	log *slog.Logger
}

// NewOzon builds the no-op fetcher.
func NewOzon(log *slog.Logger) *OzonDetailFetcher {
	if log == nil {
		panic("vacancies.details.NewOzon: logger is required (anti-fallback policy)")
	}
	return &OzonDetailFetcher{log: log}
}

// Source implements DetailFetcher.
func (o *OzonDetailFetcher) Source() domain.Source { return domain.SourceOzon }

// FetchDetails returns the listing snapshot with SourceOnly=true.
func (o *OzonDetailFetcher) FetchDetails(_ context.Context, _ string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	return domain.VacancyDetails{
		Vacancy:    listing,
		SourceOnly: true,
	}, nil
}

var _ cacheLayer.DetailFetcher = (*OzonDetailFetcher)(nil)
