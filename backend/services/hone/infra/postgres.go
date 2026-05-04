// Package infra holds the Postgres repositories + llmchain adapters for Hone.
//
// MVP policy: hand-rolled pgx. We move to sqlc once the queries stabilise —
// until then the shape of hone_daily_plans.items (jsonb array) is still
// evolving as we iterate on the plan-generation prompt, and regenerating
// sqlc types on every shape tweak is friction we don't need during MVP.
// See queries/hone.sql for the sqlc-ready source once we flip the switch.
package infra

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"
	"druz9/shared/pkg/synctomb"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Plans ─────────────────────────────────────────────────────────────────

// Plans implements domain.PlanRepo.
type Plans struct {
	pool *pgxpool.Pool
}

// NewPlans wraps a pool.
func NewPlans(pool *pgxpool.Pool) *Plans { return &Plans{pool: pool} }

// GetForDate returns the plan for (user, date) — ErrNotFound if none.
func (p *Plans) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (domain.Plan, error) {
	var (
		id            pgtype.UUID
		itemsJSON     []byte
		regeneratedAt time.Time
		createdAt     time.Time
		updatedAt     time.Time
	)
	err := p.pool.QueryRow(ctx,
		`SELECT id, items, regenerated_at, created_at, updated_at
		   FROM hone_daily_plans
		  WHERE user_id=$1 AND plan_date=$2`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true},
	).Scan(&id, &itemsJSON, &regeneratedAt, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Plan{}, domain.ErrNotFound
		}
		return domain.Plan{}, fmt.Errorf("hone.Plans.GetForDate: %w", err)
	}
	items, err := unmarshalPlanItems(itemsJSON)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.GetForDate: items: %w", err)
	}
	return domain.Plan{
		ID:            sharedpg.UUIDFrom(id),
		UserID:        userID,
		Date:          date,
		Items:         items,
		RegeneratedAt: regeneratedAt,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}

// Upsert replaces the plan for (user, date).
func (p *Plans) Upsert(ctx context.Context, pl domain.Plan) (domain.Plan, error) {
	itemsJSON, err := json.Marshal(pl.Items)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.Upsert: marshal: %w", err)
	}
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err = p.pool.QueryRow(ctx,
		`INSERT INTO hone_daily_plans (user_id, plan_date, items, regenerated_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, plan_date) DO UPDATE
		   SET items = EXCLUDED.items,
		       regenerated_at = EXCLUDED.regenerated_at,
		       updated_at = now()
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(pl.UserID),
		pgtype.Date{Time: pl.Date, Valid: true},
		itemsJSON,
		pl.RegeneratedAt,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.Upsert: %w", err)
	}
	pl.ID = sharedpg.UUIDFrom(id)
	pl.CreatedAt = createdAt
	pl.UpdatedAt = updatedAt
	return pl, nil
}

// PatchItem updates a single item's flags in place. We read → mutate → write
// for MVP simplicity; future rev can push a jsonb_set() query for atomicity
// if concurrent clicks become a real issue (unlikely — one user, one desktop).
func (p *Plans) PatchItem(ctx context.Context, userID uuid.UUID, date time.Time, itemID string, dismissed, completed bool) (domain.Plan, error) {
	pl, err := p.GetForDate(ctx, userID, date)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.PatchItem: %w", err)
	}
	found := false
	for i := range pl.Items {
		if pl.Items[i].ID == itemID {
			pl.Items[i].Dismissed = dismissed
			pl.Items[i].Completed = completed
			found = true
			break
		}
	}
	if !found {
		return domain.Plan{}, fmt.Errorf("hone.Plans.PatchItem: %w", domain.ErrNotFound)
	}
	return p.Upsert(ctx, pl)
}

func unmarshalPlanItems(raw []byte) ([]domain.PlanItem, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var out []domain.PlanItem
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("unmarshal plan items: %w", err)
	}
	return out, nil
}

// ─── Focus sessions ────────────────────────────────────────────────────────

// Focus implements domain.FocusRepo.
type Focus struct {
	pool *pgxpool.Pool
}

// NewFocus wraps a pool.
func NewFocus(pool *pgxpool.Pool) *Focus { return &Focus{pool: pool} }

// Create inserts a started session.
func (f *Focus) Create(ctx context.Context, s domain.FocusSession) (domain.FocusSession, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
	)
	var planID pgtype.UUID
	if s.PlanID != nil {
		planID = sharedpg.UUID(*s.PlanID)
	}
	err := f.pool.QueryRow(ctx,
		`INSERT INTO hone_focus_sessions (user_id, plan_id, plan_item_id, pinned_title, mode, started_at)
		 VALUES ($1, NULLIF($2, '00000000-0000-0000-0000-000000000000'::uuid), $3, $4, $5, $6)
		 RETURNING id, created_at`,
		sharedpg.UUID(s.UserID), planID, s.PlanItemID, s.PinnedTitle, string(s.Mode), s.StartedAt,
	).Scan(&id, &createdAt)
	if err != nil {
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.Create: %w", err)
	}
	s.ID = sharedpg.UUIDFrom(id)
	s.CreatedAt = createdAt
	return s, nil
}

// End closes a session and returns the hydrated row.
func (f *Focus) End(ctx context.Context, userID, sessionID uuid.UUID, endedAt time.Time, pomodoros, secondsFocused int) (domain.FocusSession, error) {
	var (
		planID      pgtype.UUID
		planItemID  string
		pinnedTitle string
		mode        string
		startedAt   time.Time
		createdAt   time.Time
	)
	err := f.pool.QueryRow(ctx,
		`UPDATE hone_focus_sessions
		    SET ended_at=$3, pomodoros_completed=$4, seconds_focused=$5
		  WHERE id=$1 AND user_id=$2 AND ended_at IS NULL
		  RETURNING plan_id, plan_item_id, pinned_title, mode, started_at, created_at`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID), endedAt, int32(pomodoros), int32(secondsFocused),
	).Scan(&planID, &planItemID, &pinnedTitle, &mode, &startedAt, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FocusSession{}, domain.ErrNotFound
		}
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.End: %w", err)
	}
	out := domain.FocusSession{
		ID:                 sessionID,
		UserID:             userID,
		PlanItemID:         planItemID,
		PinnedTitle:        pinnedTitle,
		Mode:               domain.FocusMode(mode),
		StartedAt:          startedAt,
		EndedAt:            &endedAt,
		PomodorosCompleted: pomodoros,
		SecondsFocused:     secondsFocused,
		CreatedAt:          createdAt,
	}
	if planID.Valid {
		id := sharedpg.UUIDFrom(planID)
		out.PlanID = &id
	}
	return out, nil
}

// Get fetches one session by id + owner. ErrNotFound when missing.
// Mirrors End()'s SELECT shape so callers always see the same hydrated
// projection regardless of whether the session is open or closed.
func (f *Focus) Get(ctx context.Context, userID, sessionID uuid.UUID) (domain.FocusSession, error) {
	var (
		planID         pgtype.UUID
		planItemID     string
		pinnedTitle    string
		mode           string
		startedAt      time.Time
		endedAt        pgtype.Timestamptz
		pomodoros      int32
		secondsFocused int32
		createdAt      time.Time
	)
	err := f.pool.QueryRow(ctx,
		`SELECT plan_id, plan_item_id, pinned_title, mode, started_at,
		        ended_at, pomodoros_completed, seconds_focused, created_at
		   FROM hone_focus_sessions
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(sessionID), sharedpg.UUID(userID),
	).Scan(&planID, &planItemID, &pinnedTitle, &mode, &startedAt,
		&endedAt, &pomodoros, &secondsFocused, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.FocusSession{}, domain.ErrNotFound
		}
		return domain.FocusSession{}, fmt.Errorf("hone.Focus.Get: %w", err)
	}
	out := domain.FocusSession{
		ID:                 sessionID,
		UserID:             userID,
		PlanItemID:         planItemID,
		PinnedTitle:        pinnedTitle,
		Mode:               domain.FocusMode(mode),
		StartedAt:          startedAt,
		PomodorosCompleted: int(pomodoros),
		SecondsFocused:     int(secondsFocused),
		CreatedAt:          createdAt,
	}
	if planID.Valid {
		id := sharedpg.UUIDFrom(planID)
		out.PlanID = &id
	}
	if endedAt.Valid {
		t := endedAt.Time
		out.EndedAt = &t
	}
	return out, nil
}

