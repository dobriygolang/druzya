-- Queries consumed by sqlc; mirror hand-rolled pgx in infra/postgres.go.
-- CRITICAL: solution_hint is NEVER selected in the TaskPublic-shaped queries.

-- name: ListActiveTasks :many
SELECT id, slug, title_ru, description_ru, difficulty, section, time_limit_sec, memory_limit_mb
  FROM tasks
 WHERE is_active = true AND section = $1 AND difficulty = $2;

-- name: GetTaskPublic :one
SELECT id, slug, title_ru, description_ru, difficulty, section, time_limit_sec, memory_limit_mb
  FROM tasks WHERE id = $1;

-- name: WeakestSkillNode :one
SELECT node_key, progress
  FROM skill_nodes WHERE user_id = $1 ORDER BY progress ASC LIMIT 1;

-- name: AssignDailyKata :one
INSERT INTO daily_kata_history(user_id, kata_date, task_id, is_cursed, is_weekly_boss)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, kata_date) DO NOTHING
RETURNING task_id, is_cursed, is_weekly_boss, passed, freeze_used, submitted_at;

-- name: GetDailyKata :one
SELECT task_id, is_cursed, is_weekly_boss, passed, freeze_used, submitted_at
  FROM daily_kata_history
 WHERE user_id = $1 AND kata_date = $2;

-- name: MarkDailyKataSubmitted :execrows
UPDATE daily_kata_history
   SET passed = $3, submitted_at = now()
 WHERE user_id = $1 AND kata_date = $2;

-- name: ListKataHistory :many
SELECT kata_date, task_id, passed, freeze_used
  FROM daily_kata_history
 WHERE user_id = $1 AND kata_date >= $2 AND kata_date <= $3
 ORDER BY kata_date DESC;

-- name: GetStreak :one
SELECT current_streak, longest_streak, freeze_tokens, last_kata_date
  FROM daily_streaks WHERE user_id = $1;

-- name: UpsertStreak :exec
INSERT INTO daily_streaks(user_id, current_streak, longest_streak, freeze_tokens, last_kata_date)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id) DO UPDATE SET
  current_streak = EXCLUDED.current_streak,
  longest_streak = EXCLUDED.longest_streak,
  freeze_tokens  = EXCLUDED.freeze_tokens,
  last_kata_date = EXCLUDED.last_kata_date,
  updated_at     = now();

-- name: GetActiveCalendar :one
SELECT id, user_id, company_id, role, interview_date, current_level, readiness_pct, updated_at
  FROM interview_calendars
 WHERE user_id = $1 AND interview_date >= $2
 ORDER BY interview_date ASC LIMIT 1;

-- name: UpsertCalendar :one
INSERT INTO interview_calendars(user_id, company_id, role, interview_date, current_level)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, company_id, role, interview_date, current_level, readiness_pct, updated_at;

-- name: CreateAutopsy :one
INSERT INTO interview_autopsies(
  user_id, company_id, section, outcome, interview_date,
  questions_raw, answers_raw, notes, status, share_slug
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING id, user_id, company_id, section, outcome, interview_date,
          questions_raw, answers_raw, notes, status, analysis_json, share_slug, created_at;

-- name: GetAutopsy :one
SELECT id, user_id, company_id, section, outcome, interview_date,
       questions_raw, answers_raw, notes, status, analysis_json, share_slug, created_at
  FROM interview_autopsies WHERE id = $1;

-- name: MarkAutopsyReady :execrows
UPDATE interview_autopsies
   SET status = 'ready', analysis_json = $2::jsonb
 WHERE id = $1;
