-- Queries consumed by sqlc; mirror hand-rolled pgx in infra/postgres.go.
-- CRITICAL: solution_hint is ONLY selected by GetTaskWithHint — never by any
-- query whose result is shown to the client.

-- name: CreateMockSession :one
INSERT INTO mock_sessions (
    user_id, company_id, task_id, section, difficulty, status,
    duration_min, voice_mode, paired_user_id, llm_model, started_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, user_id, company_id, task_id, section, difficulty, status,
          duration_min, voice_mode, paired_user_id, llm_model,
          stress_profile, ai_report, replay_url, running_summary,
          started_at, finished_at, created_at;

-- name: GetMockSession :one
SELECT id, user_id, company_id, task_id, section, difficulty, status,
       duration_min, voice_mode, paired_user_id, llm_model,
       stress_profile, ai_report, replay_url, running_summary,
       started_at, finished_at, created_at
  FROM mock_sessions
 WHERE id = $1;

-- name: UpdateMockSessionRunningSummary :execrows
-- Вызывается фоновым compaction.Worker после суммаризации старых turns.
-- См. backend/shared/pkg/compaction/worker.go. Пишем атомарно поверх
-- любого предыдущего значения — решение о запуске принимает воркер.
UPDATE mock_sessions
   SET running_summary = $2
 WHERE id = $1;

-- name: UpdateMockSessionStatus :execrows
UPDATE mock_sessions
   SET status = $2,
       finished_at = CASE WHEN $3::bool THEN now() ELSE finished_at END
 WHERE id = $1;

-- name: UpdateMockSessionStress :execrows
UPDATE mock_sessions
   SET stress_profile = $2::jsonb
 WHERE id = $1;

-- name: UpdateMockSessionReport :execrows
UPDATE mock_sessions
   SET ai_report  = $2::jsonb,
       replay_url = NULLIF($3::text, '')
 WHERE id = $1;

-- name: AppendMockMessage :one
INSERT INTO mock_messages (
    session_id, role, content, code_snapshot, stress_snapshot, tokens_used
) VALUES ($1, $2, $3, NULLIF($4::text, ''), $5, NULLIF($6::int, 0))
RETURNING id, session_id, role, content, code_snapshot, stress_snapshot, tokens_used, created_at;

-- name: ListLastMockMessages :many
SELECT id, session_id, role, content, code_snapshot, stress_snapshot, tokens_used, created_at
  FROM mock_messages
 WHERE session_id = $1
 ORDER BY created_at DESC
 LIMIT $2;

-- name: ListAllMockMessages :many
SELECT id, session_id, role, content, code_snapshot, stress_snapshot, tokens_used, created_at
  FROM mock_messages
 WHERE session_id = $1
 ORDER BY created_at ASC;

-- name: PickTaskForSection :one
-- Internal: returns the task PLUS solution_hint for LLM-only consumption.
-- Client-facing call sites MUST go through the domain's TaskRepo.PickForSession
-- which drops the hint via ToPublic before reaching any DTO.
SELECT id, slug, title_ru, description_ru, difficulty, section, solution_hint
  FROM tasks
 WHERE is_active = true AND section = $1 AND difficulty = $2
 ORDER BY random()
 LIMIT 1;

-- name: GetTaskWithHint :one
-- Same caveat as PickTaskForSection — private to ai_mock's prompt builder.
SELECT id, slug, title_ru, description_ru, difficulty, section, solution_hint
  FROM tasks
 WHERE id = $1;

-- name: GetCompanyForMock :one
SELECT id, name, difficulty
  FROM companies
 WHERE id = $1;

-- name: GetUserSubscription :one
SELECT plan
  FROM subscriptions
 WHERE user_id = $1;
