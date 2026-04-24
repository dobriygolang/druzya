package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"
	profiledb "druz9/profile/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// CountRecentActivity via sqlc-generated weekly counts.
func (p *Postgres) CountRecentActivity(ctx context.Context, userID uuid.UUID, since time.Time) (domain.Activity, error) {
	row, err := p.q.CountWeeklyActivity(ctx, profiledb.CountWeeklyActivityParams{
		UserID:      sharedpg.UUID(userID),
		SubmittedAt: pgtype.Timestamptz{Time: since, Valid: true},
	})
	if err != nil {
		return domain.Activity{}, fmt.Errorf("profile.Postgres.CountRecentActivity: %w", err)
	}
	return domain.Activity{
		TasksSolved: int(row.KatasPassed),
		MatchesWon:  int(row.MatchesWon),
		TimeMinutes: int(row.MockMinutes),
		// STUB: rating_change + xp_earned require event-sourced history we don't yet persist.
	}, nil
}

// ListMatchAggregatesSince возвращает плоский список матчей пользователя
// (только finished) за период. Для MVP читаем напрямую из arena_matches +
// arena_participants. XPDelta берётся как (elo_after - elo_before) — это
// прокси-LP, который коррелирует с XP-наградой за матч.
//
// Ошибки (отсутствие таблиц, SQL-проблемы) пробрасываются наверх; use case
// (см. app/report.go) логирует и деградирует к «нет данных», не роняя весь
// отчёт. Anti-fallback: здесь silent-swallow запрещён.
func (p *Postgres) ListMatchAggregatesSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.MatchAggregate, error) {
	const q = `
		SELECT m.section, m.winner_id = $1 AS won,
		       COALESCE(ap.elo_after, ap.elo_before) - ap.elo_before AS xp_delta
		  FROM arena_matches m
		  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
		 WHERE m.status = 'finished'
		   AND m.finished_at >= $2`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), since)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListMatchAggregatesSince: %w", err)
	}
	defer rows.Close()
	out := make([]domain.MatchAggregate, 0, 16)
	for rows.Next() {
		var section string
		var won bool
		var xpDelta int
		if err := rows.Scan(&section, &won, &xpDelta); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListMatchAggregatesSince: scan: %w", err)
		}
		out = append(out, domain.MatchAggregate{
			Section: enums.Section(section),
			Win:     won,
			XPDelta: xpDelta,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListMatchAggregatesSince: rows: %w", err)
	}
	return out, nil
}

// ListWeeklyXPSince возвращает XP за каждую из последних `weeks` календарных
// недель. Индекс 0 = текущая неделя.
//
// Одним запросом аггрегируем по bucket-индексу (0..weeks-1), чтобы избежать
// N+1 (раньше был цикл с отдельным QueryRow). Любые SQL-ошибки пробрасываются
// наверх; use case (report.go) логирует и деградирует к нулям.
func (p *Postgres) ListWeeklyXPSince(ctx context.Context, userID uuid.UUID, now time.Time, weeks int) ([]int, error) {
	if weeks <= 0 {
		return nil, nil
	}
	out := make([]int, weeks)
	end := now.UTC().Truncate(24 * time.Hour)
	windowStart := end.Add(-time.Duration(weeks) * 7 * 24 * time.Hour)
	const q = `
		SELECT FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - m.finished_at)) / (7 * 86400))::int AS bucket,
		       COALESCE(SUM(GREATEST(COALESCE(ap.elo_after, ap.elo_before) - ap.elo_before, 0)), 0)::int AS xp
		  FROM arena_matches m
		  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
		 WHERE m.status = 'finished'
		   AND m.finished_at >= $2
		   AND m.finished_at < $3
		 GROUP BY bucket`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), windowStart, end)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListWeeklyXPSince: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var bucket, xp int
		if err := rows.Scan(&bucket, &xp); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListWeeklyXPSince: scan: %w", err)
		}
		if bucket < 0 || bucket >= weeks {
			continue
		}
		out[bucket] = xp
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListWeeklyXPSince: rows: %w", err)
	}
	return out, nil
}

// GetStreaks читает текущий и лучший streak из daily_streaks. Отсутствие
// строки (pgx.ErrNoRows) — нормальный кейс для новых пользователей и
// возвращает (0, 0, nil). Остальные ошибки пробрасываются наверх (use case
// логирует и деградирует).
func (p *Postgres) GetStreaks(ctx context.Context, userID uuid.UUID) (int, int, error) {
	const q = `SELECT current_streak, best_streak FROM daily_streaks WHERE user_id = $1`
	var cur, best int
	if err := p.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&cur, &best); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, nil
		}
		return 0, 0, fmt.Errorf("profile.Postgres.GetStreaks: %w", err)
	}
	return cur, best, nil
}

// ── Phase A killer-stats ───────────────────────────────────────────────────

// ListHourlyActivitySince — флэт-массив 168 (dow*24+hour) с числом матчей,
// в которых пользователь участвовал. Пустые ячейки = 0. Хэнд-роллед pgx,
// потому что dow/hour-арифметика на стороне SQL не вписывается в sqlc.
func (p *Postgres) ListHourlyActivitySince(ctx context.Context, userID uuid.UUID, since time.Time) ([168]int, error) {
	var out [168]int
	const q = `
		SELECT EXTRACT(DOW FROM m.started_at)::int  AS dow,
		       EXTRACT(HOUR FROM m.started_at)::int AS hour,
		       COUNT(*)::int                          AS cnt
		  FROM arena_matches m
		  JOIN arena_participants ap ON ap.match_id = m.id AND ap.user_id = $1
		 WHERE m.started_at IS NOT NULL
		   AND m.started_at >= $2
		 GROUP BY dow, hour`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), since)
	if err != nil {
		return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var dow, hour, cnt int
		if err := rows.Scan(&dow, &hour, &cnt); err != nil {
			return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: scan: %w", err)
		}
		if dow < 0 || dow > 6 || hour < 0 || hour > 23 {
			continue
		}
		out[dow*24+hour] = cnt
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("profile.Postgres.ListHourlyActivitySince: rows: %w", err)
	}
	return out, nil
}

// ListEloSnapshotsSince читает elo_snapshots_daily в окне [since, now]
// и сортирует по дате ASC.
func (p *Postgres) ListEloSnapshotsSince(ctx context.Context, userID uuid.UUID, since time.Time) ([]domain.EloPoint, error) {
	const q = `
		SELECT snapshot_date, section, elo
		  FROM elo_snapshots_daily
		 WHERE user_id = $1 AND snapshot_date >= $2::date
		 ORDER BY snapshot_date ASC, section ASC`
	rows, err := p.pool.Query(ctx, q, sharedpg.UUID(userID), since)
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: %w", err)
	}
	defer rows.Close()
	out := make([]domain.EloPoint, 0, 32)
	for rows.Next() {
		var date time.Time
		var section string
		var elo int
		if err := rows.Scan(&date, &section, &elo); err != nil {
			return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: scan: %w", err)
		}
		out = append(out, domain.EloPoint{
			Date:    date,
			Section: enums.Section(section),
			Elo:     elo,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListEloSnapshotsSince: rows: %w", err)
	}
	return out, nil
}
