// Package infra holds the Postgres adapter and Judge0 stub for the guild
// domain. Keep it framework-free on the inbound edges — only Postgres drivers
// and sqlc-generated code live here.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"druz9/guild/domain"
	guilddb "druz9/guild/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.GuildRepo and domain.WarRepo via sqlc.
//
// NOTE: the migration has no `guild_war_contributions` table — contributions
// are persisted in-memory below and replayed until the table ships. This is
// fine for MVP because the score aggregation uses the JSONB on guild_wars.
type Postgres struct {
	pool *pgxpool.Pool
	q    *guilddb.Queries

	// STUB: in-memory contribution log keyed by war_id → slice. Replaced once
	// migration introduces war_contributions.
	contribMu sync.RWMutex
	contribs  map[uuid.UUID][]domain.Contribution
}

// NewPostgres wires a Postgres adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{
		pool:     pool,
		q:        guilddb.New(pool),
		contribs: make(map[uuid.UUID][]domain.Contribution),
	}
}

// ── GuildRepo ─────────────────────────────────────────────────────────────

// UpsertGuild inserts or updates a guild row.
func (p *Postgres) UpsertGuild(ctx context.Context, g domain.Guild) (domain.Guild, error) {
	row, err := p.q.UpsertGuild(ctx, guilddb.UpsertGuildParams{
		OwnerID:  pgUUID(g.OwnerID),
		Name:     g.Name,
		Emblem:   pgText(g.Emblem),
		GuildElo: int32(g.GuildElo),
	})
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.pg.UpsertGuild: %w", err)
	}
	return upsertRowToGuild(row), nil
}

// GetGuild loads a guild by id.
func (p *Postgres) GetGuild(ctx context.Context, id uuid.UUID) (domain.Guild, error) {
	row, err := p.q.GetGuild(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Guild{}, domain.ErrNotFound
		}
		return domain.Guild{}, fmt.Errorf("guild.pg.GetGuild: %w", err)
	}
	return getRowToGuild(row), nil
}

// GetMyGuild resolves the guild the user is a member of.
func (p *Postgres) GetMyGuild(ctx context.Context, userID uuid.UUID) (domain.Guild, error) {
	row, err := p.q.GetMyGuild(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Guild{}, domain.ErrNotFound
		}
		return domain.Guild{}, fmt.Errorf("guild.pg.GetMyGuild: %w", err)
	}
	return myRowToGuild(row), nil
}

// ListGuildMembers returns every member of a guild.
func (p *Postgres) ListGuildMembers(ctx context.Context, guildID uuid.UUID) ([]domain.Member, error) {
	rows, err := p.q.ListGuildMembers(ctx, pgUUID(guildID))
	if err != nil {
		return nil, fmt.Errorf("guild.pg.ListGuildMembers: %w", err)
	}
	out := make([]domain.Member, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.Member{
			GuildID:         fromPgUUID(r.GuildID),
			UserID:          fromPgUUID(r.UserID),
			Username:        r.Username,
			Role:            r.Role,
			AssignedSection: sectionFromPgText(r.AssignedSection),
			JoinedAt:        r.JoinedAt.Time,
		})
	}
	return out, nil
}

// listTopGuildsSQL is hand-written rather than going through sqlc because the
// query is read-only and `make gen-sqlc` is part of CI; keeping the literal
// here avoids forcing a codegen run for a single new SELECT. The shape lines
// up exactly with `name: ListTopGuilds :many` in queries/guild.sql so a
// future sqlc bump can drop this in favour of the generated method.
const listTopGuildsSQL = `
SELECT g.id,
       g.name,
       g.emblem,
       g.guild_elo,
       (SELECT COUNT(*)::int FROM guild_members gm WHERE gm.guild_id = g.id)        AS members_count,
       (SELECT COUNT(*)::int FROM guild_wars gw   WHERE gw.winner_id = g.id)        AS wars_won
  FROM guilds g
 ORDER BY g.guild_elo DESC, g.id ASC
 LIMIT $1
`

