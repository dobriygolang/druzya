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

// Mode — lobby format. Internal arena matches still use
// shared/enums.ArenaMode; this enum is the lobby-level UX contract.
//
// Phase 1.7 — 2v2 removed: paired-mode UX was confusing (queue counters
// shared across modes, half the lobby UI was Mode-dependent) and weak
// adoption. Existing arena_match rows with mode='duo_2v2' stay as
// history but no new lobby can request 2v2.
//
// Phase 2c — `solo` introduced: a single-player drill room with an
// optional skill_keys filter ("only BFS", "only segment-tree"). Solo
// lobbies pull tasks from arena_tasks WHERE skill_keys && filter.
// MaxMembers is forced to 1 by the validator.
type Mode string

const (
	Mode1v1  Mode = "1v1"
	ModeSolo Mode = "solo"
)

// IsValid returns true for known modes.
func (m Mode) IsValid() bool { return m == Mode1v1 || m == ModeSolo }

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
//
// SkillFilter is a Phase 2c addition: when non-empty, the task picker
// only chooses tasks tagged with at least one of the listed skill_keys
// (Atlas node keys). UI uses this to spin up "only BFS" or
// "only segment-tree" drill sessions from a Track step. Empty = no
// filter, falls back to the standard (Section, Difficulty) selector.
type Lobby struct {
	ID           uuid.UUID
	Code         string
	OwnerID      uuid.UUID
	Mode         Mode
	Section      string
	Difficulty   string
	SkillFilter  []string
	Visibility   Visibility
	MaxMembers   int
	AIAllowed    bool
	TimeLimitMin int
	Status       Status
	MatchID      *uuid.UUID
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// MaxSlotsForMode returns the canonical slot count for a mode. Used to
// validate MaxMembers requested by the owner.
func MaxSlotsForMode(m Mode) int {
	switch m {
	case Mode1v1:
		return 2
	case ModeSolo:
		return 1
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
