// Package domain defines the vacancies bounded-context aggregate.
//
// We model two aggregates:
//
//   - Vacancy — a parsed external posting (HH, Yandex, Ozon, T-Bank, VK…).
//     Owned by the parser pipeline; idempotent on (Source, ExternalID).
//   - SavedVacancy — per-user kanban entry referring to a Vacancy.id.
//
// Both are intentionally plain structs with no behaviour — domain rules live
// in service.go (skill normalisation, status transitions). The repos exposed
// in repo.go are the only IO seam.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical sentinel for missing rows. Repos must return
// a wrapped variant so handlers can map it to HTTP 404 cleanly.
var ErrNotFound = errors.New("vacancies: not found")

// ErrInvalidStatus signals the status transition is rejected by domain rules.
var ErrInvalidStatus = errors.New("vacancies: invalid status")

// Source enumerates the parsers we ship. Stored as TEXT in the DB; new sources
// are added by registering a Parser implementation and listing the constant
// here.
type Source string

const (
	SourceHH          Source = "hh"
	SourceYandex      Source = "yandex"
	SourceOzon        Source = "ozon"
	SourceTinkoff     Source = "tinkoff" // T-Bank careers
	SourceVK          Source = "vk"
	SourceSber        Source = "sber"
	SourceAvito       Source = "avito"
	SourceWildberries Source = "wildberries"
	SourceMTS         Source = "mts"
	SourceKaspersky   Source = "kaspersky"
	SourceJetBrains   Source = "jetbrains"
	SourceLamoda      Source = "lamoda"
)

// AllSources is used by validation in the list endpoint. Order matches the
// frontend's filter sidebar default.
var AllSources = []Source{
	SourceHH, SourceYandex, SourceOzon, SourceTinkoff, SourceVK,
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

// Vacancy is the parsed posting. RawJSON is the verbatim source payload
// stored for forensics + future re-parses without a network round-trip.
type Vacancy struct {
	ID               int64
	Source           Source
	ExternalID       string
	URL              string
	Title            string
	Company          string
	Location         string
	EmploymentType   string
	ExperienceLevel  string
	SalaryMin        int
	SalaryMax        int
	Currency         string
	Description      string
	RawSkills        []string
	NormalizedSkills []string
	PostedAt         *time.Time
	FetchedAt        time.Time
	RawJSON          []byte
}

// SavedVacancy is the per-user kanban row. UserID matches auth.users.id (UUID).
type SavedVacancy struct {
	ID        int64
	UserID    uuid.UUID
	VacancyID int64
	Status    SavedStatus
	Notes     string
	SavedAt   time.Time
	UpdatedAt time.Time
}

// SavedWithVacancy is the eager-loaded join used by the kanban page so the
// frontend doesn't N+1 by id.
type SavedWithVacancy struct {
	Saved   SavedVacancy
	Vacancy Vacancy
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
// optional; the zero value lists every vacancy in fetched-at desc order.
type ListFilter struct {
	Sources   []Source // OR-combined; empty = any source
	Skills    []string // ALL must be present in normalized_skills (AND, GIN)
	SalaryMin int      // 0 = no floor
	Location  string   // case-insensitive substring; "" = anywhere
	Limit     int      // default 30, max 100
	Offset    int
}

// Page is the pagination envelope returned by ListByFilter.
type Page struct {
	Items  []Vacancy
	Total  int
	Limit  int
	Offset int
}
