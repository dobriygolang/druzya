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