// ─── Streak ────────────────────────────────────────────────────────────────

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

// ─── Notes ─────────────────────────────────────────────────────────────────

// Notes implements domain.NoteRepo. Embedding column is a float4[] in
// Postgres; we map to []float32 in Go without pgvector.
type Notes struct {
	pool *pgxpool.Pool
}

// NewNotes wraps a pool.
func NewNotes(pool *pgxpool.Pool) *Notes { return &Notes{pool: pool} }

// Create inserts a note.
func (n *Notes) Create(ctx context.Context, note domain.Note) (domain.Note, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	var folderID *pgtype.UUID
	if note.FolderID != nil {
		v := sharedpg.UUID(*note.FolderID)
		folderID = &v
	}
	err := n.pool.QueryRow(ctx,
		`INSERT INTO hone_notes (user_id, title, body_md, size_bytes, folder_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(note.UserID), note.Title, note.BodyMD, int32(note.SizeBytes), folderID,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.Notes.Create: %w", err)
	}
	note.ID = sharedpg.UUIDFrom(id)
	note.CreatedAt = createdAt
	note.UpdatedAt = updatedAt
	return note, nil
}

// Update overwrites title + body.
func (n *Notes) Update(ctx context.Context, note domain.Note) (domain.Note, error) {
	var (
		createdAt time.Time
		updatedAt time.Time
	)
	err := n.pool.QueryRow(ctx,
		`UPDATE hone_notes
		    SET title=$3, body_md=$4, size_bytes=$5, updated_at=now()
		  WHERE id=$1 AND user_id=$2
		  RETURNING created_at, updated_at`,
		sharedpg.UUID(note.ID), sharedpg.UUID(note.UserID), note.Title, note.BodyMD, int32(note.SizeBytes),
	).Scan(&createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{}, fmt.Errorf("hone.Notes.Update: %w", err)
	}
	note.CreatedAt = createdAt
	note.UpdatedAt = updatedAt
	return note, nil
}

// Get fetches one note with its embedding.
func (n *Notes) Get(ctx context.Context, userID, noteID uuid.UUID) (domain.Note, error) {
	var (
		title          string
		bodyMD         string
		sizeBytes      int32
		folderID       pgtype.UUID
		embedding      []float32
		embeddingModel pgtype.Text
		embeddedAt     pgtype.Timestamptz
		createdAt      time.Time
		updatedAt      time.Time
		encrypted      bool
	)
	err := n.pool.QueryRow(ctx,
		`SELECT n.title, n.body_md, n.size_bytes, n.folder_id, n.embedding,
		        em.name, n.embedded_at, n.created_at, n.updated_at, n.encrypted
		   FROM hone_notes n
		   LEFT JOIN embedding_models em ON em.id = n.embedding_model_id
		  WHERE n.id=$1 AND n.user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID),
	).Scan(&title, &bodyMD, &sizeBytes, &folderID, &embedding, &embeddingModel, &embeddedAt, &createdAt, &updatedAt, &encrypted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{}, fmt.Errorf("hone.Notes.Get: %w", err)
	}
	out := domain.Note{
		ID:        noteID,
		UserID:    userID,
		Title:     title,
		BodyMD:    bodyMD,
		SizeBytes: int(sizeBytes),
		Embedding: embedding,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
		Encrypted: encrypted,
	}
	if folderID.Valid {
		fid := sharedpg.UUIDFrom(folderID)
		out.FolderID = &fid
	}
	if embeddingModel.Valid {
		out.EmbeddingModel = embeddingModel.String
	}
	if embeddedAt.Valid {
		t := embeddedAt.Time
		out.EmbeddedAt = &t
	}
	return out, nil
}

