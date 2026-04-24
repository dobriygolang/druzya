// state.go — реализация app.UserStateProvider поверх существующих таблиц
// (profiles, ratings, daily_streaks, daily_kata_history, arena_*, guild_members,
// guild_wars, friendships).
//
// Cross-domain reads OK здесь — это именно adapter, чьё назначение — клеить
// state из соседних таблиц (а не дёргать чужие Go-репо). Никаких импортов
// чужих доменов мы не тянем.
package infra

import (
	"context"
	"errors"
	"fmt"

	achApp "druz9/achievements/app"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StateProvider реализует app.UserStateProvider.
type StateProvider struct {
	pool *pgxpool.Pool
}

// NewStateProvider конструктор.
func NewStateProvider(pool *pgxpool.Pool) *StateProvider {
	return &StateProvider{pool: pool}
}

// Snapshot собирает state одним блоком — каждый запрос отдельный, но все
// тонкие SELECT'ы.
func (s *StateProvider) Snapshot(ctx context.Context, uid uuid.UUID) (achApp.UserState, error) {
	var st achApp.UserState

	// profiles: level + xp.
	row := s.pool.QueryRow(ctx, `
		SELECT level, xp
		  FROM profiles
		 WHERE user_id = $1
	`, uid)
	var (
		level int
		xp    int64
	)
	if err := row.Scan(&level, &xp); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return st, fmt.Errorf("achievements.state.profile: %w", err)
		}
	}
	st.Level = level
	if xp > 0 {
		st.XPTotal = int(xp)
	}

	// daily_streaks.
	row = s.pool.QueryRow(ctx, `
		SELECT current_streak
		  FROM daily_streaks
		 WHERE user_id = $1
	`, uid)
	if err := row.Scan(&st.CurrentStreak); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return st, fmt.Errorf("achievements.state.streak: %w", err)
	}

	// daily_kata_history total.
	row = s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE passed = TRUE)
		  FROM daily_kata_history
		 WHERE user_id = $1
	`, uid)
	if err := row.Scan(&st.DailyTotalDone); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return st, fmt.Errorf("achievements.state.daily_count: %w", err)
	}

	// ratings: max ELO.
	row = s.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(elo), 0)
		  FROM ratings
		 WHERE user_id = $1
	`, uid)
	if err := row.Scan(&st.MaxELO); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return st, fmt.Errorf("achievements.state.elo: %w", err)
	}

	// arena_matches: count побед.
	row = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM arena_matches
		 WHERE winner_id = $1 AND status = 'finished'
	`, uid)
	if err := row.Scan(&st.ArenaWins); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return st, fmt.Errorf("achievements.state.wins: %w", err)
	}

	// arena_matches: текущий win streak.
	// упрощённо — последовательные победы с конца. Берём 50 последних
	// матчей пользователя и считаем подряд. (Дешевле, чем оконные функции.)
	rows, err := s.pool.Query(ctx, `
		SELECT m.winner_id = $1
		  FROM arena_matches m
		  JOIN arena_participants p ON p.match_id = m.id
		 WHERE p.user_id = $1 AND m.status = 'finished'
		 ORDER BY m.finished_at DESC NULLS LAST
		 LIMIT 50
	`, uid)
	if err == nil {
		streak := 0
		for rows.Next() {
			var won bool
			if err := rows.Scan(&won); err != nil {
				break
			}
			if !won {
				break
			}
			streak++
		}
		rows.Close()
		st.CurrentWinStreak = streak
	}

	// guild_members: состоит ли в гильдии.
	row = s.pool.QueryRow(ctx, `SELECT 1 FROM guild_members WHERE user_id = $1`, uid)
	var x int
	if err := row.Scan(&x); err == nil {
		st.GuildJoined = true
	}

	// guild_wars: побед гильдии где user — member.
	row = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM guild_wars w
		  JOIN guild_members m ON m.guild_id = w.winner_id
		 WHERE m.user_id = $1
	`, uid)
	if err := row.Scan(&st.GuildWarsWon); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// игнорим — guild_wars может быть пуст или таблица отсутствовать;
		// guild_wars_won остаётся 0, что корректно для дефолтной картины.
		st.GuildWarsWon = 0
	}

	// friendships.count (00016). Если таблицы ещё нет — попадём в catch.
	row = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM friendships
		 WHERE status = 'accepted'
		   AND (requester_id = $1 OR addressee_id = $1)
	`, uid)
	if err := row.Scan(&st.FriendsCount); err != nil {
		// Скорее всего таблица отсутствует или ещё не мигрирована — оставляем 0.
		st.FriendsCount = 0
	}

	// Atlas — % разблокированных skill_nodes (примерная heuristic): unlocked >= 1
	// делим на total заполненных строк.
	row = s.pool.QueryRow(ctx, `
		SELECT COALESCE(
		   100 * COUNT(*) FILTER (WHERE unlocked_at IS NOT NULL) /
		   NULLIF(COUNT(*), 0), 0)::int
		  FROM skill_nodes
		 WHERE user_id = $1
	`, uid)
	if err := row.Scan(&st.AtlasPercent); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		st.AtlasPercent = 0
	}

	return st, nil
}

// Compile-time guard.
var _ achApp.UserStateProvider = (*StateProvider)(nil)
