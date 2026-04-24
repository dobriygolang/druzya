package domain

import "time"

// VacancyDetails is the rich, detail-page-only view of a vacancy. It embeds
// the listing-level Vacancy snapshot (which the cache always has) and
// augments it with whatever rich blocks the source's *detail* endpoint
// returns.
//
// Phase 4 model:
//
//   - The listing-level cache (infra/cache.Cache) holds Vacancy.
//   - A second, lazy cache (infra/cache.DetailsCache) holds VacancyDetails.
//     It is populated on the first GET /vacancies/{source}/{external_id} for
//     a given key; subsequent reads served from cache; entries refresh
//     every TTL via stale-while-revalidate.
//
// All extra fields are optional — a source fills only what it has. Anti-
// fallback: if the source's detail endpoint fails, the fetcher returns
// VacancyDetails{Vacancy: listing} (no rich fields, no fake content) and
// the failure is logged + metric-ticked. NEVER fabricate a description.
type VacancyDetails struct {
	Vacancy

	// DescriptionHTML is sanitised HTML rich text from the source. It is
	// safe to render with dangerouslySetInnerHTML (sanitised server-side
	// against an allow-list of structural tags).
	DescriptionHTML string `json:"description_html,omitempty"`

	// Requirements / Duties / Conditions are bullet lists. Each entry is a
	// plain-text line; the frontend wraps them in <ul><li>.
	Requirements []string `json:"requirements,omitempty"`
	Duties       []string `json:"duties,omitempty"`
	Conditions   []string `json:"conditions,omitempty"`

	// OurTeam is a free-text "о команде" block (Yandex-only at the moment).
	OurTeam string `json:"our_team,omitempty"`

	// TechStack is an optional curated stack list (Yandex's tech_stack).
	// Sources that put tech in a free-text "Требования" block leave this
	// empty — the frontend renders the listing-level skills chip-list
	// instead.
	TechStack []string `json:"tech_stack,omitempty"`

	// SourceOnly is true when the source has no public detail endpoint we
	// can hit (Ozon: host blocked from our sandbox, no JSON API discoverable).
	// The frontend uses this flag to render a "Полное описание на …" CTA
	// instead of empty rich sections.
	SourceOnly bool `json:"source_only,omitempty"`

	// FetchedAt records when this detail entry was populated. Distinct from
	// Vacancy.FetchedAt (which is the listing-cache time). The detail cache
	// uses this to compute TTL / stale-while-revalidate.
	DetailsFetchedAt time.Time `json:"details_fetched_at"`
}