// notesListCursor — инкапсулирует якорь keyset-пагинации. Сериализуется в
// base64(JSON), непрозрачный для клиента. (updated_at, id) — составной ключ;
// id нужен чтобы развести записи с одинаковым updated_at при массовых
// импортах или сек.-точностях TS.
type notesListCursor struct {
	UpdatedAt time.Time `json:"u"`
	ID        string    `json:"i"`
}

func encodeNotesCursor(c notesListCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeNotesCursor(s string) (notesListCursor, error) {
	if s == "" {
		return notesListCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return notesListCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c notesListCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return notesListCursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}

// List возвращает страницу заметок, отсортированных (updated_at DESC, id DESC).
// Keyset-пагинация: next_cursor = якорь последней строки. Невалидный cursor
// возвращает ошибку (не маскируется под пустую страницу, чтобы баг клиента
// не стал «ничего нет»).
//
// Пустая строка next_cursor означает конец выборки. Размер страницы: до limit.
// Дополнительная строка «подглядывания» (limit+1) используется чтобы понять,
// есть ли следующая страница, не делая второй запрос.
func (n *Notes) List(ctx context.Context, userID uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]domain.NoteSummary, string, error) {
	c, err := decodeNotesCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: %w", err)
	}

	// v2 baseline: archived_at column dropped (hard delete only). Listing
	// is straight by user_id; no soft-delete filter.
	sqlBase := `SELECT id, title, size_bytes, folder_id, updated_at
	              FROM hone_notes
	             WHERE user_id=$1`
	args := []any{sharedpg.UUID(userID)}

	if folderID != nil {
		sqlBase += ` AND folder_id=$2`
		args = append(args, sharedpg.UUID(*folderID))
	}

	// Peek limit+1: если вернулось больше limit — значит ещё есть страница.
	peek := int32(limit) + 1

	var rows pgx.Rows
	if c.UpdatedAt.IsZero() {
		nextParam := len(args) + 1
		rows, err = n.pool.Query(ctx,
			sqlBase+fmt.Sprintf(`
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $%d`, nextParam),
			append(args, peek)...,
		)
	} else {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: cursor id: %w", parseErr)
		}
		np := len(args) + 1
		rows, err = n.pool.Query(ctx,
			sqlBase+fmt.Sprintf(` AND (updated_at, id) < ($%d, $%d)
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $%d`, np, np+1, np+2),
			append(args, c.UpdatedAt, sharedpg.UUID(cid), peek)...,
		)
	}
	if err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.NoteSummary, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			sizeBytes int32
			fid       pgtype.UUID
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &sizeBytes, &fid, &updatedAt); err != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: scan: %w", err)
		}
		s := domain.NoteSummary{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			SizeBytes: int(sizeBytes),
			UpdatedAt: updatedAt,
		}
		if fid.Valid {
			v := sharedpg.UUIDFrom(fid)
			s.FolderID = &v
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: rows: %w", err)
	}

	// Есть ли следующая страница? Peek-строка обрезается, её якорь не
	// выдаём — возвращаем якорь последней строки текущей страницы.
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeNotesCursor(notesListCursor{
			UpdatedAt: last.UpdatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// Delete removes a note. Phase C-4: атомарно с DELETE пишет
// sync_tombstone — pull-endpoint потом вернёт это удаление другим
// устройствам юзера.
func (n *Notes) Delete(ctx context.Context, userID, noteID uuid.UUID) error {
	tx, err := n.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Notes.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_notes WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Notes.Delete: exec: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := synctomb.Write(ctx, tx, synctomb.TableHoneNotes,
		userID, noteID, sharedMw.DeviceIDFromContext(ctx)); err != nil {
		return fmt.Errorf("hone.Notes.Delete: tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Notes.Delete: commit: %w", err)
	}
	return nil
}

// ExistsByTitleForUser — точный match по title, archived'ы игнорируются.
// Используется TodayStandup endpoint для проверки «уже записал standup
// на сегодня?» (note title формируется как "Standup YYYY-MM-DD").
func (n *Notes) ExistsByTitleForUser(ctx context.Context, userID uuid.UUID, title string) (bool, error) {
	var exists bool
	err := n.pool.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM hone_notes
		    WHERE user_id=$1 AND title=$2
		 )`,
		sharedpg.UUID(userID), title,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("hone.Notes.ExistsByTitleForUser: %w", err)
	}
	return exists, nil
}

// SetEmbedding writes the vector + metadata. The model name is resolved
// against the embedding_models lookup table; an unknown name leaves the
// FK NULL (and the row will be re-embedded next time the model is seeded).
//
// Phase IX: пишет ОБЕ колонки — legacy real[] + pgvector vector(384).
// Read-side пока на Go-cosine; readers перейдут на pgvector в follow-up.
// Backfill старых rows один раз вручную (см. doc-комментарий внутри
// migration baseline.sql около CREATE INDEX idx_hone_notes_embedding_vec).
func (n *Notes) SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error {
	_, err := n.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET embedding=$3,
		        embedding_vec=NULLIF($6, '')::vector,
		        embedding_model_id=(SELECT id FROM embedding_models WHERE name = $4),
		        embedded_at=$5
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), vec, model, at, sharedpg.VectorString(vec),
	)
	if err != nil {
		return fmt.Errorf("hone.Notes.SetEmbedding: %w", err)
	}
	return nil
}

// Move sets folder_id for a note. folderID nil = move to root (unfiled).
// Validates folder ownership before the UPDATE so a non-existent or
// foreign folder surfaces as ErrNotFound instead of leaking a generic
// FK / "hone failure" 500 to the client.
func (n *Notes) Move(ctx context.Context, userID, noteID uuid.UUID, folderID *uuid.UUID) (domain.Note, error) {
	var fid *pgtype.UUID
	if folderID != nil {
		var ownerID pgtype.UUID
		err := n.pool.QueryRow(ctx,
			`SELECT user_id FROM hone_note_folders WHERE id=$1`,
			sharedpg.UUID(*folderID),
		).Scan(&ownerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.Note{}, domain.ErrNotFound
			}
			return domain.Note{}, fmt.Errorf("hone.Notes.Move: folder lookup: %w", err)
		}
		if sharedpg.UUIDFrom(ownerID) != userID {
			return domain.Note{}, domain.ErrNotOwner
		}
		v := sharedpg.UUID(*folderID)
		fid = &v
	}
	tag, err := n.pool.Exec(ctx,
		`UPDATE hone_notes SET folder_id=$3, updated_at=now()
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), fid,
	)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.Notes.Move: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Note{}, domain.ErrNotFound
	}
	return n.Get(ctx, userID, noteID)
}

