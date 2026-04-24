// Package infra содержит Postgres-, Redis- и Judge0-адаптеры для arena-домена.
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

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres реализует domain.MatchRepo и domain.TaskRepo через sqlc.
type Postgres struct {
	pool *pgxpool.Pool
	q    *arenadb.Queries
}

// NewPostgres собирает Postgres-адаптер.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: arenadb.New(pool)}
}

// CreateMatch атомарно вставляет строку arena_matches и все строки участников.
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
		TaskID:      sharedpg.UUID(m.TaskID),
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
			UserID:    sharedpg.UUID(part.UserID),
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

// Get возвращает матч по id.
func (p *Postgres) Get(ctx context.Context, id uuid.UUID) (domain.Match, error) {
	row, err := p.q.GetArenaMatch(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Match{}, domain.ErrNotFound
		}
		return domain.Match{}, fmt.Errorf("arena.pg.Get: %w", err)
	}
	return matchFromRow(getRowToArenaMatch(row)), nil
}

// ListParticipants возвращает участников, упорядоченных по команде.
func (p *Postgres) ListParticipants(ctx context.Context, matchID uuid.UUID) ([]domain.Participant, error) {
	rows, err := p.q.ListArenaParticipants(ctx, sharedpg.UUID(matchID))
	if err != nil {
		return nil, fmt.Errorf("arena.pg.ListParticipants: %w", err)
	}
	out := make([]domain.Participant, 0, len(rows))
	for _, r := range rows {
		out = append(out, participantFromRow(r))
	}
	return out, nil
}

// UpdateStatus переводит статус и при необходимости проставляет временные метки.
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
		ID:         sharedpg.UUID(id),
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

