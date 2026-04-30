// Package domain holds the Clubs bounded context (Phase 3).
//
// Clubs — структурированная витрина встреч внутри circles. Каждый club:
//   - живёт под одним circle (FK),
//   - имеет curator (user_id) и curriculum (markdown),
//   - содержит ленту club_sessions (отдельные встречи).
//
// Status enums зеркалят SQL constraint (CHECK / native enum).
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// SessionStatus mirrors SQL `club_session_status` enum.
type SessionStatus string

const (
	SessionScheduled SessionStatus = "scheduled"
	SessionLive      SessionStatus = "live"
	SessionDone      SessionStatus = "done"
	SessionCancelled SessionStatus = "cancelled"
)

// IsValid — true для known статусов.
func (s SessionStatus) IsValid() bool {
	switch s {
	case SessionScheduled, SessionLive, SessionDone, SessionCancelled:
		return true
	}
	return false
}

// AttendeeStatus mirrors SQL `club_attendee_status` enum.
type AttendeeStatus string

const (
	AttendeeRSVPYes  AttendeeStatus = "rsvp_yes"
	AttendeeRSVPNo   AttendeeStatus = "rsvp_no"
	AttendeeAttended AttendeeStatus = "attended"
	AttendeeNoShow   AttendeeStatus = "no_show"
)

// IsValid — true для known статусов.
func (s AttendeeStatus) IsValid() bool {
	switch s {
	case AttendeeRSVPYes, AttendeeRSVPNo, AttendeeAttended, AttendeeNoShow:
		return true
	}
	return false
}

// Club — top-level row.
type Club struct {
	ID              uuid.UUID
	CircleID        uuid.UUID
	Slug            string
	Name            string
	TopicTag        string
	CuratorID       *uuid.UUID
	CurriculumMD    string
	ScheduleKind    string
	DefaultZoomLink string
	TGAnchorURL     string
	CoverImageURL   string
	IsPublic        bool
	IsActive        bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Session — одна встреча клуба.
type Session struct {
	ID                 uuid.UUID
	ClubID             uuid.UUID
	ScheduledAt        time.Time
	DurationMin        int
	TopicTitle         string
	TopicMD            string
	PresenterHandle    string
	ZoomLink           string
	TGPostURL          string
	RecordingURL       string
	PreReadMD          string
	SummaryMD          string
	TakeawaysMD        string
	Status             SessionStatus
	AttachedCodexSlugs []string
	AttachedEventIDs   []uuid.UUID
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Material — артефакт сессии (slides / code / link / doc / transcript).
type Material struct {
	ID        uuid.UUID
	SessionID uuid.UUID
	Kind      string
	Label     string
	URL       string
	SortOrder int
	CreatedAt time.Time
}

// Attendee — RSVP / attended запись per-user.
type Attendee struct {
	SessionID uuid.UUID
	UserID    uuid.UUID
	Status    AttendeeStatus
	NotesMD   string
	RSVPAt    time.Time
}

// SessionWithMaterials — projection для session detail page.
type SessionWithMaterials struct {
	Session   Session
	Materials []Material
	// AttendeeStatus — статус текущего юзера на этой session'е (если он
	// есть в attendees). Empty string когда юзер ещё не RSVP'нул.
	AttendeeStatus AttendeeStatus
}

// ClubWithSessions — projection для /clubs/:slug page.
type ClubWithSessions struct {
	Club     Club
	Upcoming []Session
	Past     []Session
}

// CreateClubInput — wire-shape для POST /admin/clubs. Curator opt-in:
// если CuratorID nil, club без явного куратора (admin может позже
// patch'нуть). Slug — нормализуется в use case (lowercase + trim);
// уникальность на DB-level (UNIQUE constraint).
type CreateClubInput struct {
	CircleID        uuid.UUID
	Slug            string
	Name            string
	TopicTag        string
	CuratorID       *uuid.UUID
	CurriculumMD    string
	ScheduleKind    string
	DefaultZoomLink string
	TGAnchorURL     string
	CoverImageURL   string
	IsPublic        bool
}

// CreateSessionInput — wire-shape для POST /admin/clubs/{slug}/sessions.
type CreateSessionInput struct {
	ClubID             uuid.UUID
	ScheduledAt        time.Time
	DurationMin        int
	TopicTitle         string
	TopicMD            string
	PresenterHandle    string
	ZoomLink           string
	TGPostURL          string
	PreReadMD          string
	AttachedCodexSlugs []string
}

// UpcomingForUser — projection для Hone Today chip. Возвращает следующую
// сессию любого клуба, к которой юзер RSVP'нул `rsvp_yes` (или RSVP'нул
// — но not 'rsvp_no'). Empty если нет ни одной такой.
type UpcomingForUser struct {
	SessionID    uuid.UUID
	ClubID       uuid.UUID
	ClubSlug     string
	ClubName     string
	ScheduledAt  time.Time
	TopicTitle   string
	ZoomLink     string
	HoursFromNow int
}

// GhostedClubFact — Phase 3 intelligence reader. Сигнал «юзер RSVP'd_yes
// на ≥1 сессию в окне past N дней но статус остался rsvp_yes (никто не
// проставил attended) — disengagement nudge для coach severity.
type GhostedClubFact struct {
	ClubName    string
	TopicTitle  string
	HappenedAgo int // days
}

// Repo — single port для всех clubs reads/writes.
type Repo interface {
	// ListPublic возвращает active+public клубы для anonymous-readable
	// catalogue. Сортировка: created_at DESC, лимит caller'а.
	ListPublic(ctx context.Context, limit int) ([]Club, error)
	GetBySlug(ctx context.Context, slug string) (Club, error)
	GetClubWithSessions(ctx context.Context, slug string, upcomingLimit, pastLimit int) (ClubWithSessions, error)
	GetSessionWithMaterials(ctx context.Context, sessionID uuid.UUID, viewerUserID *uuid.UUID) (SessionWithMaterials, error)

	// RSVP — upsert (session_id, user_id) → status. Idempotent.
	RSVP(ctx context.Context, sessionID, userID uuid.UUID, status AttendeeStatus) (Attendee, error)

	// Curator-only writes. Use case сам гейтит role; repo принимает уже
	// валидированный input.
	CreateClub(ctx context.Context, in CreateClubInput) (Club, error)
	CreateSession(ctx context.Context, in CreateSessionInput) (Session, error)

	// NextUpcomingForUser — для Hone Today chip. Возвращает ближайшую
	// scheduled-сессию в которой user RSVP'd_yes. nil-result если нет.
	NextUpcomingForUser(ctx context.Context, userID uuid.UUID) (*UpcomingForUser, error)

	// GhostedSessionsInWindow — для intelligence severity grader.
	// Сессии за past windowDays где user RSVP'd_yes но статус не дошёл
	// до 'attended'. Empty slice если все ОК.
	GhostedSessionsInWindow(ctx context.Context, userID uuid.UUID, windowDays int) ([]GhostedClubFact, error)
}

// Sentinel errors.
var (
	ErrNotFound      = errors.New("clubs: not found")
	ErrInvalidInput  = errors.New("clubs: invalid input")
	ErrAlreadyExists = errors.New("clubs: already exists")
)