// MarkStaleForReembed — Phase I admin tool. Clears embedded_at for every
// note whose vector was produced by a model OTHER than currentModelName.
// The async embed worker picks them up via the existing partial index and
// re-embeds with the current model. Returns count of marked rows.
//
// Не трогает encrypted notes (там embedding принципиально невозможен) и
// notes без embedding'а вовсе (worker сам подберёт).
func (n *Notes) MarkStaleForReembed(ctx context.Context, currentModelName string) (int64, error) {
	if currentModelName == "" {
		return 0, fmt.Errorf("hone.Notes.MarkStaleForReembed: currentModelName is required")
	}
	tag, err := n.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET embedded_at = NULL
		  WHERE embedded_at IS NOT NULL
		    AND embedding IS NOT NULL
		    AND NOT encrypted
		    AND embedding_model_id IS DISTINCT FROM
		        (SELECT id FROM embedding_models WHERE name = $1)`,
		currentModelName,
	)
	if err != nil {
		return 0, fmt.Errorf("hone.Notes.MarkStaleForReembed: %w", err)
	}
	return tag.RowsAffected(), nil
}

// SearchSimilarNotes — Phase IX v2: pgvector top-K с push-down в Postgres.
// modelName == "" → фильтр выключен (тестовый back-compat path);
// excludeNoteID == uuid.Nil → не фильтруем (например для AskNotes где
// seed-ноты нет). simFloor применяется как `1 - distance >= floor`
// (для cosine_ops `<=>` — distance в [0..2], score = 1-distance в [-1..1]).
func (n *Notes) SearchSimilarNotes(
	ctx context.Context,
	userID uuid.UUID,
	queryVec []float32,
	modelName string,
	excludeNoteID uuid.UUID,
	simFloor float32,
	limit int,
) ([]domain.NoteSimilarityHit, error) {
	if len(queryVec) == 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	vecStr := sharedpg.VectorString(queryVec)
	if vecStr == "" {
		return nil, nil
	}
	q := `SELECT id, title, LEFT(body_md, 140),
	             1 - (embedding_vec <=> $2::vector) AS similarity
	   FROM hone_notes
	  WHERE user_id = $1
	    AND embedding_vec IS NOT NULL
	    AND NOT encrypted`
	args := []any{sharedpg.UUID(userID), vecStr}
	if modelName != "" {
		q += fmt.Sprintf(" AND embedding_model_id = (SELECT id FROM embedding_models WHERE name = $%d)", len(args)+1)
		args = append(args, modelName)
	}
	if excludeNoteID != uuid.Nil {
		q += fmt.Sprintf(" AND id <> $%d", len(args)+1)
		args = append(args, sharedpg.UUID(excludeNoteID))
	}
	// simFloor → переводим в distance ceiling (`embedding_vec <=> v <= 1 - simFloor`)
	// для использования IVFFlat index'а на ORDER BY.
	if simFloor > 0 {
		q += fmt.Sprintf(" AND (embedding_vec <=> $2::vector) <= $%d", len(args)+1)
		args = append(args, float64(1-simFloor))
	}
	q += fmt.Sprintf(" ORDER BY embedding_vec <=> $2::vector ASC LIMIT $%d", len(args)+1)
	args = append(args, limit)
	rows, err := n.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteSimilarityHit, 0, limit)
	for rows.Next() {
		var (
			id         pgtype.UUID
			title      string
			snippet    string
			similarity float64
		)
		if err := rows.Scan(&id, &title, &snippet, &similarity); err != nil {
			return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: scan: %w", err)
		}
		out = append(out, domain.NoteSimilarityHit{
			ID:      sharedpg.UUIDFrom(id),
			Title:   title,
			Snippet: snippet,
			Score:   float32(similarity),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: rows: %w", err)
	}
	return out, nil
}

// WithEmbeddingsForUser returns the minimal projection for cosine scanning.
// Snippet is the first 140 chars of body_md — enough context for the UI row
// without dragging full bodies across the wire.
//
// Phase I: filters by embedding_model_id matching the requested modelName.
// Mixed-model cosine is undefined (different vector spaces, often different
// dimensionality) — silently invalid otherwise. modelName == "" disables
// the filter (test/back-compat path); production callers always pass it.
func (n *Notes) WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID, modelName string) ([]domain.NoteEmbedding, error) {
	// NOT encrypted — Phase C-7 E2E. Encrypted body_md = ciphertext;
	// embedding на нём garbage. Embed worker сам не enqueue'ит для
	// encrypted notes (см. notes.go EmbedFn skip), но defensive-фильтр
	// здесь страхует на случай legacy embeddings от ранее plaintext
	// заметки которая потом была encrypt'нута.
	q := `SELECT id, title, LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL AND NOT encrypted`
	args := []any{sharedpg.UUID(userID)}
	if modelName != "" {
		q += ` AND embedding_model_id = (SELECT id FROM embedding_models WHERE name = $2)`
		args = append(args, modelName)
	}
	rows, err := n.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteEmbedding, 0, 32)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			snippet   string
			embedding []float32
		)
		if err := rows.Scan(&id, &title, &snippet, &embedding); err != nil {
			return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: scan: %w", err)
		}
		out = append(out, domain.NoteEmbedding{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			Snippet:   snippet,
			Embedding: embedding,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: rows: %w", err)
	}
	return out, nil
}

// ─── Folders ───────────────────────────────────────────────────────────────

// Folders implements domain.FolderRepo.
type Folders struct {
	pool *pgxpool.Pool
}

// NewFolders wraps a pool.
func NewFolders(pool *pgxpool.Pool) *Folders { return &Folders{pool: pool} }

func (f *Folders) Create(ctx context.Context, folder domain.Folder) (domain.Folder, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	var parentID *pgtype.UUID
	if folder.ParentID != nil {
		v := sharedpg.UUID(*folder.ParentID)
		parentID = &v
	}
	err := f.pool.QueryRow(ctx,
		`INSERT INTO hone_note_folders (user_id, name, parent_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(folder.UserID), folder.Name, parentID,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Folder{}, fmt.Errorf("hone.Folders.Create: %w", err)
	}
	folder.ID = sharedpg.UUIDFrom(id)
	folder.CreatedAt = createdAt
	folder.UpdatedAt = updatedAt
	return folder, nil
}

