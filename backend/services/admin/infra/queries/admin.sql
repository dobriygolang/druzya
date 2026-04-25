-- Queries consumed by sqlc for the admin domain.
--
-- NOTE: the task-listing and anticheat-listing endpoints require optional
-- predicates (section, difficulty, is_active / severity, from). sqlc cannot
-- elegantly model a WHERE clause that flips predicates in and out, so those
-- two are hand-rolled in postgres.go (same pattern as slot/daily). Every
-- other query in this file is sqlc-generated.
--
-- The admin domain is the ONLY caller that reads tasks.solution_hint off the
-- API boundary (bible §3.14). Other domains use TaskPublic projections.

-- ─────────────────────────────────────────────────────────────────────────
-- Tasks
-- ─────────────────────────────────────────────────────────────────────────

-- name: GetTaskByID :one
SELECT id, slug, title_ru, title_en, description_ru, description_en,
       difficulty, section, time_limit_sec, memory_limit_mb,
       solution_hint, version, is_active, created_at, updated_at
  FROM tasks
 WHERE id = $1;

-- name: CountTasksBase :one
SELECT COUNT(*)::bigint AS total FROM tasks;

-- name: CreateTask :one
INSERT INTO tasks (
    slug, title_ru, title_en, description_ru, description_en,
    difficulty, section, time_limit_sec, memory_limit_mb,
    solution_hint, is_active
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, slug, title_ru, title_en, description_ru, description_en,
          difficulty, section, time_limit_sec, memory_limit_mb,
          solution_hint, version, is_active, created_at, updated_at;

-- name: UpdateTask :one
-- Version is bumped monotonically on every UPDATE so downstream caches
-- (editor task cache / ai-mock prompt cache) can detect a task edit.
UPDATE tasks
   SET slug            = $2,
       title_ru        = $3,
       title_en        = $4,
       description_ru  = $5,
       description_en  = $6,
       difficulty      = $7,
       section         = $8,
       time_limit_sec  = $9,
       memory_limit_mb = $10,
       solution_hint   = $11,
       is_active       = $12,
       version         = version + 1,
       updated_at      = now()
 WHERE id = $1
RETURNING id, slug, title_ru, title_en, description_ru, description_en,
          difficulty, section, time_limit_sec, memory_limit_mb,
          solution_hint, version, is_active, created_at, updated_at;

-- name: DeleteTestCases :exec
DELETE FROM test_cases WHERE task_id = $1;

-- name: InsertTestCase :one
INSERT INTO test_cases (task_id, input, expected_output, is_hidden, order_num)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, task_id, input, expected_output, is_hidden, order_num;

-- name: ListTestCases :many
SELECT id, task_id, input, expected_output, is_hidden, order_num
  FROM test_cases
 WHERE task_id = $1
 ORDER BY order_num ASC, id ASC;

-- name: DeleteTaskTemplates :exec
DELETE FROM task_templates WHERE task_id = $1;

-- name: UpsertTaskTemplate :exec
INSERT INTO task_templates (task_id, language, starter_code)
VALUES ($1, $2, $3)
ON CONFLICT (task_id, language) DO UPDATE SET starter_code = EXCLUDED.starter_code;

-- name: ListTaskTemplates :many
SELECT task_id, language, starter_code
  FROM task_templates
 WHERE task_id = $1
 ORDER BY language ASC;

-- name: DeleteFollowUpQuestions :exec
DELETE FROM follow_up_questions WHERE task_id = $1;

-- name: InsertFollowUpQuestion :one
INSERT INTO follow_up_questions (task_id, question_ru, question_en, answer_hint, order_num)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, task_id, question_ru, question_en, answer_hint, order_num;

-- name: ListFollowUpQuestions :many
SELECT id, task_id, question_ru, question_en, answer_hint, order_num
  FROM follow_up_questions
 WHERE task_id = $1
 ORDER BY order_num ASC, id ASC;

-- ─────────────────────────────────────────────────────────────────────────
-- Companies
-- ─────────────────────────────────────────────────────────────────────────

-- name: ListCompanies :many
-- companies теперь живут под mock-interview pipeline shape
-- (logo_url/description/active/sort_order — см. 00043). Старая
-- difficulty/min_level_required/sections больше не существует, в отличие
-- от arena-фазы. Sort by sort_order чтобы куратор управлял порядком на
-- mock-interview витрине.
SELECT id, slug, name, logo_url, description, active, sort_order, created_at
  FROM companies
 ORDER BY sort_order ASC, name ASC;

-- name: UpsertCompany :one
-- Curator edit-by-slug flow. Туннель такой же простой как раньше — name +
-- logo_url + description + active. sort_order/created_at управляются БД.
INSERT INTO companies (slug, name, logo_url, description, active)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (slug) DO UPDATE
    SET name        = EXCLUDED.name,
        logo_url    = EXCLUDED.logo_url,
        description = EXCLUDED.description,
        active      = EXCLUDED.active,
        updated_at  = now()
RETURNING id, slug, name, logo_url, description, active, sort_order, created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- Dynamic config
-- ─────────────────────────────────────────────────────────────────────────

-- name: ListDynamicConfig :many
SELECT key, value, type, description, updated_at, updated_by
  FROM dynamic_config
 ORDER BY key ASC;

-- name: GetDynamicConfig :one
SELECT key, value, type, description, updated_at, updated_by
  FROM dynamic_config
 WHERE key = $1;

-- name: UpsertDynamicConfig :one
INSERT INTO dynamic_config (key, value, type, description, updated_at, updated_by)
VALUES ($1, $2, $3, $4, now(), $5)
ON CONFLICT (key) DO UPDATE
    SET value       = EXCLUDED.value,
        type        = EXCLUDED.type,
        description = COALESCE(EXCLUDED.description, dynamic_config.description),
        updated_at  = now(),
        updated_by  = EXCLUDED.updated_by
RETURNING key, value, type, description, updated_at, updated_by;

-- ─────────────────────────────────────────────────────────────────────────
-- Anticheat — base-case ordering; filtered variants live in postgres.go.
-- ─────────────────────────────────────────────────────────────────────────

-- name: ListAnticheatSignalsBase :many
SELECT s.id, s.user_id, u.username, s.match_id, s.type, s.severity,
       s.metadata, s.created_at
  FROM anticheat_signals s
  LEFT JOIN users u ON u.id = s.user_id
 ORDER BY s.created_at DESC
 LIMIT $1;
