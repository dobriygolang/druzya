// Package domain contains the guild bounded-context entities, war-tally logic
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
	ErrNotFound           = errors.New("guild: not found")
	ErrNotMember          = errors.New("guild: user is not a member of the guild")
	ErrWrongSection       = errors.New("guild: member is assigned to a different section")
	ErrWarNotActive       = errors.New("guild: war is not active for this week")
	ErrCodeTooLarge       = errors.New("guild: code exceeds 50KB limit")
	ErrInvalidSection     = errors.New("guild: invalid section")
	ErrInvalidLanguage    = errors.New("guild: invalid language")
	ErrGuildMismatch      = errors.New("guild: member does not belong to this guild")
)

// MaxCodeSizeBytes is the per-contribution cap (mirrors arena's limit, §11).
const MaxCodeSizeBytes = 50 * 1024

// InitialGuildELO is the default rating for a freshly-founded guild.
const InitialGuildELO = 1000

// Role constants — stored in the DB as strings.
const (
	RoleCaptain = "captain"
	RoleMember  = "member"
)

// WarLineCount is the fixed number of lines per guild war (5 sections).
const WarLineCount = 5

// Guild is a domain entity mapped onto the `guilds` table.
type Guild struct {
	ID         uuid.UUID
	OwnerID    uuid.UUID
	Name       string
	Emblem     string
	GuildElo   int
	CreatedAt  time.Time
	// Populated by the use-case layer when hydrating the public view.
	Members      []Member
	CurrentWarID *uuid.UUID
}

// Member mirrors a guild_members row, enriched with username for DTOs.
type Member struct {
	GuildID         uuid.UUID
	UserID          uuid.UUID
	Username        string
	Role            string
	AssignedSection *enums.Section
	JoinedAt        time.Time
}

// War mirrors a guild_wars row.
type War struct {
	ID         uuid.UUID
	GuildAID   uuid.UUID
	GuildBID   uuid.UUID
	WeekStart  time.Time
	WeekEnd    time.Time
	ScoresA    map[enums.Section]int // section → aggregated score
	ScoresB    map[enums.Section]int
	WinnerID   *uuid.UUID
	CreatedAt  time.Time
}

// WarLine is a derived view — one per section — for the GuildWar response DTO.
type WarLine struct {
	Section      enums.Section
	ScoreA       int
	ScoreB       int
	Contributors []Contribution
}

// Side identifies which of the two guilds a contribution belongs to.
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