func (f *Folders) List(ctx context.Context, userID uuid.UUID) ([]domain.Folder, error) {
	rows, err := f.pool.Query(ctx,
		`SELECT id, name, parent_id, created_at, updated_at
		   FROM hone_note_folders
		  WHERE user_id=$1
		  ORDER BY name ASC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Folders.List: %w", err)
	}
	defer rows.Close()
	var out []domain.Folder
	for rows.Next() {
		var (
			id        pgtype.UUID
			name      string
			parentID  pgtype.UUID
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &name, &parentID, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Folders.List: scan: %w", err)
		}
		folder := domain.Folder{
			ID:        sharedpg.UUIDFrom(id),
			UserID:    userID,
			Name:      name,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		}
		if parentID.Valid {
			pid := sharedpg.UUIDFrom(parentID)
			folder.ParentID = &pid
		}
		out = append(out, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Folders.List: rows: %w", err)
	}
	return out, nil
}

func (f *Folders) Delete(ctx context.Context, userID, folderID uuid.UUID, moveNotesToRoot bool) error {
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Folders.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if moveNotesToRoot {
		_, err = tx.Exec(ctx,
			`UPDATE hone_notes SET folder_id=NULL, updated_at=now()
			  WHERE folder_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		)
		if err != nil {
			return fmt.Errorf("hone.Folders.Delete: move notes: %w", err)
		}
		// Re-parent дочерних папок в root (parent_id=NULL). Без этого
		// дети остаются orphan'ами с висячим parent_id → frontend
		// FolderTreeBranch их не находит при обходе с root и они
		// перестают отображаться. Поведение «folder + всё внутри
		// уезжает в root» симметрично notes-flow выше.
		_, err = tx.Exec(ctx,
			`UPDATE hone_note_folders SET parent_id=NULL, updated_at=now()
			  WHERE parent_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		)
		if err != nil {
			return fmt.Errorf("hone.Folders.Delete: reparent children: %w", err)
		}
	} else {
		var count int
		if scanErr := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM hone_notes WHERE folder_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		).Scan(&count); scanErr != nil {
			return fmt.Errorf("hone.Folders.Delete: count notes: %w", scanErr)
		}
		if count > 0 {
			return domain.ErrFolderNotEmpty
		}
	}

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_note_folders WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(folderID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Folders.Delete: delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Folders.Delete: commit: %w", err)
	}
	return nil
}

// ─── Whiteboards ───────────────────────────────────────────────────────────

// Whiteboards implements domain.WhiteboardRepo.
type Whiteboards struct {
	pool *pgxpool.Pool
}

// NewWhiteboards wraps a pool.
func NewWhiteboards(pool *pgxpool.Pool) *Whiteboards { return &Whiteboards{pool: pool} }

// Create inserts a board.
func (w *Whiteboards) Create(ctx context.Context, wb domain.Whiteboard) (domain.Whiteboard, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := w.pool.QueryRow(ctx,
		`INSERT INTO hone_whiteboards (user_id, title, state_json)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(wb.UserID), wb.Title, wb.StateJSON,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Create: %w", err)
	}
	wb.ID = sharedpg.UUIDFrom(id)
	wb.Version = 1
	wb.CreatedAt = createdAt
	wb.UpdatedAt = updatedAt
	return wb, nil
}

