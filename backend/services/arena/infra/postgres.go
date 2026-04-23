// Package infra holds Postgres, Redis and Judge0 adapters for the arena domain.
package infra

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"druz9/arena/domain"
	arenadb "druz9/arena/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.MatchRepo and domain.TaskRepo via sqlc.
type Postgres struct {
	pool *pgxpool.Pool
	q    *arenadb.Queries
}

// NewPostgres wires a Postgres adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: arenadb.New(pool)}
}

// CreateMatch atomically inserts an arena_matches row + all participant rows.
func (p *Postgres) CreateMatch(ctx context.Context, m domain.Match, parts []domain.Participant) (domain.Match, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.Match{}, fmt.Errorf("arena.pg.CreateMatch: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := p.q.WithTx(tx)

	var startedAt pgtype.Timestamptz
	if m.StartedAt != nil {
		startedAt = pgtype.Timestamptz{Time: *m.StartedAt, Valid: true}
	}
	row, err := qtx.CreateArenaMatch(ctx, arenadb.CreateArenaMatchParams{
		TaskID:      pgUUID(m.TaskID),
		TaskVersion: int32(m.TaskVersion),
		Section:     string(m.Section),
		Mode:        string(m.Mode),
		Status:      string(m.Status),
		StartedAt:   startedAt,
	})
	if err != nil {
		return domain.Match{}, fmt.Errorf("arena.pg.CreateMatch: insert: %w", err)
	}
	for _, part := range parts {
		if err := qtx.InsertArenaParticipant(ctx, arenadb.InsertArenaParticipantParams{
			MatchID:   row.ID,
			UserID:    pgUUID(part.UserID),
			Team:      int32(part.Team),
			EloBefore: int32(part.EloBefore),
		}); err != nil {
			return domain.Match{}, fmt.Errorf("arena.pg.CreateMatch: participant: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.Match{}, fmt.Errorf("arena.pg.CreateMatch: commit: %w", err)
	}
	return matchFromRow(createRowToArenaMatch(row)), nil
}

// Get returns the match by id.
func (p *Postgres) Get(ctx context.Context, id uuid.UUID) (domain.Match, error) {
	row, err := p.q.GetArenaMatch(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Match{}, domain.ErrNotFound
		}
		return domain.Match{}, fmt.Errorf("arena.pg.Get: %w", err)
	}
	return matchFromRow(getRowToArenaMatch(row)), nil
}

// ListParticipants returns participants ordered by team.
func (p *Postgres) ListParticipants(ctx context.Context, matchID uuid.UUID) ([]domain.Participant, error) {
	rows, err := p.q.ListArenaParticipants(ctx, pgUUID(matchID))
	if err != nil {
		return nil, fmt.Errorf("arena.pg.ListParticipants: %w", err)
	}
	out := make([]domain.Participant, 0, len(rows))
	for _, r := range rows {
		out = append(out, participantFromRow(r))
	}
	return out, nil
}

// UpdateStatus transitions status and optionally stamps the timestamps.
func (p *Postgres) UpdateStatus(ctx context.Context, id uuid.UUID, status enums.MatchStatus, startedAt, finishedAt *time.Time) error {
	if !status.IsValid() {
		return fmt.Errorf("arena.pg.UpdateStatus: invalid status %q", status)
	}
	var sa pgtype.Timestamptz
	if startedAt != nil {
		sa = pgtype.Timestamptz{Time: *startedAt, Valid: true}
	}
	var fa pgtype.Timestamptz
	if finishedAt != nil {
		fa = pgtype.Timestamptz{Time: *finishedAt, Valid: true}
	}
	affected, err := p.q.UpdateArenaMatchStatus(ctx, arenadb.UpdateArenaMatchStatusParams{
		ID:         pgUUID(id),
		Status:     string(status),
		StartedAt:  sa,
		FinishedAt: fa,
	})
	if err != nil {
		return fmt.Errorf("arena.pg.UpdateStatus: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("arena.pg.UpdateStatus: %w", domain.ErrNotFound)
	}
	return nil
}

// SetWinner records the winner and finishes the match.
func (p *Postgres) SetWinner(ctx context.Context, id uuid.UUID, winner uuid.UUID, finishedAt time.Time) error {
	affected, err := p.q.SetArenaMatchWinner(ctx, arenadb.SetArenaMatchWinnerParams{
		ID:         pgUUID(id),
		WinnerID:   pgUUID(winner),
		FinishedAt: pgtype.Timestamptz{Time: finishedAt, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("arena.pg.SetWinner: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("arena.pg.SetWinner: %w", domain.ErrNotFound)
	}
	return nil
}

// SetWinningTeam finalises a 2v2 match. winner_id stays NULL — clients
// distinguish 1v1 vs 2v2 by reading winning_team_id.
func (p *Postgres) SetWinningTeam(ctx context.Context, id uuid.UUID, team int, finishedAt time.Time) error {
	if team != domain.Team1 && team != domain.Team2 {
		return fmt.Errorf("arena.pg.SetWinningTeam: invalid team %d", team)
	}
	affected, err := p.q.SetArenaMatchWinningTeam(ctx, arenadb.SetArenaMatchWinningTeamParams{
		ID:            pgUUID(id),
		WinningTeamID: pgtype.Int2{Int16: int16(team), Valid: true},
		FinishedAt:    pgtype.Timestamptz{Time: finishedAt, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("arena.pg.SetWinningTeam: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("arena.pg.SetWinningTeam: %w", domain.ErrNotFound)
	}
	return nil
}

// SetTask stamps the selected task onto the match.
func (p *Postgres) SetTask(ctx context.Context, id uuid.UUID, taskID uuid.UUID, taskVersion int) error {
	affected, err := p.q.SetArenaMatchTask(ctx, arenadb.SetArenaMatchTaskParams{
		ID:          pgUUID(id),
		TaskID:      pgUUID(taskID),
		TaskVersion: int32(taskVersion),
	})
	if err != nil {
		return fmt.Errorf("arena.pg.SetTask: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("arena.pg.SetTask: %w", domain.ErrNotFound)
	}
	return nil
}

// UpsertParticipantResult writes the solver's outcome.
func (p *Postgres) UpsertParticipantResult(ctx context.Context, part domain.Participant) error {
	var solve pgtype.Int8
	if part.SolveTimeMs != nil {
		solve = pgtype.Int8{Int64: *part.SolveTimeMs, Valid: true}
	}
	var susp pgtype.Numeric
	if part.SuspicionScore != nil {
		n := new(big.Int).SetInt64(int64(*part.SuspicionScore * 100))
		susp = pgtype.Numeric{Int: n, Exp: -2, Valid: true}
	}
	var submitted pgtype.Timestamptz
	if part.SubmittedAt != nil {
		submitted = pgtype.Timestamptz{Time: *part.SubmittedAt, Valid: true}
	}
	affected, err := p.q.UpsertParticipantResult(ctx, arenadb.UpsertParticipantResultParams{
		MatchID:        pgUUID(part.MatchID),
		UserID:         pgUUID(part.UserID),
		SolveTimeMs:    solve,
		SuspicionScore: susp,
		SubmittedAt:    submitted,
	})
	if err != nil {
		return fmt.Errorf("arena.pg.UpsertParticipantResult: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("arena.pg.UpsertParticipantResult: %w", domain.ErrNotFound)
	}
	return nil
}

// ListByUser returns one paginated page of finished/cancelled matches for
// userID and the unfiltered total count under the same filter. The query
// joins arena_participants twice — once to get the caller's row (for the
// LP delta), once to find the opponent (1v1 only for now; for 2v2 the
// "first other" is returned, which the frontend treats as the opposing
// captain). avatar_url is empty until profiles.media lands.
func (p *Postgres) ListByUser(
	ctx context.Context,
	userID uuid.UUID,
	limit, offset int,
	modeFilter enums.ArenaMode,
	sectionFilter enums.Section,
) ([]domain.MatchHistoryEntry, int, error) {
	rows, err := p.q.ListMyMatches(ctx, arenadb.ListMyMatchesParams{
		UserID:    pgUUID(userID),
		Mode:      string(modeFilter),
		Section:   string(sectionFilter),
		LimitVal:  int32(limit),
		OffsetVal: int32(offset),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("arena.pg.ListByUser: %w", err)
	}
	totalRaw, err := p.q.CountMyMatches(ctx, arenadb.CountMyMatchesParams{
		UserID:  pgUUID(userID),
		Mode:    string(modeFilter),
		Section: string(sectionFilter),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("arena.pg.ListByUser: count: %w", err)
	}
	out := make([]domain.MatchHistoryEntry, 0, len(rows))
	for _, r := range rows {
		var winner *uuid.UUID
		if r.WinnerID.Valid {
			w := fromPgUUID(r.WinnerID)
			winner = &w
		}
		entry := domain.MatchHistoryEntry{
			MatchID: fromPgUUID(r.MatchID),
			Mode:    enums.ArenaMode(r.Mode),
			Section: enums.Section(r.Section),
			Result:  domain.ResultFor(userID, winner, enums.MatchStatus(r.Status)),
		}
		if r.FinishedAt.Valid {
			entry.FinishedAt = r.FinishedAt.Time.UTC()
		}
		if r.OpponentUserID.Valid {
			entry.OpponentUserID = fromPgUUID(r.OpponentUserID)
		}
		if r.OpponentUsername.Valid {
			entry.OpponentUsername = r.OpponentUsername.String
		}
		if r.OpponentAvatarUrl.Valid {
			entry.OpponentAvatarURL = r.OpponentAvatarUrl.String
		}
		// LP delta — elo_after - elo_before; falls back to 0 if the rating
		// domain hasn't yet settled the result on this row.
		if r.MeEloAfter.Valid {
			entry.LPChange = int(r.MeEloAfter.Int32) - int(r.MeEloBefore)
		}
		// Duration — finished_at - started_at, in whole seconds. Negative
		// values are clamped to zero (clock skew).
		if r.StartedAt.Valid && r.FinishedAt.Valid {
			d := int(r.FinishedAt.Time.Sub(r.StartedAt.Time).Seconds())
			if d < 0 {
				d = 0
			}
			entry.DurationSeconds = d
		}
		out = append(out, entry)
	}
	return out, int(totalRaw), nil
}

// PickBySectionDifficulty returns a single active task for the given section+difficulty.
// solution_hint is never selected.
func (p *Postgres) PickBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) (domain.TaskPublic, error) {
	if !section.IsValid() || !diff.IsValid() {
		return domain.TaskPublic{}, fmt.Errorf("arena.pg.PickBySectionDifficulty: invalid enums")
	}
	row, err := p.q.PickActiveTaskBySectionDifficulty(ctx, arenadb.PickActiveTaskBySectionDifficultyParams{
		Section:    string(section),
		Difficulty: string(diff),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskPublic{}, domain.ErrNotFound
		}
		return domain.TaskPublic{}, fmt.Errorf("arena.pg.PickBySectionDifficulty: %w", err)
	}
	return domain.TaskPublic{
		ID:            fromPgUUID(row.ID),
		Version:       int(row.Version),
		Slug:          row.Slug,
		Title:         row.TitleRu,
		Description:   row.DescriptionRu,
		Difficulty:    enums.Difficulty(row.Difficulty),
		Section:       enums.Section(row.Section),
		TimeLimitSec:  int(row.TimeLimitSec),
		MemoryLimitMB: int(row.MemoryLimitMb),
		StarterCode:   map[string]string{},
	}, nil
}

// GetByID fetches a task by id, solution_hint excluded.
func (p *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.TaskPublic, error) {
	row, err := p.q.GetArenaTaskPublic(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskPublic{}, domain.ErrNotFound
		}
		return domain.TaskPublic{}, fmt.Errorf("arena.pg.GetByID: %w", err)
	}
	return domain.TaskPublic{
		ID:            fromPgUUID(row.ID),
		Version:       int(row.Version),
		Slug:          row.Slug,
		Title:         row.TitleRu,
		Description:   row.DescriptionRu,
		Difficulty:    enums.Difficulty(row.Difficulty),
		Section:       enums.Section(row.Section),
		TimeLimitSec:  int(row.TimeLimitSec),
		MemoryLimitMB: int(row.MemoryLimitMb),
		StarterCode:   map[string]string{},
	}, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

// createRowToArenaMatch / getRowToArenaMatch — мостики после того, как sqlc
// перешёл на subset-row-типы для CreateArenaMatch/GetArenaMatch (потому что
// SELECT/RETURNING не включают winning_team_id). matchFromRow продолжает
// принимать полную модель ArenaMatch — а здесь мы заполняем общие 10 полей,
// оставляя WinningTeamID нулевым (для 1v1-матчей он в любом случае NULL).
func createRowToArenaMatch(r arenadb.CreateArenaMatchRow) arenadb.ArenaMatch {
	return arenadb.ArenaMatch{
		ID: r.ID, TaskID: r.TaskID, TaskVersion: r.TaskVersion,
		Section: r.Section, Mode: r.Mode, Status: r.Status,
		WinnerID: r.WinnerID, StartedAt: r.StartedAt,
		FinishedAt: r.FinishedAt, CreatedAt: r.CreatedAt,
	}
}

func getRowToArenaMatch(r arenadb.GetArenaMatchRow) arenadb.ArenaMatch {
	return arenadb.ArenaMatch{
		ID: r.ID, TaskID: r.TaskID, TaskVersion: r.TaskVersion,
		Section: r.Section, Mode: r.Mode, Status: r.Status,
		WinnerID: r.WinnerID, StartedAt: r.StartedAt,
		FinishedAt: r.FinishedAt, CreatedAt: r.CreatedAt,
	}
}

func matchFromRow(r arenadb.ArenaMatch) domain.Match {
	m := domain.Match{
		ID:          fromPgUUID(r.ID),
		TaskID:      fromPgUUID(r.TaskID),
		TaskVersion: int(r.TaskVersion),
		Section:     enums.Section(r.Section),
		Mode:        enums.ArenaMode(r.Mode),
		Status:      enums.MatchStatus(r.Status),
		CreatedAt:   r.CreatedAt.Time,
	}
	if r.WinnerID.Valid {
		w := fromPgUUID(r.WinnerID)
		m.WinnerID = &w
	}
	if r.StartedAt.Valid {
		t := r.StartedAt.Time
		m.StartedAt = &t
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		m.FinishedAt = &t
	}
	return m
}

func participantFromRow(r arenadb.ArenaParticipant) domain.Participant {
	p := domain.Participant{
		MatchID:   fromPgUUID(r.MatchID),
		UserID:    fromPgUUID(r.UserID),
		Team:      int(r.Team),
		EloBefore: int(r.EloBefore),
	}
	if r.EloAfter.Valid {
		v := int(r.EloAfter.Int32)
		p.EloAfter = &v
	}
	if r.SolveTimeMs.Valid {
		v := r.SolveTimeMs.Int64
		p.SolveTimeMs = &v
	}
	if r.SuspicionScore.Valid && r.SuspicionScore.Int != nil {
		// Convert fixed-point numeric to float64.
		f, _ := new(big.Float).SetInt(r.SuspicionScore.Int).Float64()
		// Adjust for exponent.
		for i := int32(0); i < -r.SuspicionScore.Exp; i++ {
			f /= 10
		}
		for i := int32(0); i < r.SuspicionScore.Exp; i++ {
			f *= 10
		}
		p.SuspicionScore = &f
	}
	if r.SubmittedAt.Valid {
		t := r.SubmittedAt.Time
		p.SubmittedAt = &t
	}
	return p
}

// Interface guards.
var (
	_ domain.MatchRepo = (*Postgres)(nil)
	_ domain.TaskRepo  = (*Postgres)(nil)
)
