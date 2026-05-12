// directory_profile.go — Phase K T1 (P0) 2026-05-12. Tutor directory MVP
// entity types + repo port.
//
// Tutor directory = opt-in surface where students discover tutors. Until
// now tutor acquisition только через invite_code или InviteByUsername —
// both flows assume the tutor already knows the student. This adds the
// inverse direction: student browses, finds, applies.
//
// Identity rule: free per identity, не marketplace. Schema deliberately
// has NO rates / no hourly price / no payment fields. Verified badge —
// admin-only анти-spam exit valve.
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// DirectoryProfile mirrors a row in tutor_directory_profiles. Default
// shape («not visible, empty bio») means first-edit triggers an INSERT;
// subsequent edits UPDATE. UserID is both PK and FK to users.id.
type DirectoryProfile struct {
	UserID             uuid.UUID
	Visible            bool
	BioMD              string
	ExpertiseTags      []string
	Languages          []string
	Timezone           string
	AvailabilityMD     string
	LinkedinURL        string
	GithubURL          string
	VerifiedAt         *time.Time
	ApplicationMessage string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// DirectoryEntry — projection used by ListDirectoryTutors. Joins
// tutor_directory_profiles + users for display fields. Only visible=true
// rows are surfaced; verified is a server-computed bool from VerifiedAt.
type DirectoryEntry struct {
	UserID        uuid.UUID
	DisplayName   string
	Username      string
	AvatarURL     string
	BioMD         string
	ExpertiseTags []string
	Languages     []string
	Timezone      string
	Verified      bool
}

// Application mirrors a row in tutor_directory_applications. Student
// applies to a tutor by ID; tutor accepts (creates relationship) or
// declines. Status enum is closed: pending / accepted / declined.
type Application struct {
	ID        uuid.UUID
	TutorID   uuid.UUID
	StudentID uuid.UUID
	Message   string
	Status    ApplicationStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ApplicationStatus — closed enum mirroring SQL CHECK.
type ApplicationStatus string

const (
	ApplicationStatusPending  ApplicationStatus = "pending"
	ApplicationStatusAccepted ApplicationStatus = "accepted"
	ApplicationStatusDeclined ApplicationStatus = "declined"
)

// ApplicationWithStudent — list projection. Joins applications +
// users(students) for display in tutor's pending list.
type ApplicationWithStudent struct {
	Application
	StudentDisplayName string
	StudentUsername    string
	StudentAvatarURL   string
}

// Predefined expertise tag closed set. Frontend renders only these as
// chips; backend accepts any non-empty string. Single source of truth
// so chip picker + analytics filters stay in sync.
var ExpertiseTags = []string{
	"go_senior",
	"ml_engineering",
	"english_polish",
	"system_design",
	"algorithms",
	"cross_cutting",
}

// Predefined language codes. Same client/server-shared catalogue.
var LanguageCodes = []string{"ru", "en"}

// DirectoryRepo — persistence surface for the directory aggregate.
// Separate from the main Repo interface so test seams can mock the
// directory slice без stubbing assignment/event/etc methods. Same
// *Postgres struct satisfies both at runtime (Nth interface pattern
// established by AssignmentRepo, EventRepo, ReadingPathRepo).
type DirectoryRepo interface {
	// GetProfile returns the tutor's directory profile. ErrNotFound
	// when no row exists yet — caller (use case) treats this as «default
	// invisible empty profile» without surfacing an error to the client.
	GetProfile(ctx context.Context, userID uuid.UUID) (DirectoryProfile, error)

	// UpsertProfile inserts or updates. Caller passes the full desired
	// state — repo handles ON CONFLICT (user_id) DO UPDATE.
	UpsertProfile(ctx context.Context, profile DirectoryProfile) (DirectoryProfile, error)

	// ListVisible returns paginated directory entries (visible=true) with
	// optional tag/language filters. Tags filter uses && (any-overlap).
	// limit clamped 1..100, default 25. cursor opaque (created_at DESC, id DESC).
	ListVisible(
		ctx context.Context,
		filter DirectoryFilter,
		limit int,
		cursor string,
	) ([]DirectoryEntry, string, error)

	// CreateApplication writes a pending application. Unique partial
	// index protects against duplicate pending requests to the same
	// tutor; on collision returns ErrAlreadyApplied.
	CreateApplication(ctx context.Context, app Application) (Application, error)

	// ListApplicationsForTutor returns pending applications for tutor,
	// joined with student display fields. Newest first.
	ListApplicationsForTutor(ctx context.Context, tutorID uuid.UUID) ([]ApplicationWithStudent, error)

	// AcceptApplication transitions an application from pending to
	// accepted AND creates a tutor_students relationship атомарно. Same
	// pattern as AcceptInvite — two writes inside one tx.
	AcceptApplication(
		ctx context.Context,
		tutorID, applicationID uuid.UUID,
		now time.Time,
	) (Relationship, error)

	// DeclineApplication soft-marks status='declined'. No relationship
	// created. Returns ErrNotFound if missing, ErrInvalidInput if not pending.
	DeclineApplication(
		ctx context.Context,
		tutorID, applicationID uuid.UUID,
		now time.Time,
	) error
}

// DirectoryFilter — filter chip state passed to ListVisible. Empty
// slices mean «no filter on that dimension».
type DirectoryFilter struct {
	ExpertiseTags []string // OR semantics — match any
	Languages     []string // OR semantics — match any
}

// Directory-specific sentinel errors. Mapped to Connect codes by
// ports/server.go alongside the existing tutor errors (in errors.go).
var (
	ErrAlreadyApplied = errors.New("tutor: already applied to this tutor")
)