// Update enforces optimistic concurrency.
func (w *Whiteboards) Update(ctx context.Context, wb domain.Whiteboard, expectedVersion int) (domain.Whiteboard, error) {
	var (
		newVersion int32
		updatedAt  time.Time
		createdAt  time.Time
	)
	// WHERE clause: enforce version when expected > 0; otherwise ignore.
	err := w.pool.QueryRow(ctx,
		`UPDATE hone_whiteboards
		    SET title=$3, state_json=$4, version=version+1, updated_at=now()
		  WHERE id=$1 AND user_id=$2 AND ($5 = 0 OR version = $5)
		  RETURNING version, updated_at, created_at`,
		sharedpg.UUID(wb.ID), sharedpg.UUID(wb.UserID), wb.Title, wb.StateJSON, int32(expectedVersion),
	).Scan(&newVersion, &updatedAt, &createdAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Could be not-found OR stale version — distinguish cheaply.
			var exists bool
			_ = w.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM hone_whiteboards WHERE id=$1 AND user_id=$2)`,
				sharedpg.UUID(wb.ID), sharedpg.UUID(wb.UserID)).Scan(&exists)
			if exists {
				return domain.Whiteboard{}, domain.ErrStaleVersion
			}
			return domain.Whiteboard{}, domain.ErrNotFound
		}
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Update: %w", err)
	}
	wb.Version = int(newVersion)
	wb.UpdatedAt = updatedAt
	wb.CreatedAt = createdAt
	return wb, nil
}

// Get fetches one board.
func (w *Whiteboards) Get(ctx context.Context, userID, wbID uuid.UUID) (domain.Whiteboard, error) {
	var (
		title     string
		stateJSON []byte
		version   int32
		createdAt time.Time
		updatedAt time.Time
	)
	err := w.pool.QueryRow(ctx,
		`SELECT title, state_json, version, created_at, updated_at
		   FROM hone_whiteboards
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(wbID), sharedpg.UUID(userID),
	).Scan(&title, &stateJSON, &version, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Whiteboard{}, domain.ErrNotFound
		}
		return domain.Whiteboard{}, fmt.Errorf("hone.Whiteboards.Get: %w", err)
	}
	return domain.Whiteboard{
		ID:        wbID,
		UserID:    userID,
		Title:     title,
		StateJSON: stateJSON,
		Version:   int(version),
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// List returns summaries, newest updated first.
func (w *Whiteboards) List(ctx context.Context, userID uuid.UUID) ([]domain.WhiteboardSummary, error) {
	rows, err := w.pool.Query(ctx,
		// v2 baseline: archived_at column dropped (hard delete only).
		`SELECT id, title, updated_at
		   FROM hone_whiteboards
		  WHERE user_id=$1
		  ORDER BY updated_at DESC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Whiteboards.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.WhiteboardSummary, 0, 16)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Whiteboards.List: scan: %w", err)
		}
		out = append(out, domain.WhiteboardSummary{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			UpdatedAt: updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Whiteboards.List: rows: %w", err)
	}
	return out, nil
}

// Delete removes a board.
// Delete removes a whiteboard. Phase C-4: атомарно с DELETE пишет
// sync_tombstone (см. Notes.Delete для rationale).
func (w *Whiteboards) Delete(ctx context.Context, userID, wbID uuid.UUID) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_whiteboards WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(wbID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: exec: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := synctomb.Write(ctx, tx, synctomb.TableHoneWhiteboards,
		userID, wbID, sharedMw.DeviceIDFromContext(ctx)); err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Whiteboards.Delete: commit: %w", err)
	}
	return nil
}

// ─── Resistance ────────────────────────────────────────────────────────────

// Resistance implements domain.ResistanceRepo.
type Resistance struct {
	pool *pgxpool.Pool
}

// NewResistance wraps a pool.
func NewResistance(pool *pgxpool.Pool) *Resistance { return &Resistance{pool: pool} }

// Record пишет dismiss-event. Идемпотентен: PRIMARY KEY гарантирует, что
// повторный dismiss того же item'а в тот же день — nop (ON CONFLICT DO NOTHING).
func (r *Resistance) Record(ctx context.Context, userID uuid.UUID, skillKey, itemID string, planDate time.Time) error {
	if skillKey == "" || itemID == "" {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO hone_plan_skips (user_id, skill_key, item_id, plan_date)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, skill_key, item_id, plan_date) DO NOTHING`,
		sharedpg.UUID(userID), skillKey, itemID, pgtype.Date{Time: planDate.UTC().Truncate(24 * time.Hour), Valid: true},
	)
	if err != nil {
		return fmt.Errorf("hone.Resistance.Record: %w", err)
	}
	return nil
}

// ChronicSkills возвращает скиллы, skip'ы по которым за `window` превышают
// `minCount`. HAVING COUNT(DISTINCT item_id) — уникальные task'и, не
// повторный dismiss того же item'а (дубли защищает PK, но item можно
// dismiss'ить, потом undismiss через новый AI-план, и снова dismiss — это
// уже два разных plan_date, посчитаем).
func (r *Resistance) ChronicSkills(ctx context.Context, userID uuid.UUID, window time.Duration, minCount int) ([]domain.ChronicSkill, error) {
	since := time.Now().UTC().Add(-window)
	rows, err := r.pool.Query(ctx,
		`SELECT skill_key, COUNT(*)::int, MAX(dismissed_at)
		   FROM hone_plan_skips
		  WHERE user_id=$1 AND dismissed_at >= $2
		  GROUP BY skill_key
		 HAVING COUNT(*) >= $3
		  ORDER BY COUNT(*) DESC, MAX(dismissed_at) DESC`,
		sharedpg.UUID(userID), since, int32(minCount),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Resistance.ChronicSkills: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ChronicSkill, 0, 4)
	for rows.Next() {
		var (
			skill    string
			count    int32
			lastSkip time.Time
		)
		if err := rows.Scan(&skill, &count, &lastSkip); err != nil {
			return nil, fmt.Errorf("hone.Resistance.ChronicSkills: scan: %w", err)
		}
		out = append(out, domain.ChronicSkill{
			SkillKey:  skill,
			SkipCount: int(count),
			LastSkip:  lastSkip,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Resistance.ChronicSkills: rows: %w", err)
	}
	return out, nil
}

// ─── Focus Queue ─────────────────────────────────────────────────────────

// Queue implements domain.QueueRepo.
type Queue struct {
	pool *pgxpool.Pool
}

func NewQueue(pool *pgxpool.Pool) *Queue { return &Queue{pool: pool} }

const queueColumns = "id, user_id, title, source, status, date, COALESCE(skill_key, ''), created_at, updated_at"

func (q *Queue) scanRow(row pgx.Row) (domain.QueueItem, error) {
	var (
		id        pgtype.UUID
		userID    pgtype.UUID
		title     string
		source    string
		status    string
		date      pgtype.Date
		skillKey  string
		createdAt time.Time
		updatedAt time.Time
	)
	if err := row.Scan(&id, &userID, &title, &source, &status, &date, &skillKey, &createdAt, &updatedAt); err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.queue.scan: %w", err)
	}
	return domain.QueueItem{
		ID:        sharedpg.UUIDFrom(id).String(),
		UserID:    sharedpg.UUIDFrom(userID).String(),
		Title:     title,
		Source:    domain.QueueItemSource(source),
		Status:    domain.QueueItemStatus(status),
		Date:      date.Time,
		SkillKey:  skillKey,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// ListByDate — sorted: in_progress (top) → todo (by created_at) → done.
func (q *Queue) ListByDate(ctx context.Context, userID uuid.UUID, date time.Time) ([]domain.QueueItem, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT `+queueColumns+`
		   FROM hone_queue_items
		  WHERE user_id=$1 AND date=$2
		  ORDER BY CASE status
		             WHEN 'in_progress' THEN 0
		             WHEN 'todo'        THEN 1
		             ELSE 2
		           END, created_at ASC`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true},
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Queue.ListByDate: %w", err)
	}
	defer rows.Close()
	out := make([]domain.QueueItem, 0)
	for rows.Next() {
		item, err := q.scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.Queue.ListByDate: scan: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Queue.ListByDate: rows: %w", err)
	}
	return out, nil
}

func (q *Queue) Create(ctx context.Context, item domain.QueueItem) (domain.QueueItem, error) {
	uid, err := uuid.Parse(item.UserID)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.Create: parse user_id: %w", err)
	}
	var skillKey *string
	if item.SkillKey != "" {
		s := item.SkillKey
		skillKey = &s
	}
	row := q.pool.QueryRow(ctx,
		`INSERT INTO hone_queue_items (user_id, title, source, status, date, skill_key)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+queueColumns,
		sharedpg.UUID(uid),
		item.Title,
		string(item.Source),
		string(item.Status),
		pgtype.Date{Time: item.Date, Valid: true},
		skillKey,
	)
	out, err := q.scanRow(row)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.Create: %w", err)
	}
	return out, nil
}

// UpdateStatus — атомарно реализует «один in_progress на user». Single TX:
// если new=in_progress → reset all peers первыми, потом update target.
// Status переходов не валидируем (можно todo→done напрямую) — UI controls
// решает что показывать; сервер только enforce'ит constraint.
func (q *Queue) UpdateStatus(ctx context.Context, id, userID uuid.UUID, status domain.QueueItemStatus) (domain.QueueItem, error) {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if status == domain.QueueItemStatusInProgress {
		// Сбрасываем все остальные in_progress этого user'а на сегодня.
		// CURRENT_DATE — потому что бизнес-правило применяется только к
		// today-pull'ам (исторические данные не трогаем).
		if _, eerr := tx.Exec(ctx,
			`UPDATE hone_queue_items
			    SET status='todo', updated_at=NOW()
			  WHERE user_id=$1 AND date=CURRENT_DATE
			    AND status='in_progress' AND id != $2`,
			sharedpg.UUID(userID), sharedpg.UUID(id),
		); eerr != nil {
			return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: reset peers: %w", eerr)
		}
	}

	row := tx.QueryRow(ctx,
		`UPDATE hone_queue_items
		    SET status=$3, updated_at=NOW()
		  WHERE id=$1 AND user_id=$2
		  RETURNING `+queueColumns,
		sharedpg.UUID(id), sharedpg.UUID(userID), string(status),
	)
	out, err := q.scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.QueueItem{}, domain.ErrNotFound
		}
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: commit: %w", err)
	}
	return out, nil
}

