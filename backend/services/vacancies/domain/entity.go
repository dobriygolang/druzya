// Package domain defines the vacancies bounded-context aggregate.
//
// Phase 3 model:
//
//   - Vacancy   — a parsed external posting (Yandex, Ozon, VK, MTS, WB…).
//     Lives only in an in-process cache (services/vacancies/infra/cache).
//     Identity is the composite (Source, ExternalID); there is no DB id
//     anymore.
//   - SavedVacancy — per-user kanban entry. The Snapshot field embeds the
//     Vacancy as it looked when the user clicked "Сохранить". Persisted in
//     saved_vacancies as JSONB.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical sentinel for missing rows / cache misses.
// Repos and the cache must return a wrapped variant so handlers can map it
// to HTTP 404 cleanly.
var ErrNotFound = errors.New("vacancies: not found")

// ErrInvalidStatus signals the status transition is rejected by domain rules.
var ErrInvalidStatus = errors.New("vacancies: invalid status")

// Source enumerates the parsers we ship.
type Source string

const (
	SourceYandex Source = "yandex"
	// SourceOzon is the retail-side careers site (career.ozon.ru).
	SourceOzon Source = "ozon"
	// SourceOzonTech is the IT-subsidiary careers site (career.ozon.tech).
	SourceOzonTech Source = "ozontech"
	// SourceTinkoff is T-Bank careers (rebranded from Tinkoff).
	SourceTinkoff     Source = "tinkoff"
	SourceVK          Source = "vk"
	SourceSber        Source = "sber"
	SourceAvito       Source = "avito"
	SourceWildberries Source = "wildberries"
	SourceMTS         Source = "mts"
	SourceKaspersky   Source = "kaspersky"
	SourceJetBrains   Source = "jetbrains"
	SourceLamoda      Source = "lamoda"
)

// AllSources is used by validation in the list endpoint.
var AllSources = []Source{
	SourceYandex, SourceOzon, SourceOzonTech, SourceTinkoff, SourceVK,
	SourceSber, SourceAvito, SourceWildberries, SourceMTS,
	SourceKaspersky, SourceJetBrains, SourceLamoda,
}

// IsValidSource is the cheap allow-list check used by parsers + handlers.
func IsValidSource(s Source) bool {
	for _, x := range AllSources {
		if x == s {
			return true
		}
	}
	return false
}

// SavedStatus is the kanban column for the user's tracked vacancy.
type SavedStatus string

const (
	StatusSaved        SavedStatus = "saved"
	StatusApplied      SavedStatus = "applied"
	StatusInterviewing SavedStatus = "interviewing"
	StatusRejected     SavedStatus = "rejected"
	StatusOffer        SavedStatus = "offer"
)

// IsValidStatus mirrors the DB CHECK constraint so we reject early.
func IsValidStatus(s SavedStatus) bool {
	switch s {
	case StatusSaved, StatusApplied, StatusInterviewing, StatusRejected, StatusOffer:
		return true
	}
	return false
}

// Category is the coarse "направление" enum used by the new sidebar facet.
// Source-specific mappers in infra/cache/categorize.go derive it at parse
// time. Anti-fallback: anything we can't classify confidently goes to
// CategoryOther — never to a guessed bucket.
type Category string

const (
	CategoryBackend    Category = "backend"
	CategoryFrontend   Category = "frontend"
	CategoryMobile     Category = "mobile"
	CategoryData       Category = "data"
	CategoryDevOps     Category = "devops"
	CategoryQA         Category = "qa"
	CategoryAnalytics  Category = "analytics"
	CategoryProduct    Category = "product"
	CategoryDesign     Category = "design"
	CategoryManagement Category = "management"
	CategoryOther      Category = "other"
)

// AllCategories is the canonical iteration order (used by facets).
var AllCategories = []Category{
	CategoryBackend, CategoryFrontend, CategoryMobile, CategoryData,
	CategoryDevOps, CategoryQA, CategoryAnalytics, CategoryProduct,
	CategoryDesign, CategoryManagement, CategoryOther,
}

// IsValidCategory is the allow-list check used by handlers.
func IsValidCategory(c Category) bool {
	for _, x := range AllCategories {
		if x == c {
			return true
		}
	}
	return false
}

// Vacancy is the parsed posting. Identity is (Source, ExternalID) — there
// is no DB id anymore; the cache is keyed on the composite.
type Vacancy struct {
	Source           Source     `json:"source"`
	ExternalID       string     `json:"external_id"`
	URL              string     `json:"url"`
	Title            string     `json:"title"`
	Company          string     `json:"company,omitempty"`
	Location         string     `json:"location,omitempty"`
	EmploymentType   string     `json:"employment_type,omitempty"`
	ExperienceLevel  string     `json:"experience_level,omitempty"`
	SalaryMin        int        `json:"salary_min,omitempty"`
	SalaryMax        int        `json:"salary_max,omitempty"`
	Currency         string     `json:"currency,omitempty"`
	Description      string     `json:"description"`
	RawSkills        []string   `json:"raw_skills"`
	NormalizedSkills []string   `json:"normalized_skills"`
	Category         Category   `json:"category"`
	PostedAt         *time.Time `json:"posted_at,omitempty"`
	FetchedAt        time.Time  `json:"fetched_at"`
	RawJSON          []byte     `json:"-"`
}

// SavedVacancy is the per-user kanban row. The Snapshot is what the kanban
// renders — frozen at save-time so the saved entry survives upstream
// deletions and renames.
type SavedVacancy struct {
	ID         int64
	UserID     uuid.UUID
	Source     Source
	ExternalID string
	Status     SavedStatus
	Notes      string
	Snapshot   Vacancy
	SavedAt    time.Time
	UpdatedAt  time.Time
}

// SkillGap is the diff between a vacancy's required skills and what the
// caller already has. Surfaced by AnalyzeURL and the detail page.
type SkillGap struct {
	Required []string // normalized list from the vacancy
	Matched  []string // intersection
	Missing  []string // required \ user
	Extra    []string // user \ required (informational only)
}

// ListFilter is the query DTO for the listing endpoint. All fields are
// optional; the zero value lists every cached vacancy in fetched-at desc
// order. Multi-select fields are OR within a field, AND across fields.
type ListFilter struct {
	Sources    []Source
	Companies  []string
	Categories []Category
	Skills     []string // ALL must be present in normalized_skills (AND)
	SalaryMin  int
	Location   string
	Limit      int
	Offset     int
}

// Page is the pagination envelope returned by ListByFilter.
type Page struct {
	Items  []Vacancy
	Total  int
	Limit  int
	Offset int
}

// FacetEntry is one row of a facet histogram.
type FacetEntry struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Facets bundles the four sidebar histograms. Computed live from the cache
// on each request — cheap at ~5000 items × const-time aggregation.
type Facets struct {
	Companies  []FacetEntry `json:"companies"`
	Categories []FacetEntry `json:"categories"`
	Sources    []FacetEntry `json:"sources"`
	Locations  []FacetEntry `json:"locations"`
}
