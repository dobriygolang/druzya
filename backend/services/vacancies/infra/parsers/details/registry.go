// registry.go — bundle every detail fetcher for the wire-up in
// cmd/monolith/services/vacancies.go.
package details

import (
	"log/slog"

	cacheLayer "druz9/vacancies/infra/cache"
)

// Config bundles per-fetcher knobs.
type Config struct {
	Log *slog.Logger
}

// RegisterAll returns the per-source DetailFetcher slice in the same
// shape as the listing-parser RegisterAll. Order is irrelevant — the
// DetailsCache indexes by Source() at construction time.
//
// Anti-fallback: every fetcher here is paired with a *verified* upstream
// (see comments at the top of each file). The Ozon entry is intentionally
// a no-op — it returns the listing snapshot with SourceOnly=true so the
// frontend renders a CTA instead of empty rich blocks.
func RegisterAll(cfg Config) []cacheLayer.DetailFetcher {
	if cfg.Log == nil {
		panic("vacancies.details.RegisterAll: logger is required (anti-fallback policy)")
	}
	return []cacheLayer.DetailFetcher{
		NewYandex(cfg.Log),
		NewWB(cfg.Log),
		NewMTS(cfg.Log),
		NewVK(cfg.Log),
		NewOzon(cfg.Log),
	}
}
