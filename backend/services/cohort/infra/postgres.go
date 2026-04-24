// Package infra holds the Postgres adapter and Judge0 stub for the cohort
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

	"druz9/cohort/domain"
	cohortdb "druz9/cohort/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.CohortRepo and domain.WarRepo via sqlc.
//
// NOTE: the migration has no `cohort_war_contributions` table — contributions
// are persisted in-memory below and replayed until the table ships. This is
// fine for MVP because the score aggregation uses the JSONB on cohort_wars.
type Postgres struct {
	pool *pgxpool.Pool
	q    *cohortdb.Queries

	// STUB: in-memory contribution log keyed by war_id → slice. Replaced once
	// migration introduces war_contributions.
	contribMu sync.RWMutex
	contribs  map[uuid.UUID][]domain.Contribution
}

// NewPostgres wires a Postgres adapter.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{
		pool:     pool,
		q:        cohortdb.New(pool),
		contribs: make(map[uuid.UUID][]domain.Contribution),
	}
}

// ── CohortRepo ─────────────────────────────────────────────────────────────

// UpsertCohort inserts or updates a cohort row.
func (p *Postgres) UpsertCohort(ctx context.Context, g domain.Cohort) (domain.Cohort, error) {
	row, err := p.q.UpsertCohort(ctx, cohortdb.UpsertCohortParams{
		OwnerID:   pgUUID(g.OwnerID),
		Name:      g.Name,
		Emblem:    pgText(g.Emblem),
		CohortElo: int32(g.CohortElo),
	})
	if err != nil {
		return domain.Cohort{}, fmt.Errorf("cohort.pg.UpsertCohort: %w", err)
	}
	return upsertRowToCohort(row), nil
}

// GetCohort loads a cohort by id.
func (p *Postgres) GetCohort(ctx context.Context, id uuid.UUID) (domain.Cohort, error) {
	row, err := p.q.GetCohort(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Cohort{}, domain.ErrNotFound
		}
		return domain.Cohort{}, fmt.Errorf("cohort.pg.GetCohort: %w", err)
	}
	return getRowToCohort(row), nil
}

// GetMyCohort resolves the cohort the user is a member of.
func (p *Postgres) GetMyCohort(ctx context.Context, userID uuid.UUID) (domain.Cohort, error) {
	row, err := p.q.GetMyCohort(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Cohort{}, domain.ErrNotFound
		}
		return domain.Cohort{}, fmt.Errorf("cohort.pg.GetMyCohort: %w", err)
	}
	return myRowToCohort(row), nil
}

// ListCohortMembers returns every member of a cohort.
func (p *Postgres) ListCohortMembers(ctx context.Context, cohortID uuid.UUID) ([]domain.Member, error) {
	rows, err := p.q.ListCohortMembers(ctx, pgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.pg.ListCohortMembers: %w", err)
	}
	out := make([]domain.Member, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.Member{
			CohortID:        fromPgUUID(r.CohortID),
			UserID:          fromPgUUID(r.UserID),
			Username:        r.Username,
			Role:            r.Role,
			AssignedSection: sectionFromPgText(r.AssignedSection),
			JoinedAt:        r.JoinedAt.Time,
		})
	}
	return out, nil
}

// listTopCohortsSQL is hand-written rather than going through sqlc because the
// query is read-only and `make gen-sqlc` is part of CI; keeping the literal
// here avoids forcing a codegen run for a single new SELECT. The shape lines
// up exactly with `name: ListTopCohorts :many` in queries/cohort.sql so a
// future sqlc bump can drop this in favour of the generated method.
const listTopCohortsSQL = `
SELECT g.id,
       g.name,
       g.emblem,
       g.cohort_elo,
       (SELECT COUNT(*)::int FROM cohort_members gm WHERE gm.cohort_id = g.id)        AS members_count,
       (SELECT COUNT(*)::int FROM cohort_wars gw   WHERE gw.winner_id = g.id)        AS wars_won
  FROM cohorts g
 ORDER BY g.cohort_elo DESC, g.id ASC
 LIMIT $1
`

// ListTopCohorts returns the global cohort leaderboard ordered by cohort_elo.
// Limit is clamped to [1, MaxTopCohortsLimit]; non-positive becomes the
// domain default. Empty result → empty slice + nil err.
func (p *Postgres) ListTopCohorts(ctx context.Context, limit int) ([]domain.TopCohortSummary, error) {
	if limit <= 0 {
		limit = domain.DefaultTopCohortsLimit
	}
	if limit > domain.MaxTopCohortsLimit {
		limit = domain.MaxTopCohortsLimit
	}
	rows, err := p.pool.Query(ctx, listTopCohortsSQL, int32(limit))
	if err != nil {
		return nil, fmt.Errorf("cohort.pg.ListTopCohorts: %w", err)
	}
	defer rows.Close()
	out := make([]domain.TopCohortSummary, 0, limit)
	rank := 0
	for rows.Next() {
		rank++
		var (
			id           pgtype.UUID
			name         string
			emblem       pgtype.Text
			cohortElo    int32
			membersCount int32
			warsWon      int32
		)
		if scanErr := rows.Scan(&id, &name, &emblem, &cohortElo, &membersCount, &warsWon); scanErr != nil {
			return nil, fmt.Errorf("cohort.pg.ListTopCohorts: scan: %w", scanErr)
		}
		s := domain.TopCohortSummary{
			CohortID:     fromPgUUID(id),
			Name:         name,
			MembersCount: int(membersCount),
			EloTotal:     int(cohortElo),
			WarsWon:      int(warsWon),
			Rank:         rank,
		}
		if emblem.Valid {
			s.Emblem = emblem.String
		}
		out = append(out, s)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("cohort.pg.ListTopCohorts: rows: %w", rerr)
	}
	return out, nil
}