// ListTopGuilds returns the global guild leaderboard ordered by guild_elo.
// Limit is clamped to [1, MaxTopGuildsLimit]; non-positive becomes the
// domain default. Empty result → empty slice + nil err.
func (p *Postgres) ListTopGuilds(ctx context.Context, limit int) ([]domain.TopGuildSummary, error) {
	if limit <= 0 {
		limit = domain.DefaultTopGuildsLimit
	}
	if limit > domain.MaxTopGuildsLimit {
		limit = domain.MaxTopGuildsLimit
	}
	rows, err := p.pool.Query(ctx, listTopGuildsSQL, int32(limit))
	if err != nil {
		return nil, fmt.Errorf("guild.pg.ListTopGuilds: %w", err)
	}
	defer rows.Close()
	out := make([]domain.TopGuildSummary, 0, limit)
	rank := 0
	for rows.Next() {
		rank++
		var (
			id           pgtype.UUID
			name         string
			emblem       pgtype.Text
			guildElo     int32
			membersCount int32
			warsWon      int32
		)
		if scanErr := rows.Scan(&id, &name, &emblem, &guildElo, &membersCount, &warsWon); scanErr != nil {
			return nil, fmt.Errorf("guild.pg.ListTopGuilds: scan: %w", scanErr)
		}
		s := domain.TopGuildSummary{
			GuildID:      fromPgUUID(id),
			Name:         name,
			MembersCount: int(membersCount),
			EloTotal:     int(guildElo),
			WarsWon:      int(warsWon),
			Rank:         rank,
		}
		if emblem.Valid {
			s.Emblem = emblem.String
		}
		out = append(out, s)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("guild.pg.ListTopGuilds: rows: %w", rerr)
	}
	return out, nil
}

// GetMember returns a single membership row.
func (p *Postgres) GetMember(ctx context.Context, guildID, userID uuid.UUID) (domain.Member, error) {
	row, err := p.q.GetGuildMember(ctx, guilddb.GetGuildMemberParams{
		GuildID: pgUUID(guildID),
		UserID:  pgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Member{}, domain.ErrNotMember
		}
		return domain.Member{}, fmt.Errorf("guild.pg.GetMember: %w", err)
	}
	return domain.Member{
		GuildID:         fromPgUUID(row.GuildID),
		UserID:          fromPgUUID(row.UserID),
		Username:        row.Username,
		Role:            row.Role,
		AssignedSection: sectionFromPgText(row.AssignedSection),
		JoinedAt:        row.JoinedAt.Time,
	}, nil
}

// ── WarRepo ───────────────────────────────────────────────────────────────