func (q *Queue) Delete(ctx context.Context, id, userID uuid.UUID) error {
	tag, err := q.pool.Exec(ctx,
		`DELETE FROM hone_queue_items WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Queue.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (q *Queue) ExistsByTitleToday(ctx context.Context, userID uuid.UUID, title string) (bool, error) {
	var n int
	err := q.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM hone_queue_items
		  WHERE user_id=$1 AND date=CURRENT_DATE AND title=$2`,
		sharedpg.UUID(userID), title,
	).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("hone.Queue.ExistsByTitleToday: %w", err)
	}
	return n > 0, nil
}

func (q *Queue) CountTodayByStatus(ctx context.Context, userID uuid.UUID) (total, done int, err error) {
	err = q.pool.QueryRow(ctx,
		`SELECT COUNT(*) FILTER (WHERE TRUE),
		        COUNT(*) FILTER (WHERE status='done')
		   FROM hone_queue_items
		  WHERE user_id=$1 AND date=CURRENT_DATE`,
		sharedpg.UUID(userID),
	).Scan(&total, &done)
	if err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.CountTodayByStatus: %w", err)
	}
	return total, done, nil
}

func (q *Queue) GetAIShareLast7Days(ctx context.Context, userID uuid.UUID) (aiShare, userShare float32, err error) {
	rows, err := q.pool.Query(ctx,
		`SELECT source, COUNT(*)::int
		   FROM hone_queue_items
		  WHERE user_id=$1 AND status='done'
		    AND date >= CURRENT_DATE - INTERVAL '7 days'
		  GROUP BY source`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: %w", err)
	}
	defer rows.Close()
	var ai, user int
	for rows.Next() {
		var src string
		var cnt int
		if err := rows.Scan(&src, &cnt); err != nil {
			return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: scan: %w", err)
		}
		switch src {
		case "ai":
			ai = cnt
		case "user":
			user = cnt
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: rows: %w", err)
	}
	total := ai + user
	if total == 0 {
		return 0, 0, nil
	}
	return float32(ai) / float32(total), float32(user) / float32(total), nil
}

// ─── Cue Sessions ──────────────────────────────────────────────────────────
//
// Phase B.4 (schema_v2): hone_cue_sessions was merged into hone_notes via the
// `kind` column. A Cue session is a hone_notes row with kind='cue', a
// non-NULL file_path / started_at / imported_at, and the raw analysis JSON
// in raw_analysis_json. The unique index idx_hone_notes_user_file_path
// (partial WHERE file_path IS NOT NULL) keeps Import idempotent.

type CueSessions struct {
	pool *pgxpool.Pool
}

func NewCueSessions(pool *pgxpool.Pool) *CueSessions { return &CueSessions{pool: pool} }

// Import создаёт новую сессию или обновляет существующую по file_path.
// initialBodyMD используется только при первом импорте (на ON CONFLICT
// поле body_md остаётся прежним — юзерские правки не теряются).
func (c *CueSessions) Import(ctx context.Context, s domain.CueSession, initialBodyMD string) (domain.CueSession, error) {
	var (
		id         pgtype.UUID
		bodyMD     string
		startedAt  pgtype.Timestamptz
		importedAt pgtype.Timestamptz
		updatedAt  time.Time
	)
	var startedArg pgtype.Timestamptz
	if s.StartedAt != nil {
		startedArg = pgtype.Timestamptz{Time: *s.StartedAt, Valid: true}
	}
	err := c.pool.QueryRow(ctx,
		`INSERT INTO hone_notes
		   (user_id, kind, file_path, title, body_md, raw_analysis_json,
		    started_at, imported_at)
		 VALUES ($1, 'cue', $2, $3, $4, $5::jsonb, $6, now())
		 ON CONFLICT (user_id, file_path) WHERE file_path IS NOT NULL DO UPDATE
		   SET title             = EXCLUDED.title,
		       raw_analysis_json = EXCLUDED.raw_analysis_json,
		       started_at        = EXCLUDED.started_at,
		       updated_at        = now()
		 RETURNING id, body_md, started_at, imported_at, updated_at`,
		sharedpg.UUID(s.UserID),
		s.FilePath,
		s.Title,
		initialBodyMD,
		s.RawAnalysisJSON,
		startedArg,
	).Scan(&id, &bodyMD, &startedAt, &importedAt, &updatedAt)
	if err != nil {
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.Import: %w", err)
	}
	out := domain.CueSession{
		ID:              sharedpg.UUIDFrom(id),
		UserID:          s.UserID,
		FilePath:        s.FilePath,
		Title:           s.Title,
		BodyMD:          bodyMD,
		RawAnalysisJSON: s.RawAnalysisJSON,
		UpdatedAt:       updatedAt,
	}
	if startedAt.Valid {
		t := startedAt.Time
		out.StartedAt = &t
	}
	if importedAt.Valid {
		out.ImportedAt = importedAt.Time
	}
	return out, nil
}

// List returns kind='cue' rows sorted by imported_at DESC.
func (c *CueSessions) List(ctx context.Context, userID uuid.UUID) ([]domain.CueSession, error) {
	rows, err := c.pool.Query(ctx,
		`SELECT id, file_path, title, body_md, COALESCE(raw_analysis_json::text, ''),
		        started_at, imported_at, updated_at
		   FROM hone_notes
		  WHERE user_id=$1 AND kind='cue'
		  ORDER BY imported_at DESC NULLS LAST`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.CueSessions.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CueSession, 0, 16)
	for rows.Next() {
		var (
			id         pgtype.UUID
			filePath   pgtype.Text
			title      string
			bodyMD     string
			raw        string
			startedAt  pgtype.Timestamptz
			importedAt pgtype.Timestamptz
			updatedAt  time.Time
		)
		if err := rows.Scan(&id, &filePath, &title, &bodyMD, &raw, &startedAt, &importedAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.CueSessions.List: scan: %w", err)
		}
		s := domain.CueSession{
			ID:              sharedpg.UUIDFrom(id),
			UserID:          userID,
			FilePath:        filePath.String,
			Title:           title,
			BodyMD:          bodyMD,
			RawAnalysisJSON: raw,
			UpdatedAt:       updatedAt,
		}
		if startedAt.Valid {
			t := startedAt.Time
			s.StartedAt = &t
		}
		if importedAt.Valid {
			s.ImportedAt = importedAt.Time
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.CueSessions.List: rows: %w", err)
	}
	return out, nil
}

func (c *CueSessions) Get(ctx context.Context, userID, id uuid.UUID) (domain.CueSession, error) {
	var (
		filePath   pgtype.Text
		title      string
		bodyMD     string
		raw        string
		startedAt  pgtype.Timestamptz
		importedAt pgtype.Timestamptz
		updatedAt  time.Time
	)
	err := c.pool.QueryRow(ctx,
		`SELECT file_path, title, body_md, COALESCE(raw_analysis_json::text, ''),
		        started_at, imported_at, updated_at
		   FROM hone_notes
		  WHERE id=$1 AND user_id=$2 AND kind='cue'`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	).Scan(&filePath, &title, &bodyMD, &raw, &startedAt, &importedAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CueSession{}, domain.ErrNotFound
		}
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.Get: %w", err)
	}
	out := domain.CueSession{
		ID:              id,
		UserID:          userID,
		FilePath:        filePath.String,
		Title:           title,
		BodyMD:          bodyMD,
		RawAnalysisJSON: raw,
		UpdatedAt:       updatedAt,
	}
	if startedAt.Valid {
		t := startedAt.Time
		out.StartedAt = &t
	}
	if importedAt.Valid {
		out.ImportedAt = importedAt.Time
	}
	return out, nil
}

func (c *CueSessions) UpdateBody(ctx context.Context, userID, id uuid.UUID, bodyMD string) (domain.CueSession, error) {
	var updatedAt time.Time
	err := c.pool.QueryRow(ctx,
		`UPDATE hone_notes
		    SET body_md=$3, updated_at=now()
		  WHERE id=$1 AND user_id=$2 AND kind='cue'
		  RETURNING updated_at`,
		sharedpg.UUID(id), sharedpg.UUID(userID), bodyMD,
	).Scan(&updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.CueSession{}, domain.ErrNotFound
		}
		return domain.CueSession{}, fmt.Errorf("hone.CueSessions.UpdateBody: %w", err)
	}
	return c.Get(ctx, userID, id)
}

func (c *CueSessions) Delete(ctx context.Context, userID, id uuid.UUID) error {
	cmd, err := c.pool.Exec(ctx,
		`DELETE FROM hone_notes WHERE id=$1 AND user_id=$2 AND kind='cue'`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.CueSessions.Delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ domain.PlanRepo       = (*Plans)(nil)
	_ domain.FocusRepo      = (*Focus)(nil)
	_ domain.StreakRepo     = (*Streaks)(nil)
	_ domain.NoteRepo       = (*Notes)(nil)
	_ domain.WhiteboardRepo = (*Whiteboards)(nil)
	_ domain.ResistanceRepo = (*Resistance)(nil)
	_ domain.QueueRepo      = (*Queue)(nil)
	_ domain.CueSessionRepo = (*CueSessions)(nil)
)
