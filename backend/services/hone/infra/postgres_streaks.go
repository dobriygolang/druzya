// Streaks repository — split out of postgres.go.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Streaks implements domain.StreakRepo.
type Streaks struct {
	pool *pgxpool.Pool
}

// NewStreaks wraps a pool.
func NewStreaks(pool *pgxpool.Pool) *Streaks { return &Streaks{pool: pool} }

// GetState returns the zero-value row for unseen users.
func (s *Streaks) GetState(ctx context.Context, userID uuid.UUID) (domain.StreakState, error) {
	var (
		current       int32
		longest       int32
		lastQualified pgtype.Date
		updatedAt     time.Time
	)
	err := s.pool.QueryRow(ctx,
		`SELECT current_streak, longest_streak, last_qualified, updated_at
		   FROM hone_streak_state WHERE user_id=$1`,
		sharedpg.UUID(userID),
	).Scan(&current, &longest, &lastQualified, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.StreakState{UserID: userID}, nil
		}
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.GetState: %w", err)
	}
	out := domain.StreakState{
		UserID:        userID,
		CurrentStreak: int(current),
		LongestStreak: int(longest),
		UpdatedAt:     updatedAt,
	}
	if lastQualified.Valid {
		t := lastQualified.Time
		out.LastQualified = &t
	}
	return out, nil
}

// ApplyFocusSession is the transactional streak update. Runs three
// statements in one TX:
//
//  1. Read the (existing, pre-update) qualifies_streak for (user, day).
//     Zero-row → was false by construction.
//  2. Upsert hone_streak_days with the delta; RETURN new qualifies_streak.
//  3. If the day JUST crossed the threshold (was false, now true) AND
//     we're not re-qualifying a day that was already qualified:
//     - current_streak = last_qualified == day-1 ? prev.current + 1 : 1
//     - longest_streak = max(prev.longest, current_streak)
//     - last_qualified = day
//     Otherwise, leave the state untouched (idempotent on additional
//     focus within an already-qualified day).
//
// Returns the fresh state after the transaction commits. Any error rolls
// the whole TX back — callers see a valid or missing transition, never a
// torn one where day was incremented but state wasn't.
func (s *Streaks) ApplyFocusSession(ctx context.Context, userID uuid.UUID, day time.Time, secondsDelta, sessionsDelta int, qualifyingThreshold int) (domain.StreakState, error) {
	day = day.UTC().Truncate(24 * time.Hour)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.ApplyFocusSession: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Read pre-update qualifying flag.
	var wasQualifying bool
	err = tx.QueryRow(ctx,
		`SELECT qualifies_streak FROM hone_streak_days WHERE user_id=$1 AND day=$2`,
		sharedpg.UUID(userID), pgtype.Date{Time: day, Valid: true},
	).Scan(&wasQualifying)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.ApplyFocusSession: pre-qual: %w", err)
	}

	// 2. Upsert day row, return post-update flag.
	var nowQualifying bool
	err = tx.QueryRow(ctx,
		// Casts on $3 / $5 — без них pgx упирается в «inconsistent types
		// deduced for parameter $3» (тот же параметр используется и как
		// integer column-value в INSERT, и как операнд сравнения, что путает
		// type-inference). Явный ::int снимает неоднозначность.
		`INSERT INTO hone_streak_days (user_id, day, focused_seconds, sessions_count, qualifies_streak)
		 VALUES ($1, $2, $3::int, $4::int, $3::int >= $5::int)
		 ON CONFLICT (user_id, day) DO UPDATE
		   SET focused_seconds = hone_streak_days.focused_seconds + EXCLUDED.focused_seconds,
		       sessions_count  = hone_streak_days.sessions_count  + EXCLUDED.sessions_count,
		       qualifies_streak = (hone_streak_days.focused_seconds + EXCLUDED.focused_seconds) >= $5::int,
		       updated_at = now()
		 RETURNING qualifies_streak`,
		sharedpg.UUID(userID),
		pgtype.Date{Time: day, Valid: true},
		int32(secondsDelta),
		int32(sessionsDelta),
		int32(qualifyingThreshold),
	).Scan(&nowQualifying)
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.ApplyFocusSession: upsert day: %w", err)
	}

	// 3. If the day just transitioned false→true, bump state.
	if !wasQualifying && nowQualifying {
		if err := s.transitionState(ctx, tx, userID, day); err != nil {
			return domain.StreakState{}, fmt.Errorf("hone.Streaks.ApplyFocusSession: transition: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.ApplyFocusSession: commit: %w", err)
	}
	return s.GetState(ctx, userID)
}

