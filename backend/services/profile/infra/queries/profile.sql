-- Queries consumed by sqlc; mirror the hand-rolled pgx code in infra/postgres.go.

-- name: GetProfileBundle :one
-- v2: email column dropped from users; xp/level moved to user_xp.
SELECT u.id, u.username, u.role, u.locale, u.display_name, u.created_at,
       p.char_class, COALESCE(ux.level, 1) AS level, COALESCE(ux.total_xp, 0) AS total_xp,
       p.career_stage, p.updated_at,
       s.plan, s.status, s.current_period_end
  FROM users u
  JOIN profiles p           ON p.user_id = u.id
  LEFT JOIN user_xp ux      ON ux.user_id = u.id
  LEFT JOIN subscriptions s ON s.user_id = u.id
 WHERE u.id = $1;

-- name: GetProfilePublic :one
SELECT u.id, u.username, u.display_name, u.created_at,
       p.char_class, COALESCE(ux.level, 1) AS level, COALESCE(ux.total_xp, 0) AS total_xp,
       p.career_stage
  FROM users u
  JOIN profiles p      ON p.user_id = u.id
  LEFT JOIN user_xp ux ON ux.user_id = u.id
 WHERE u.username = $1;

-- name: EnsureProfile :exec
INSERT INTO profiles(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureSubscription :exec
INSERT INTO subscriptions(user_id, plan, status) VALUES ($1, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureNotificationPrefs :exec
INSERT INTO notification_prefs(user_id) VALUES ($1)
  ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureUserXP :exec
INSERT INTO user_xp(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;

-- name: InsertXPEvent :exec
-- Phase H audit-log row для каждого XPGained события. source —
-- closed набор (CHECK в migrations 00001_baseline.sql на xp_events:
-- task/arena/kata/podcast/mock/quiz/review/custom). source_id
-- опционально (match_id / task_id / kata_id для downstream-аналитики).
INSERT INTO xp_events (user_id, amount, source, source_id)
VALUES ($1, $2, $3, $4);

-- name: UpdateProfileXPLevel :exec
-- v2: xp/level live in user_xp table now (audit log in xp_events).
UPDATE user_xp
   SET level = $2, total_xp = $3, last_xp_at = now(), updated_at = now()
 WHERE user_id = $1;

-- name: ListSkillNodes :many
SELECT node_key, progress, unlocked_at, decayed_at, updated_at
  FROM skill_nodes WHERE user_id = $1;

-- name: CountWeeklyActivity :one
-- Pivot 2026-05-01: arena_matches/participants дропнуты. matches_won
-- остаётся в proto-shape но возвращает 0 — TODO выпилить из proto после
-- следующего gen-cycle.
SELECT
  (SELECT COUNT(*)::int FROM daily_kata_history dkh WHERE dkh.user_id = $1 AND dkh.passed = true AND dkh.submitted_at >= $2)::int AS katas_passed,
  0::int AS matches_won,
  (SELECT COALESCE(SUM(ms.duration_min),0)::int FROM mock_sessions ms
    WHERE ms.user_id = $1 AND ms.finished_at >= $2)::int AS mock_minutes;

-- name: SubmitInterviewerApplication :one
-- Idempotent: if there's already a pending row for the user, return it
-- (the partial unique index would otherwise fire 23505). Approved/
-- rejected history rows do not block re-application.
INSERT INTO interviewer_applications(user_id, motivation)
VALUES ($1, $2)
ON CONFLICT (user_id) WHERE status = 'pending' DO UPDATE
   SET motivation = EXCLUDED.motivation
RETURNING id, user_id, motivation, status, reviewed_by, reviewed_at, decision_note, created_at;

-- name: GetMyInterviewerApplication :one
-- Most-recent application for the user (any status).
SELECT id, user_id, motivation, status, reviewed_by, reviewed_at, decision_note, created_at
  FROM interviewer_applications
 WHERE user_id = $1
 ORDER BY created_at DESC
 LIMIT 1;

-- name: ListInterviewerApplications :many
-- Admin queue. Sorted oldest-first inside a status group so the FIFO
-- principle is obvious to moderators.
SELECT a.id, a.user_id, a.motivation, a.status, a.reviewed_by, a.reviewed_at, a.decision_note, a.created_at,
       u.username::text AS user_username, COALESCE(u.display_name, '')::text AS user_display_name
  FROM interviewer_applications a
  JOIN users u ON u.id = a.user_id
 WHERE a.status = $1
 ORDER BY a.created_at ASC
 LIMIT 200;

-- name: GetInterviewerApplicationByID :one
SELECT id, user_id, motivation, status, reviewed_by, reviewed_at, decision_note, created_at
  FROM interviewer_applications
 WHERE id = $1;

-- name: ApproveInterviewerApplication :one
UPDATE interviewer_applications
   SET status = 'approved',
       reviewed_by = $2,
       reviewed_at = now(),
       decision_note = $3
 WHERE id = $1
   AND status = 'pending'
RETURNING id, user_id, motivation, status, reviewed_by, reviewed_at, decision_note, created_at;

-- name: RejectInterviewerApplication :one
UPDATE interviewer_applications
   SET status = 'rejected',
       reviewed_by = $2,
       reviewed_at = now(),
       decision_note = $3
 WHERE id = $1
   AND status = 'pending'
RETURNING id, user_id, motivation, status, reviewed_by, reviewed_at, decision_note, created_at;