// SetWinner фиксирует победителя и завершает матч.
func (p *Postgres) SetWinner(ctx context.Context, id uuid.UUID, winner uuid.UUID, finishedAt time.Time) error {
	affected, err := p.q.SetArenaMatchWinner(ctx, arenadb.SetArenaMatchWinnerParams{
		ID:         sharedpg.UUID(id),
		WinnerID:   sharedpg.UUID(winner),
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

// SetWinningTeam финализирует 2v2-матч. winner_id остаётся NULL — клиенты
// различают 1v1 и 2v2 по winning_team_id.
func (p *Postgres) SetWinningTeam(ctx context.Context, id uuid.UUID, team int, finishedAt time.Time) error {
	if team != domain.Team1 && team != domain.Team2 {
		return fmt.Errorf("arena.pg.SetWinningTeam: invalid team %d", team)
	}
	affected, err := p.q.SetArenaMatchWinningTeam(ctx, arenadb.SetArenaMatchWinningTeamParams{
		ID:            sharedpg.UUID(id),
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

// SetTask проставляет выбранный task на матч.
func (p *Postgres) SetTask(ctx context.Context, id uuid.UUID, taskID uuid.UUID, taskVersion int) error {
	affected, err := p.q.SetArenaMatchTask(ctx, arenadb.SetArenaMatchTaskParams{
		ID:          sharedpg.UUID(id),
		TaskID:      sharedpg.UUID(taskID),
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

// UpsertParticipantResult записывает итог решающего участника.
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
		MatchID:        sharedpg.UUID(part.MatchID),
		UserID:         sharedpg.UUID(part.UserID),
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

// ListByUser возвращает одну пагинированную страницу finished/cancelled
// матчей пользователя userID и общее число строк под тем же фильтром.
// Запрос делает JOIN с arena_participants дважды — первый раз, чтобы
// получить строку вызывающего (для LP-дельты), второй — чтобы найти
// оппонента (пока только для 1v1; для 2v2 возвращается «первый другой»,
// которого фронт трактует как капитана противоположной команды).
// avatar_url пустой до появления profiles.media.
func (p *Postgres) ListByUser(
	ctx context.Context,
	userID uuid.UUID,
	limit, offset int,
	modeFilter enums.ArenaMode,
	sectionFilter enums.Section,
) ([]domain.MatchHistoryEntry, int, error) {
	rows, err := p.q.ListMyMatches(ctx, arenadb.ListMyMatchesParams{
		UserID:    sharedpg.UUID(userID),
		Mode:      string(modeFilter),
		Section:   string(sectionFilter),
		LimitVal:  int32(limit),
		OffsetVal: int32(offset),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("arena.pg.ListByUser: %w", err)
	}
	totalRaw, err := p.q.CountMyMatches(ctx, arenadb.CountMyMatchesParams{
		UserID:  sharedpg.UUID(userID),
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
			w := sharedpg.UUIDFrom(r.WinnerID)
			winner = &w
		}
		entry := domain.MatchHistoryEntry{
			MatchID: sharedpg.UUIDFrom(r.MatchID),
			Mode:    enums.ArenaMode(r.Mode),
			Section: enums.Section(r.Section),
			Result:  domain.ResultFor(userID, winner, enums.MatchStatus(r.Status)),
		}
		if r.FinishedAt.Valid {
			entry.FinishedAt = r.FinishedAt.Time.UTC()
		}
		if r.OpponentUserID.Valid {
			entry.OpponentUserID = sharedpg.UUIDFrom(r.OpponentUserID)
		}
		if r.OpponentUsername.Valid {
			entry.OpponentUsername = r.OpponentUsername.String
		}
		if r.OpponentAvatarUrl.Valid {
			entry.OpponentAvatarURL = r.OpponentAvatarUrl.String
		}
		// LP-дельта — elo_after - elo_before; падаем в 0, если rating-домен
		// ещё не финализировал результат по этой строке.
		if r.MeEloAfter.Valid {
			entry.LPChange = int(r.MeEloAfter.Int32) - int(r.MeEloBefore)
		}
		// Длительность — finished_at - started_at в целых секундах.
		// Отрицательные значения прижимаем к нулю (clock skew).
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

// PickBySectionDifficulty возвращает одну активную task'у по заданным
// section+difficulty. solution_hint никогда не выбирается.
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
		ID:            sharedpg.UUIDFrom(row.ID),
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

// FindCurrentMatch возвращает последний незавершённый матч пользователя
// (status IN searching/confirming/active). SPA опрашивает это, пока
// пользователь в очереди, чтобы в момент появления матча перейти на
// /arena/match/:id.
//
// Написано руками через pgx (без sqlc), потому что это single-row lookup
// с фильтром по трём статусам — заводить ради этого sqlc-запрос избыточно.
// Если появятся ещё polling-endpoint'ы — имеет смысл вынести в query-файл.
func (p *Postgres) FindCurrentMatch(ctx context.Context, userID uuid.UUID) (domain.Match, error) {
	const sql = `
		SELECT m.id, m.task_id, m.task_version, m.section, m.mode, m.status,
		       m.winner_id, m.started_at, m.finished_at, m.created_at
		  FROM arena_matches m
		  JOIN arena_participants p ON p.match_id = m.id
		 WHERE p.user_id = $1
		   AND m.status IN ('searching', 'confirming', 'active')
		 ORDER BY m.created_at DESC
		 LIMIT 1
	`
	row := p.pool.QueryRow(ctx, sql, sharedpg.UUID(userID))
	var (
		am arenadb.ArenaMatch
	)
	if err := row.Scan(
		&am.ID, &am.TaskID, &am.TaskVersion, &am.Section, &am.Mode, &am.Status,
		&am.WinnerID, &am.StartedAt, &am.FinishedAt, &am.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Match{}, domain.ErrNotFound
		}
		return domain.Match{}, fmt.Errorf("arena.pg.FindCurrentMatch: %w", err)
	}
	return matchFromRow(am), nil
}

// GetByID тянет task по id, solution_hint исключается.
func (p *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.TaskPublic, error) {
	row, err := p.q.GetArenaTaskPublic(ctx, sharedpg.UUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskPublic{}, domain.ErrNotFound
		}
		return domain.TaskPublic{}, fmt.Errorf("arena.pg.GetByID: %w", err)
	}
	return domain.TaskPublic{
		ID:            sharedpg.UUIDFrom(row.ID),
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

// ── вспомогательные функции ────────────────────────────────────────────────

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
		ID:          sharedpg.UUIDFrom(r.ID),
		TaskID:      sharedpg.UUIDFrom(r.TaskID),
		TaskVersion: int(r.TaskVersion),
		Section:     enums.Section(r.Section),
		Mode:        enums.ArenaMode(r.Mode),
		Status:      enums.MatchStatus(r.Status),
		CreatedAt:   r.CreatedAt.Time,
	}
	if r.WinnerID.Valid {
		w := sharedpg.UUIDFrom(r.WinnerID)
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
		MatchID:   sharedpg.UUIDFrom(r.MatchID),
		UserID:    sharedpg.UUIDFrom(r.UserID),
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
		// Конвертируем fixed-point numeric в float64.
		f, _ := new(big.Float).SetInt(r.SuspicionScore.Int).Float64()
		// Корректируем по показателю степени.
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

// Interface guards — проверки соответствия интерфейсам.
var (
	_ domain.MatchRepo = (*Postgres)(nil)
	_ domain.TaskRepo  = (*Postgres)(nil)
)