// GetCurrentWarForGuild returns the war covering `now` for the guild.
func (p *Postgres) GetCurrentWarForGuild(ctx context.Context, guildID uuid.UUID, now time.Time) (domain.War, error) {
	row, err := p.q.GetCurrentWarForGuild(ctx, guilddb.GetCurrentWarForGuildParams{
		GuildAID: pgUUID(guildID),
		Column2:  pgtype.Date{Time: now.UTC(), Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.War{}, domain.ErrNotFound
		}
		return domain.War{}, fmt.Errorf("guild.pg.GetCurrentWarForGuild: %w", err)
	}
	return warFromRow(row)
}

// GetWar loads a war by id.
func (p *Postgres) GetWar(ctx context.Context, warID uuid.UUID) (domain.War, error) {
	row, err := p.q.GetWar(ctx, pgUUID(warID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.War{}, domain.ErrNotFound
		}
		return domain.War{}, fmt.Errorf("guild.pg.GetWar: %w", err)
	}
	return warFromRow(row)
}

// UpsertWarScore adds `delta` onto the (war, section, side) score in the
// JSONB map. Uses two sqlc entry points — one per side — because sqlc cannot
// parametrise a column name.
func (p *Postgres) UpsertWarScore(ctx context.Context, warID uuid.UUID, section enums.Section, side domain.Side, delta int) error {
	if !section.IsValid() {
		return domain.ErrInvalidSection
	}
	var (
		affected int64
		err      error
	)
	switch side {
	case domain.SideA:
		affected, err = p.q.UpsertWarScoreA(ctx, guilddb.UpsertWarScoreAParams{
			ID:      pgUUID(warID),
			Column2: string(section),
			Column3: int32(delta),
		})
	case domain.SideB:
		affected, err = p.q.UpsertWarScoreB(ctx, guilddb.UpsertWarScoreBParams{
			ID:      pgUUID(warID),
			Column2: string(section),
			Column3: int32(delta),
		})
	default:
		return fmt.Errorf("guild.pg.UpsertWarScore: invalid side %q", side)
	}
	if err != nil {
		return fmt.Errorf("guild.pg.UpsertWarScore: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("guild.pg.UpsertWarScore: %w", domain.ErrNotFound)
	}
	return nil
}

// InsertContribution stores the contribution in the in-memory log. STUB.
func (p *Postgres) InsertContribution(ctx context.Context, c domain.Contribution) error {
	p.contribMu.Lock()
	defer p.contribMu.Unlock()
	p.contribs[c.WarID] = append(p.contribs[c.WarID], c)
	return nil
}

// ListContributions returns contributions for a war, newest first. STUB.
func (p *Postgres) ListContributions(ctx context.Context, warID uuid.UUID) ([]domain.Contribution, error) {
	p.contribMu.RLock()
	defer p.contribMu.RUnlock()
	src := p.contribs[warID]
	out := make([]domain.Contribution, len(src))
	// reverse so newest-first ordering is presented
	for i, c := range src {
		out[len(src)-1-i] = c
	}
	return out, nil
}

// SetWinner marks a war finished with the given winner (nil = draw).
func (p *Postgres) SetWinner(ctx context.Context, warID uuid.UUID, winner *uuid.UUID) error {
	var wid pgtype.UUID
	if winner != nil {
		wid = pgUUID(*winner)
	}
	affected, err := p.q.SetWarWinner(ctx, guilddb.SetWarWinnerParams{
		ID:       pgUUID(warID),
		WinnerID: wid,
	})
	if err != nil {
		return fmt.Errorf("guild.pg.SetWinner: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("guild.pg.SetWinner: %w", domain.ErrNotFound)
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func sectionFromPgText(t pgtype.Text) *enums.Section {
	if !t.Valid {
		return nil
	}
	s := enums.Section(t.String)
	return &s
}

// upsertRowToGuild / getRowToGuild / myRowToGuild — bridges introduced after
// sqlc moved UpsertGuild/GetGuild/GetMyGuild to subset row types (they
// SELECT/RETURN only the 6 base columns, while guilddb.Guild now has the
// extras from migration 00018: description, tier, is_public, join_policy,
// max_members). Those fields stay zero on these read paths until the SQL
// is widened — which is fine for write-then-read flows that immediately
// hit GetGuild via the cache wrapper.
func upsertRowToGuild(r guilddb.UpsertGuildRow) domain.Guild {
	g := domain.Guild{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		GuildElo:  int(r.GuildElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func getRowToGuild(r guilddb.GetGuildRow) domain.Guild {
	g := domain.Guild{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		GuildElo:  int(r.GuildElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func myRowToGuild(r guilddb.GetMyGuildRow) domain.Guild {
	g := domain.Guild{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		GuildElo:  int(r.GuildElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func warFromRow(r guilddb.GuildWar) (domain.War, error) {
	w := domain.War{
		ID:        fromPgUUID(r.ID),
		GuildAID:  fromPgUUID(r.GuildAID),
		GuildBID:  fromPgUUID(r.GuildBID),
		WeekStart: r.WeekStart.Time,
		WeekEnd:   r.WeekEnd.Time,
		CreatedAt: r.CreatedAt.Time,
	}
	if r.WinnerID.Valid {
		id := fromPgUUID(r.WinnerID)
		w.WinnerID = &id
	}
	scoresA, err := unmarshalScores(r.ScoresA)
	if err != nil {
		return domain.War{}, fmt.Errorf("guild.pg.warFromRow: scores_a: %w", err)
	}
	scoresB, err := unmarshalScores(r.ScoresB)
	if err != nil {
		return domain.War{}, fmt.Errorf("guild.pg.warFromRow: scores_b: %w", err)
	}
	w.ScoresA = scoresA
	w.ScoresB = scoresB
	return w, nil
}

// unmarshalScores decodes the JSONB score map into section→int. Missing keys
// are treated as zero. Accepts either an empty object or a populated one.
func unmarshalScores(raw []byte) (map[enums.Section]int, error) {
	out := make(map[enums.Section]int, domain.WarLineCount)
	if len(raw) == 0 {
		return out, nil
	}
	var m map[string]int
	if err := json.Unmarshal(raw, &m); err != nil {
		// Allow the case of a raw `{}` or a map with int-ish string values.
		return out, fmt.Errorf("unmarshal: %w", err)
	}
	for k, v := range m {
		out[enums.Section(k)] = v
	}
	return out, nil
}

// Interface guards.
var (
	_ domain.GuildRepo = (*Postgres)(nil)
	_ domain.WarRepo   = (*Postgres)(nil)
)
