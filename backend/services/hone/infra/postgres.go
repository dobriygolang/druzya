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

// Get fetches one session.
func (f *Focus) Get(ctx context.Context, userID, sessionID uuid.UUID) (domain.FocusSession, error) {
	// STUB: implement if any endpoint needs per-session GET. End() returns
	// the hydrated row directly so the first iteration of the client
	// doesn't need this endpoint. Unimplemented rather than broken —
	// returning ErrNotFound would be wrong (the row exists).
	_ = userID
	_ = sessionID
	return domain.FocusSession{}, fmt.Errorf("hone.Focus.Get: not yet implemented")
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
		`SELECT day, focused_seconds, sessions_count, qualifies_streak, updated_at
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
			updatedAt       time.Time
		)
		if err := rows.Scan(&day, &focusedSeconds, &sessionsCount, &qualifiesStreak, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Streaks.RangeDays: scan: %w", err)
		}
		out = append(out, domain.StreakDay{
			UserID:          userID,
			Day:             day.Time,
			FocusedSeconds:  int(focusedSeconds),
			SessionsCount:   int(sessionsCount),
			QualifiesStreak: qualifiesStreak,
			UpdatedAt:       updatedAt,
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
	err := n.pool.QueryRow(ctx,
		`INSERT INTO hone_notes (user_id, title, body_md, size_bytes)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(note.UserID), note.Title, note.BodyMD, int32(note.SizeBytes),
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
		embedding      []float32
		embeddingModel pgtype.Text
		embeddedAt     pgtype.Timestamptz
		createdAt      time.Time
		updatedAt      time.Time
		encrypted      bool
	)
	err := n.pool.QueryRow(ctx,
		`SELECT title, body_md, size_bytes, embedding, embedding_model, embedded_at, created_at, updated_at, encrypted
		   FROM hone_notes
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID),
	).Scan(&title, &bodyMD, &sizeBytes, &embedding, &embeddingModel, &embeddedAt, &createdAt, &updatedAt, &encrypted)
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
func (n *Notes) List(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.NoteSummary, string, error) {
	c, err := decodeNotesCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: %w", err)
	}

	// archived_at IS NULL — Phase C-2: archived notes скрываются из
	// основного списка. Recover через GET-by-id (всегда работает) либо
	// через будущий «View archived» режим.
	const sqlBase = `SELECT id, title, size_bytes, updated_at
	                   FROM hone_notes
	                  WHERE user_id=$1 AND archived_at IS NULL`
	// Peek limit+1: если вернулось больше limit — значит ещё есть страница.
	peek := int32(limit) + 1

	var rows pgx.Rows
	if c.UpdatedAt.IsZero() {
		rows, err = n.pool.Query(ctx,
			sqlBase+`
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $2`,
			sharedpg.UUID(userID), peek,
		)
	} else {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: cursor id: %w", parseErr)
		}
		rows, err = n.pool.Query(ctx,
			sqlBase+` AND (updated_at, id) < ($2, $3)
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $4`,
			sharedpg.UUID(userID), c.UpdatedAt, sharedpg.UUID(cid), peek,
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
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &sizeBytes, &updatedAt); err != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: scan: %w", err)
		}
		out = append(out, domain.NoteSummary{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			SizeBytes: int(sizeBytes),
			UpdatedAt: updatedAt,
		})
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
		    WHERE user_id=$1 AND title=$2 AND archived_at IS NULL
		 )`,
		sharedpg.UUID(userID), title,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("hone.Notes.ExistsByTitleForUser: %w", err)
	}
	return exists, nil
}

// SetArchived помечает заметку как archived (или восстанавливает).
// archived_at = now() / NULL — Phase C-2 архив.
func (n *Notes) SetArchived(ctx context.Context, userID, noteID uuid.UUID, archived bool) error {
	var stmt string
	if archived {
		stmt = `UPDATE hone_notes SET archived_at=now(), updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	} else {
		stmt = `UPDATE hone_notes SET archived_at=NULL, updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	}
	cmd, err := n.pool.Exec(ctx, stmt, sharedpg.UUID(noteID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("hone.Notes.SetArchived: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SetEmbedding writes the vector + metadata.
func (n *Notes) SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error {
	_, err := n.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET embedding=$3, embedding_model=$4, embedded_at=$5
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), vec, model, at,
	)
	if err != nil {
		return fmt.Errorf("hone.Notes.SetEmbedding: %w", err)
	}
	return nil
}

// WithEmbeddingsForUser returns the minimal projection for cosine scanning.
// Snippet is the first 140 chars of body_md — enough context for the UI row
// without dragging full bodies across the wire.
func (n *Notes) WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID) ([]domain.NoteEmbedding, error) {
	// NOT encrypted — Phase C-7 E2E. Encrypted body_md = ciphertext;
	// embedding на нём garbage. Embed worker сам не enqueue'ит для
	// encrypted notes (см. notes.go EmbedFn skip), но defensive-фильтр
	// здесь страхует на случай legacy embeddings от ранее plaintext
	// заметки которая потом была encrypt'нута.
	rows, err := n.pool.Query(ctx,
		`SELECT id, title, LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL AND NOT encrypted`,
		sharedpg.UUID(userID),
	)
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
		// archived_at IS NULL — Phase C-2 (см. Notes.List).
		`SELECT id, title, updated_at
		   FROM hone_whiteboards
		  WHERE user_id=$1 AND archived_at IS NULL
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

// SetArchived — Phase C-2 архив. См. Notes.SetArchived.
func (w *Whiteboards) SetArchived(ctx context.Context, userID, wbID uuid.UUID, archived bool) error {
	var stmt string
	if archived {
		stmt = `UPDATE hone_whiteboards SET archived_at=now(), updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	} else {
		stmt = `UPDATE hone_whiteboards SET archived_at=NULL, updated_at=now()
		         WHERE id=$1 AND user_id=$2`
	}
	cmd, err := w.pool.Exec(ctx, stmt, sharedpg.UUID(wbID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("hone.Whiteboards.SetArchived: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
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

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ domain.PlanRepo       = (*Plans)(nil)
	_ domain.FocusRepo      = (*Focus)(nil)
	_ domain.StreakRepo     = (*Streaks)(nil)
	_ domain.NoteRepo       = (*Notes)(nil)
	_ domain.WhiteboardRepo = (*Whiteboards)(nil)
	_ domain.ResistanceRepo = (*Resistance)(nil)
	_ domain.QueueRepo      = (*Queue)(nil)
)