// GetMember returns a single membership row.
func (p *Postgres) GetMember(ctx context.Context, cohortID, userID uuid.UUID) (domain.Member, error) {
	row, err := p.q.GetCohortMember(ctx, cohortdb.GetCohortMemberParams{
		CohortID: pgUUID(cohortID),
		UserID:   pgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Member{}, domain.ErrNotMember
		}
		return domain.Member{}, fmt.Errorf("cohort.pg.GetMember: %w", err)
	}
	return domain.Member{
		CohortID:        fromPgUUID(row.CohortID),
		UserID:          fromPgUUID(row.UserID),
		Username:        row.Username,
		Role:            row.Role,
		AssignedSection: sectionFromPgText(row.AssignedSection),
		JoinedAt:        row.JoinedAt.Time,
	}, nil
}

// ── WarRepo ───────────────────────────────────────────────────────────────

// GetCurrentWarForCohort returns the war covering `now` for the cohort.
func (p *Postgres) GetCurrentWarForCohort(ctx context.Context, cohortID uuid.UUID, now time.Time) (domain.War, error) {
	row, err := p.q.GetCurrentWarForCohort(ctx, cohortdb.GetCurrentWarForCohortParams{
		CohortAID: pgUUID(cohortID),
		Column2:   pgtype.Date{Time: now.UTC(), Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.War{}, domain.ErrNotFound
		}
		return domain.War{}, fmt.Errorf("cohort.pg.GetCurrentWarForCohort: %w", err)
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
		return domain.War{}, fmt.Errorf("cohort.pg.GetWar: %w", err)
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
		affected, err = p.q.UpsertWarScoreA(ctx, cohortdb.UpsertWarScoreAParams{
			ID:      pgUUID(warID),
			Column2: string(section),
			Column3: int32(delta),
		})
	case domain.SideB:
		affected, err = p.q.UpsertWarScoreB(ctx, cohortdb.UpsertWarScoreBParams{
			ID:      pgUUID(warID),
			Column2: string(section),
			Column3: int32(delta),
		})
	default:
		return fmt.Errorf("cohort.pg.UpsertWarScore: invalid side %q", side)
	}
	if err != nil {
		return fmt.Errorf("cohort.pg.UpsertWarScore: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("cohort.pg.UpsertWarScore: %w", domain.ErrNotFound)
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
	affected, err := p.q.SetWarWinner(ctx, cohortdb.SetWarWinnerParams{
		ID:       pgUUID(warID),
		WinnerID: wid,
	})
	if err != nil {
		return fmt.Errorf("cohort.pg.SetWinner: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("cohort.pg.SetWinner: %w", domain.ErrNotFound)
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

// upsertRowToCohort / getRowToCohort / myRowToCohort — bridges introduced after
// sqlc moved UpsertCohort/GetCohort/GetMyCohort to subset row types (they
// SELECT/RETURN only the 6 base columns, while cohortdb.Cohort now has the
// extras from migration 00018: description, tier, is_public, join_policy,
// max_members). Those fields stay zero on these read paths until the SQL
// is widened — which is fine for write-then-read flows that immediately
// hit GetCohort via the cache wrapper.
func upsertRowToCohort(r cohortdb.UpsertCohortRow) domain.Cohort {
	g := domain.Cohort{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		CohortElo: int(r.CohortElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func getRowToCohort(r cohortdb.GetCohortRow) domain.Cohort {
	g := domain.Cohort{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		CohortElo: int(r.CohortElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func myRowToCohort(r cohortdb.GetMyCohortRow) domain.Cohort {
	g := domain.Cohort{
		ID:        fromPgUUID(r.ID),
		OwnerID:   fromPgUUID(r.OwnerID),
		Name:      r.Name,
		CohortElo: int(r.CohortElo),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.Emblem.Valid {
		g.Emblem = r.Emblem.String
	}
	return g
}

func warFromRow(r cohortdb.CohortWar) (domain.War, error) {
	w := domain.War{
		ID:        fromPgUUID(r.ID),
		CohortAID: fromPgUUID(r.CohortAID),
		CohortBID: fromPgUUID(r.CohortBID),
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
		return domain.War{}, fmt.Errorf("cohort.pg.warFromRow: scores_a: %w", err)
	}
	scoresB, err := unmarshalScores(r.ScoresB)
	if err != nil {
		return domain.War{}, fmt.Errorf("cohort.pg.warFromRow: scores_b: %w", err)
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
	_ domain.CohortRepo = (*Postgres)(nil)
	_ domain.WarRepo    = (*Postgres)(nil)
)
