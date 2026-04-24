// Package details holds per-source DetailFetcher implementations for the
// lazy detail enrichment cache (Phase 4).
//
// Each fetcher targets the source's *detail* endpoint (verified live
// 2026-04-23 — see the table in the Phase 4 plan). The contract:
//
//	Source() returns the canonical source key.
//	FetchDetails(ctx, externalID, listing) returns a VacancyDetails. The
//	  embedded Vacancy is the listing-level snapshot the cache passes in
//	  (NOT a re-decoded version from the detail body) — fetchers fill
//	  only the rich blocks.
//
// Anti-fallback: every fetcher wraps errors with %w and tickets the
// shared metric in the cache layer. NEVER fabricate description text.
package details

import (
	"net/http"
	"time"
)

const scraperUA = "Mozilla/5.0 (compatible; druz9-vacancies/1.0; +https://druz9.online)"

func defaultClient() *http.Client {
	return &http.Client{Timeout: 15 * time.Second}
}