// transitionState updates hone_streak_state after a day-row crosses the
// qualifying threshold. Executed inside the caller's TX.
//
// The single-statement form uses an INSERT … ON CONFLICT with a CASE on the
// existing last_qualified → keeps the entire transition atomic. Three
// possible outcomes by `last_qualified` relation to `day`:
//
//   - equal to day:        no-op (shouldn't normally hit — pre-qual check
//     guards — but safe under concurrent retries)
//   - equal to day - 1:    current += 1   (streak continues)
//   - else:                current = 1    (new streak starts today)
//
// longest_streak = GREATEST(previous, new current). last_qualified = day.
func (s *Streaks) transitionState(ctx context.Context, tx pgx.Tx, userID uuid.UUID, day time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO hone_streak_state (user_id, current_streak, longest_streak, last_qualified)
		 VALUES ($1, 1, 1, $2)
		 ON CONFLICT (user_id) DO UPDATE
		   SET current_streak = CASE
		         WHEN hone_streak_state.last_qualified = $2 THEN hone_streak_state.current_streak
		         WHEN hone_streak_state.last_qualified = ($2::date - INTERVAL '1 day') THEN hone_streak_state.current_streak + 1
		         ELSE 1
		       END,
		       longest_streak = GREATEST(
		         hone_streak_state.longest_streak,
		         CASE
		           WHEN hone_streak_state.last_qualified = $2 THEN hone_streak_state.current_streak
		           WHEN hone_streak_state.last_qualified = ($2::date - INTERVAL '1 day') THEN hone_streak_state.current_streak + 1
		           ELSE 1
		         END
		       ),
		       last_qualified = $2,
		       updated_at = now()`,
		sharedpg.UUID(userID),
		pgtype.Date{Time: day, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("hone.Streaks.transitionState: %w", err)
	}
	return nil
}

// FindDrift сравнивает факт из hone_focus_sessions с агрегатом в
// hone_streak_days и возвращает расхождения за последние `lookback`.
//
// Источник истины — focus_sessions (SUM(seconds_focused), COUNT(*)).
// Drift случается, когда EndFocus сохранил сессию, но ApplyFocusSession
// упал (транзиентная ошибка БД/Redis). Код-pathes логируют warning и
// оставляют reconciliation background-job'у разобраться.
//
// FULL OUTER JOIN по (user_id, day) — потому что стороны могут не совпадать:
// день может быть в focus_sessions и не быть в streak_days (пропущенный
// upsert), или наоборот (ручная правка БД — сюда не должно возвращаться
// но на всякий возвращаем StoredDayExists=true ActualSeconds=0 — пусть
// reconciler решит что делать).
func (s *Streaks) FindDrift(ctx context.Context, lookback time.Duration) ([]domain.DriftRow, error) {
	cutoff := time.Now().UTC().Add(-lookback)
	rows, err := s.pool.Query(ctx,
		`WITH agg AS (
		    SELECT user_id,
		           (ended_at AT TIME ZONE 'UTC')::date AS day,
		           COALESCE(SUM(seconds_focused), 0)::int AS secs,
		           COUNT(*)::int                          AS sess
		      FROM hone_focus_sessions
		     WHERE ended_at IS NOT NULL
		       AND ended_at >= $1
		  GROUP BY user_id, day
		)
		SELECT COALESCE(a.user_id, d.user_id)                AS user_id,
		       COALESCE(a.day, d.day)                         AS day,
		       COALESCE(a.secs, 0)                            AS actual_secs,
		       COALESCE(a.sess, 0)                            AS actual_sess,
		       COALESCE(d.focused_seconds, 0)                 AS stored_secs,
		       COALESCE(d.sessions_count, 0)                  AS stored_sess,
		       (d.user_id IS NOT NULL)                        AS stored_exists
		  FROM agg a
		  FULL OUTER JOIN hone_streak_days d
		    ON a.user_id = d.user_id AND a.day = d.day
		 WHERE (COALESCE(a.day, d.day) >= $1::date)
		   AND (
		         d.user_id IS NULL
		      OR a.user_id IS NULL
		      OR COALESCE(a.secs, 0) <> d.focused_seconds
		      OR COALESCE(a.sess, 0) <> d.sessions_count
		   )`,
		cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Streaks.FindDrift: %w", err)
	}
	defer rows.Close()
	out := make([]domain.DriftRow, 0, 8)
	for rows.Next() {
		var (
			userID      pgtype.UUID
			day         pgtype.Date
			actualSecs  int32
			actualSess  int32
			storedSecs  int32
			storedSess  int32
			storedExist bool
		)
		if err := rows.Scan(&userID, &day, &actualSecs, &actualSess, &storedSecs, &storedSess, &storedExist); err != nil {
			return nil, fmt.Errorf("hone.Streaks.FindDrift: scan: %w", err)
		}
		out = append(out, domain.DriftRow{
			UserID:          sharedpg.UUIDFrom(userID),
			Day:             day.Time,
			ActualSeconds:   int(actualSecs),
			ActualSessions:  int(actualSess),
			StoredSeconds:   int(storedSecs),
			StoredSessions:  int(storedSess),
			StoredDayExists: storedExist,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Streaks.FindDrift: rows: %w", err)
	}
	return out, nil
}

// recomputeBatchRow — narrow shape, matches hone/app domainDriftLike.
// Не импортируем app-package в infra (циркуляр) — описано локально.
// ВАЖНО: должен быть type alias (=), а не named type, иначе interface
// satisfaction в app не сработает (Go nominal typing).
type recomputeBatchRow = struct {
	UserID         uuid.UUID
	Day            time.Time
	ActualSeconds  int
	ActualSessions int
}

// RecomputeDaysBatch — batch-вариант RecomputeDay для reconciler'а.
// Вместо N round-trip'ов делает 1 pgx.SendBatch.
//
// Семантика отличается от per-row RecomputeDay в одном моменте: state-
// transition (transitionState) НЕ запускается per row. Это сознательный
// trade-off: reconciler runs every 15 min, и state будет согласован
// в течение след. real-write пути (любой EndFocus → ApplyFocusSession
// делает transitionState штатно). Альтернатива — отдельный pass'ом
// transitionState только для (user, day) пар где qualifies флипнулся
// false→true; не делаем сейчас чтобы не раздувать R4.
//
// Соответствие interface'у `app.streakBatchRecomputer`. В случае
// signature-drift compile-time error в callers.
func (s *Streaks) RecomputeDaysBatch(ctx context.Context, drift []recomputeBatchRow, qualifyingThreshold int) (int64, error) {
	if len(drift) == 0 {
		return 0, nil
	}
	batch := &pgx.Batch{}
	for _, d := range drift {
		day := d.Day.UTC().Truncate(24 * time.Hour)
		batch.Queue(
			`INSERT INTO hone_streak_days (user_id, day, focused_seconds, sessions_count, qualifies_streak)
			 VALUES ($1, $2, $3::int, $4::int, $3::int >= $5::int)
			 ON CONFLICT (user_id, day) DO UPDATE
			   SET focused_seconds = EXCLUDED.focused_seconds,
			       sessions_count  = EXCLUDED.sessions_count,
			       qualifies_streak = EXCLUDED.qualifies_streak,
			       updated_at = now()`,
			sharedpg.UUID(d.UserID),
			pgtype.Date{Time: day, Valid: true},
			int32(d.ActualSeconds),
			int32(d.ActualSessions),
			int32(qualifyingThreshold),
		)
	}
	br := s.pool.SendBatch(ctx, batch)
	defer br.Close()
	var total int64
	for range drift {
		tag, err := br.Exec()
		if err != nil {
			return total, fmt.Errorf("hone.Streaks.RecomputeDaysBatch: exec: %w", err)
		}
		total += tag.RowsAffected()
	}
	if err := br.Close(); err != nil {
		return total, fmt.Errorf("hone.Streaks.RecomputeDaysBatch: close: %w", err)
	}
	return total, nil
}

// RecomputeDay перезаписывает строку hone_streak_days абсолютными значениями
// и прогоняет transitionState, если qualifies флипнулось в true. В отличие
// от ApplyFocusSession (который использует дельту), здесь мы знаем
// source-of-truth агрегат и просто выставляем его.
//
// Идемпотентность: повторный вызов с теми же аргументами не меняет данные
// (UPSERT SET absolute values, transitionState — nop если last_qualified
// уже равен этому дню). Это позволяет reconciler'у безопасно запускаться
// каждые N минут без риска двойного счёта.
//
// Edge-case: если qualifies было true, а новое значение ниже threshold —
// мы понижаем qualifies, но state.current_streak НЕ трогаем (ломать streak
// задним числом из-за reconciliation страшнее чем оставить маленький
// drift). Это решение в пользу пользователя. Полноценный rebuild state
// требует replay всей истории и в MVP не делается.
func (s *Streaks) RecomputeDay(ctx context.Context, userID uuid.UUID, day time.Time, secondsAbs, sessionsAbs, qualifyingThreshold int) (domain.StreakState, error) {
	day = day.UTC().Truncate(24 * time.Hour)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.RecomputeDay: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var wasQualifying bool
	err = tx.QueryRow(ctx,
		`SELECT qualifies_streak FROM hone_streak_days WHERE user_id=$1 AND day=$2`,
		sharedpg.UUID(userID), pgtype.Date{Time: day, Valid: true},
	).Scan(&wasQualifying)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.RecomputeDay: pre-qual: %w", err)
	}

	var nowQualifying bool
	err = tx.QueryRow(ctx,
		// См. ApplyFocusSession — те же каст'ы для type-inference.
		`INSERT INTO hone_streak_days (user_id, day, focused_seconds, sessions_count, qualifies_streak)
		 VALUES ($1, $2, $3::int, $4::int, $3::int >= $5::int)
		 ON CONFLICT (user_id, day) DO UPDATE
		   SET focused_seconds = EXCLUDED.focused_seconds,
		       sessions_count  = EXCLUDED.sessions_count,
		       qualifies_streak = EXCLUDED.qualifies_streak,
		       updated_at = now()
		 RETURNING qualifies_streak`,
		sharedpg.UUID(userID),
		pgtype.Date{Time: day, Valid: true},
		int32(secondsAbs),
		int32(sessionsAbs),
		int32(qualifyingThreshold),
	).Scan(&nowQualifying)
	if err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.RecomputeDay: upsert: %w", err)
	}

	// Flipped into qualifying → push state. Обратный флип не трогаем (см.
	// Godoc) — оставляем возможный drift в state, но не ломаем streak
	// пользователя из-за eventual-consistent reconciliation.
	if !wasQualifying && nowQualifying {
		if err := s.transitionState(ctx, tx, userID, day); err != nil {
			return domain.StreakState{}, fmt.Errorf("hone.Streaks.RecomputeDay: transition: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.StreakState{}, fmt.Errorf("hone.Streaks.RecomputeDay: commit: %w", err)
	}
	return s.GetState(ctx, userID)
}

// RangeDays returns days in [from, to] inclusive.
func (s *Streaks) RangeDays(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.StreakDay, error) {
	rows, err := s.pool.Query(ctx,
		// `hone_streak_days` schema (00001_baseline.sql) не имеет
		// updated_at — только day/focused_seconds/sessions_count/qualifies.
		// Возвращаем zero-time для UpdatedAt; consumers только used'ят
		// его для display, кэш не зависит.
		`SELECT day, focused_seconds, sessions_count, qualifies_streak
		   FROM hone_streak_days
		  WHERE user_id=$1 AND day BETWEEN $2 AND $3
		  ORDER BY day ASC`,
		sharedpg.UUID(userID),
		pgtype.Date{Time: from, Valid: true},
		pgtype.Date{Time: to, Valid: true},
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Streaks.RangeDays: %w", err)
	}
	defer rows.Close()
	out := make([]domain.StreakDay, 0, 32)
	for rows.Next() {
		var (
			day             pgtype.Date
			focusedSeconds  int32
			sessionsCount   int32
			qualifiesStreak bool
		)
		if err := rows.Scan(&day, &focusedSeconds, &sessionsCount, &qualifiesStreak); err != nil {
			return nil, fmt.Errorf("hone.Streaks.RangeDays: scan: %w", err)
		}
		out = append(out, domain.StreakDay{
			UserID:          userID,
			Day:             day.Time,
			FocusedSeconds:  int(focusedSeconds),
			SessionsCount:   int(sessionsCount),
			QualifiesStreak: qualifiesStreak,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Streaks.RangeDays: rows: %w", err)
	}
	return out, nil
}
