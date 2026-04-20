-- Queries consumed by sqlc; mirror hand-rolled pgx in infra/postgres.go.
-- CRITICAL: solution_hint is ONLY selected by GetNativeTaskWithHint — never
-- by any query whose result is shown to the client.

-- name: CreateNativeSession :one
INSERT INTO native_sessions (
    user_id, task_id, section, difficulty, llm_model
) VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, task_id, section, difficulty, llm_model,
          context_score, verification_score, judgment_score, delivery_score,
          started_at, finished_at;

-- name: GetNativeSession :one
SELECT id, user_id, task_id, section, difficulty, llm_model,
       context_score, verification_score, judgment_score, delivery_score,
       started_at, finished_at
  FROM native_sessions
 WHERE id = $1;

-- name: UpdateNativeSessionScores :execrows
UPDATE native_sessions
   SET context_score      = $2,
       verification_score = $3,
       judgment_score     = $4,
       delivery_score     = $5
 WHERE id = $1;

-- name: MarkNativeSessionFinished :execrows
UPDATE native_sessions
   SET context_score      = $2,
       verification_score = $3,
       judgment_score     = $4,
       delivery_score     = $5,
       finished_at        = now()
 WHERE id = $1
   AND finished_at IS NULL;

-- name: InsertNativeProvenance :one
INSERT INTO native_provenance (
    session_id, parent_id, kind, snippet, ai_prompt, has_hallucination_trap
) VALUES ($1, $2, $3, $4, NULLIF($5::text, ''), $6)
RETURNING id, session_id, parent_id, kind, snippet, ai_prompt,
          has_hallucination_trap, verified_at, created_at;

-- name: GetNativeProvenance :one
SELECT id, session_id, parent_id, kind, snippet, ai_prompt,
       has_hallucination_trap, verified_at, created_at
  FROM native_provenance
 WHERE id = $1;

-- name: ListNativeProvenance :many
SELECT id, session_id, parent_id, kind, snippet, ai_prompt,
       has_hallucination_trap, verified_at, created_at
  FROM native_provenance
 WHERE session_id = $1
 ORDER BY created_at ASC;

-- name: MarkNativeProvenanceVerified :execrows
UPDATE native_provenance
   SET kind        = $2,
       verified_at = now()
 WHERE id = $1;

-- name: PickNativeTask :one
-- Internal: returns TaskWithHint. See ai_mock's equivalent for the same
-- information-leak caveat.
SELECT id, slug, title_ru, description_ru, difficulty, section, solution_hint
  FROM tasks
 WHERE is_active = true AND section = $1 AND difficulty = $2
 ORDER BY random()
 LIMIT 1;

-- name: GetNativeTaskWithHint :one
SELECT id, slug, title_ru, description_ru, difficulty, section, solution_hint
  FROM tasks
 WHERE id = $1;

-- name: GetNativeUserSubscription :one
SELECT plan
  FROM subscriptions
 WHERE user_id = $1;
