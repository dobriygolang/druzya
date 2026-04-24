// Package domain contains the cohort bounded-context entities, war-tally logic
// and repository interfaces. No framework imports here — pure Go.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("cohort: not found")
	ErrNotMember       = errors.New("cohort: user is not a member of the cohort")
	ErrWrongSection    = errors.New("cohort: member is assigned to a different section")
	ErrWarNotActive    = errors.New("cohort: war is not active for this week")
	ErrCodeTooLarge    = errors.New("cohort: code exceeds 50KB limit")
	ErrInvalidSection  = errors.New("cohort: invalid section")
	ErrInvalidLanguage = errors.New("cohort: invalid language")
	ErrCohortMismatch  = errors.New("cohort: member does not belong to this cohort")
)

// MaxCodeSizeBytes is the per-contribution cap (mirrors arena's limit, §11).
const MaxCodeSizeBytes = 50 * 1024

// InitialCohortELO is the default rating for a freshly-founded cohort.
const InitialCohortELO = 1000

// Role constants — stored in the DB as strings.
const (
	RoleCaptain = "captain"
	RoleMember  = "member"
)

// WarLineCount is the fixed number of lines per cohort war (5 sections).
const WarLineCount = 5

// Cohort is a domain entity mapped onto the `cohorts` table.
type Cohort struct {
	ID        uuid.UUID
	OwnerID   uuid.UUID
	Name      string
	Emblem    string
	CohortElo int
	CreatedAt time.Time
	// Populated by the use-case layer when hydrating the public view.
	Members      []Member
	CurrentWarID *uuid.UUID
}

// Member mirrors a cohort_members row, enriched with username for DTOs.
type Member struct {
	CohortID        uuid.UUID
	UserID          uuid.UUID
	Username        string
	Role            string
	AssignedSection *enums.Section
	JoinedAt        time.Time
}

// War mirrors a cohort_wars row.
type War struct {
	ID        uuid.UUID
	CohortAID uuid.UUID
	CohortBID uuid.UUID
	WeekStart time.Time
	WeekEnd   time.Time
	ScoresA   map[enums.Section]int // section → aggregated score
	ScoresB   map[enums.Section]int
	WinnerID  *uuid.UUID
	CreatedAt time.Time
}

// WarLine is a derived view — one per section — for the CohortWar response DTO.
type WarLine struct {
	Section      enums.Section
	ScoreA       int
	ScoreB       int
	Contributors []Contribution
}

// Side identifies which of the two cohorts a contribution belongs to.
type Side string

// Side values.
const (
	SideA Side = "a"
	SideB Side = "b"
)

// Contribution is a single graded submission applied to a war line. For MVP
// each contribution carries the delta score plus the contributor identity so
// the GET war response can render the contributors list.
type Contribution struct {
	WarID    uuid.UUID
	Section  enums.Section
	Side     Side
	UserID   uuid.UUID
	Username string
	Score    int
	AddedAt  time.Time
}

// TopCohortSummary is the aggregated row served by ListTopCohorts — cohort
// identity plus the leaderboard metrics. `Rank` is 1-indexed and assigned
// at the use-case layer (the SQL only orders by elo_total desc).
type TopCohortSummary struct {
	CohortID     uuid.UUID
	Name         string
	Emblem       string
	MembersCount int
	EloTotal     int
	WarsWon      int
	Rank         int
}

// MaxTopCohortsLimit is the hard ceiling enforced by the repo and ports
// layers — protects against accidental table-scans by misconfigured clients.
const MaxTopCohortsLimit = 100

// DefaultTopCohortsLimit is what the ports layer falls back to when the
// caller omits or sends a non-positive `limit`.
const DefaultTopCohortsLimit = 20
