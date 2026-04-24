-- Queries consumed by sqlc; mirror the hand-rolled pgx code in infra/postgres.go.

-- name: GetProfileBundle :one
SELECT u.id, u.email, u.username, u.role, u.locale, u.display_name, u.created_at,
       p.char_class, p.level, p.xp, p.title, p.avatar_frame,
       p.career_stage, p.intellect, p.strength, p.dexterity, p.will, p.updated_at,
       s.plan, s.status, s.current_period_end,
       c.balance
  FROM users u
  JOIN profiles p           ON p.user_id = u.id
  LEFT JOIN subscriptions s ON s.user_id = u.id
  LEFT JOIN ai_credits c    ON c.user_id = u.id
 WHERE u.id = $1;

-- name: GetProfilePublic :one
SELECT u.id, u.username, u.display_name, u.created_at,
       p.char_class, p.level, p.xp, p.title, p.avatar_frame, p.career_stage
  FROM users u
  JOIN profiles p ON p.user_id = u.id
 WHERE u.username = $1;

-- name: EnsureProfile :exec
INSERT INTO profiles(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureSubscription :exec
INSERT INTO subscriptions(user_id, plan, status) VALUES ($1, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureAICredits :exec
INSERT INTO ai_credits(user_id, balance) VALUES ($1, 0)
  ON CONFLICT (user_id) DO NOTHING;

-- name: EnsureNotificationPrefs :exec
INSERT INTO notification_preferences(user_id) VALUES ($1)
  ON CONFLICT (user_id) DO NOTHING;

-- name: UpdateProfileXPLevel :exec
UPDATE profiles
   SET level = $2, xp = $3, updated_at = now()
 WHERE user_id = $1;

-- name: UpdateCareerStage :exec
UPDATE profiles SET career_stage = $2, updated_at = now() WHERE user_id = $1;

-- name: ListSkillNodes :many
SELECT node_key, progress, unlocked_at, decayed_at, updated_at
  FROM skill_nodes WHERE user_id = $1;

-- name: ListRatings :many
SELECT section, elo, matches_count, last_match_at
  FROM ratings WHERE user_id = $1;

-- name: CountWeeklyActivity :one
SELECT
  (SELECT COUNT(*)::int FROM daily_kata_history dkh WHERE dkh.user_id = $1 AND dkh.passed = true AND dkh.submitted_at >= $2)::int AS katas_passed,
  (SELECT COUNT(*)::int FROM arena_matches m
     JOIN arena_participants ap ON ap.match_id = m.id
    WHERE ap.user_id = $1 AND m.winner_id = $1 AND m.finished_at >= $2)::int AS matches_won,
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
