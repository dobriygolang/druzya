// Package domain holds Custom-Lobby entities and ports.
//
// A Lobby is a private match room owned by one user, joinable via the
// public list, a direct invite link, or a 4-letter A-Z code. It's a
// pre-match holding pen: when the owner clicks Start (or all slots are
// filled) the lobby transitions to status='live' and stores the resulting
// arena_match.id, after which the SPA navigates members to /arena/match/{id}.
//
// Anti-fallback: the domain owns no defaults that could mask backend gaps —
// e.g. an empty members list MUST surface as "lobby has only the owner",
// never as a hardcoded crowd. Code generation happens in infra; if collision
// retries are exhausted, the use case errors out instead of silently re-keying.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Mode — number of human players. Internal arena matches still use
// shared/enums.ArenaMode; this enum is the lobby-level UX contract.
type Mode string

const (
	Mode1v1 Mode = "1v1"
	Mode2v2 Mode = "2v2"
)

// IsValid returns true for known modes.
func (m Mode) IsValid() bool { return m == Mode1v1 || m == Mode2v2 }

// Visibility controls discoverability.
type Visibility string

const (
	VisibilityPublic   Visibility = "public"
	VisibilityUnlisted Visibility = "unlisted"
	VisibilityPrivate  Visibility = "private"
)

// IsValid returns true for known visibilities.
func (v Visibility) IsValid() bool {
	switch v {
	case VisibilityPublic, VisibilityUnlisted, VisibilityPrivate:
		return true
	}
	return false
}

// Status is the lobby lifecycle state.
type Status string

const (
	StatusOpen      Status = "open"
	StatusLive      Status = "live"
	StatusCancelled Status = "cancelled"
)

// Role of a member inside a lobby.
type Role string

const (
	RoleOwner  Role = "owner"
	RoleMember Role = "member"
)

// CodeLength is the fixed 4-letter A-Z code length used for lobby invites.
const CodeLength = 4

// MaxCodeRetries is how many times the infra adapter will retry on a UNIQUE
// collision before giving up. After this we surface the underlying error
// rather than silently re-keying behind the user's back.
const MaxCodeRetries = 5

// Lobby is the room entity.
type Lobby struct {
	ID            uuid.UUID
	Code          string
	OwnerID       uuid.UUID
	Mode          Mode
	Section       string
	Difficulty    string
	Visibility    Visibility
	MaxMembers    int
	AIAllowed     bool
	TimeLimitMin  int
	Status        Status
	MatchID       *uuid.UUID
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// MaxSlotsForMode returns the canonical slot count for a mode. Used to
// validate MaxMembers requested by the owner — the column itself accepts
// 2..4 but we constrain by mode here.
func MaxSlotsForMode(m Mode) int {
	switch m {
	case Mode1v1:
		return 2
	case Mode2v2:
		return 4
	}
	return 0
}

// Member binds a user to a lobby.
type Member struct {
	LobbyID  uuid.UUID
	UserID   uuid.UUID
	JoinedAt time.Time
	Role     Role
	Team     int
}

// LobbyView combines a lobby with its current members.
type LobbyView struct {
	Lobby   Lobby
	Members []Member
}

// Sentinel errors.
var (
	ErrNotFound      = errors.New("lobby: not found")
	ErrAlreadyMember = errors.New("lobby: already a member")
	ErrFull          = errors.New("lobby: full")
	ErrClosed        = errors.New("lobby: not open")
	ErrForbidden     = errors.New("lobby: forbidden")
	ErrCodeExhausted = errors.New("lobby: code generation exhausted retries")
)
