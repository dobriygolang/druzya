//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// GuildRepo persists `guilds` and `guild_members`.
type GuildRepo interface {
	// UpsertGuild inserts or updates a guild row.
	UpsertGuild(ctx context.Context, g Guild) (Guild, error)

	// GetGuild loads a guild by id without members hydrated.
	GetGuild(ctx context.Context, id uuid.UUID) (Guild, error)

	// GetMyGuild resolves the guild the given user belongs to. Returns
	// ErrNotFound if the user has no guild membership.
	GetMyGuild(ctx context.Context, userID uuid.UUID) (Guild, error)

	// ListGuildMembers returns every member (joined with users.username).
	ListGuildMembers(ctx context.Context, guildID uuid.UUID) ([]Member, error)

	// GetMember returns a single membership row, or ErrNotFound when missing.
	GetMember(ctx context.Context, guildID, userID uuid.UUID) (Member, error)

	// ListTopGuilds returns the global guild leaderboard ordered by guild_elo
	// descending. The repo layer is responsible for the cap; callers should
	// rely on it rather than re-checking. Empty result set → empty slice +
	// nil error (NOT ErrNotFound — the leaderboard simply has zero rows).
	ListTopGuilds(ctx context.Context, limit int) ([]TopGuildSummary, error)
}

// WarRepo persists `guild_wars` and the per-line JSONB score maps.
type WarRepo interface {
	// GetCurrentWarForGuild returns the war whose [week_start, week_end) covers
	// `now` for either side. Returns ErrNotFound when no such war exists.
	GetCurrentWarForGuild(ctx context.Context, guildID uuid.UUID, now time.Time) (War, error)

	// GetWar loads a war row by its id.
	GetWar(ctx context.Context, warID uuid.UUID) (War, error)

	// UpsertWarScore records a score delta on (war, section, side) atomically.
	// Implementation: jsonb_set on scores_a / scores_b keyed by section.
	UpsertWarScore(ctx context.Context, warID uuid.UUID, section enums.Section, side Side, delta int) error

	// InsertContribution stores a single graded submission row. STUB: MVP keeps
	// contributions in an in-memory map because migration 00005 has no table.
	InsertContribution(ctx context.Context, c Contribution) error

	// ListContributions returns all contributions for a war, ordered newest
	// first. Used to hydrate the WarLine.Contributors list.
	ListContributions(ctx context.Context, warID uuid.UUID) ([]Contribution, error)

	// SetWinner marks the war as finished with the given winner (or nil for a
	// draw). Called by background sweeper at week-end.
	SetWinner(ctx context.Context, warID uuid.UUID, winner *uuid.UUID) error
}

// Judge0Client submits code for grading. Copied verbatim from the arena
// pattern so guild doesn't cross-import the arena module.
//
// STUB: real Judge0 client. Lives in its own package once wired.
type Judge0Client interface {
	Submit(ctx context.Context, code, language string, section enums.Section) (Judge0Result, error)
}

// Judge0Result is the minimal grading outcome the guild cares about.
type Judge0Result struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}
