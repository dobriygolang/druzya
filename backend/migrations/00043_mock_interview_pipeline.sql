-- Phase-4 ADR-002 — mock-interview as killer feature: full data model.
--
-- Drives the multi-stage interview pipeline:
--   companies → company_stages (per-company config)
--   mock_tasks (with structured reference answers)
--   task_questions (interviewer follow-ups per task)
--   stage_default_questions + company_questions (HR / behavioral overlays)
--   mock_pipelines (one per user attempt)
--     → pipeline_stages (HR/algo/coding/sysdesign/behavioral instances)
--       → pipeline_attempts (each task solve / question answer)
--   ai_strictness_profiles (admin-tunable judge config, default + per-task)
--
-- Design notes:
--   * `must_mention` / `nice_to_have` / `common_pitfalls` stored as JSONB —
--     admin fills via structured form, AI judge consumes deterministically.
--   * `ai_strictness_profile_id` on tasks AND on companies (cascade fallback:
--     task → company → global default).
--   * `mock_pipelines.ai_assist` mirrors the per-session field added in
--     migration 00040 — pipeline propagates the choice to every session.
--   * No SOFT-DELETE for tasks/questions: we use `active boolean` so admin
--     can pause without breaking historical pipeline_attempts FK chains.

-- +goose Up

-- ─── companies (extend existing 00003 table — DON'T recreate) ────────────
-- 00003 already created `companies(id, slug, name, difficulty, min_level_required,
-- sections, created_at)` with 5 seeded rows (avito/vk/t-bank/ozon/yandex)
-- and downstream FK from tasks / mock sessions. We extend with the columns
-- this feature needs without touching legacy fields.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS logo_url    text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS active      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_companies_active_sort ON companies(active, sort_order)
  WHERE active = true;

-- ─── ai_strictness_profiles (admin-tunable judge config) ─────────────────
-- A profile = parameter set for the LLM-judge. Admin can clone "default"
-- and tweak strictness per company or per task.
CREATE TABLE ai_strictness_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  name               text NOT NULL,
  -- Multipliers / penalties (0..1 floats). Final score =
  --   correctness × (1 - water_score × off_topic_penalty)
  --   - missed_must_mention × must_mention_penalty
  --   - hallucination × hallucination_penalty
  off_topic_penalty       real NOT NULL DEFAULT 0.30,
  must_mention_penalty    real NOT NULL DEFAULT 0.20,
  hallucination_penalty   real NOT NULL DEFAULT 0.50,
  -- "Default to FAIL unless reference is matched" — sets temperature/strictness
  -- in prompt template.
  bias_toward_fail        boolean NOT NULL DEFAULT true,
  -- Optional: custom judge-prompt override per profile. NULL = use built-in.
  custom_prompt_template  text,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Seed the default profile so other tables can reference it.
INSERT INTO ai_strictness_profiles (slug, name, off_topic_penalty, must_mention_penalty, hallucination_penalty, bias_toward_fail)
VALUES ('default', 'Default — strict, reference-grounded', 0.30, 0.20, 0.50, true);

-- ─── mock_tasks (algo / coding / sysdesign tasks with reference) ─────────
-- HR & behavioral don't need tasks (only questions); they reference
-- stage_default_questions instead.
CREATE TYPE mock_stage_kind AS ENUM ('hr', 'algo', 'coding', 'sysdesign', 'behavioral');
CREATE TYPE mock_task_language AS ENUM ('go', 'python', 'sql', 'any');

CREATE TABLE mock_tasks (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_kind                  mock_stage_kind NOT NULL,
  language                    mock_task_language NOT NULL DEFAULT 'any',
  difficulty                  smallint NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
  title                       text NOT NULL,
  body_md                     text NOT NULL,
  -- For algo/coding: input/output samples in JSON or markdown table.
  sample_io_md                text NOT NULL DEFAULT '',
  -- Structured reference for the AI judge. JSONB shape:
  --   {
  --     "must_mention":      ["O(n log n)", "heap-based approach"],
  --     "nice_to_have":      ["edge case: empty input"],
  --     "common_pitfalls":   ["O(n²) brute-force", "int overflow"]
  --   }
  reference_criteria          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form reference solution shown to admin for context, also fed to
  -- the LLM as ground-truth. Markdown.
  reference_solution_md       text NOT NULL DEFAULT '',
  -- For sysdesign: list of functional requirements baked into the task.
  -- For algo/coding: usually empty.
  functional_requirements_md  text NOT NULL DEFAULT '',
  time_limit_min              integer NOT NULL DEFAULT 30,
  -- Per-task strictness override. NULL = inherit from company → global default.
  ai_strictness_profile_id    uuid REFERENCES ai_strictness_profiles(id) ON DELETE SET NULL,
  active                      boolean NOT NULL DEFAULT true,
  created_by_admin_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mock_tasks_stage_active ON mock_tasks(stage_kind, language, active)
  WHERE active = true;

-- ─── task_questions (interviewer follow-ups per task) ────────────────────
CREATE TABLE task_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
  body                text NOT NULL,
  expected_answer_md  text NOT NULL DEFAULT '',
  reference_criteria  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_questions_task ON task_questions(task_id, sort_order);

-- ─── stage_default_questions (HR / behavioral universal pool) ────────────
CREATE TABLE stage_default_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_kind          mock_stage_kind NOT NULL,
  body                text NOT NULL,
  expected_answer_md  text NOT NULL DEFAULT '',
  reference_criteria  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active              boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stage_default_questions_kind ON stage_default_questions(stage_kind, active)
  WHERE active = true;

-- ─── company_questions (per-company HR / behavioral overlays) ────────────
CREATE TABLE company_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage_kind          mock_stage_kind NOT NULL,
  body                text NOT NULL,
  expected_answer_md  text NOT NULL DEFAULT '',
  reference_criteria  jsonb NOT NULL DEFAULT '{}'::jsonb,
  active              boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_company_questions_co_kind ON company_questions(company_id, stage_kind, active)
  WHERE active = true;

-- ─── company_stages (which stages run for each company, in what order) ───
CREATE TABLE company_stages (
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage_kind    mock_stage_kind NOT NULL,
  ordinal       smallint NOT NULL,
  optional      boolean NOT NULL DEFAULT false,
  -- Allowed languages for coding stage. NULL = pull from task language.
  language_pool mock_task_language[] NOT NULL DEFAULT ARRAY[]::mock_task_language[],
  -- If non-empty, restrict task picker to this whitelist. Otherwise pick
  -- from ALL active mock_tasks for stage_kind + language.
  task_pool_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  -- Per-company strictness override. NULL = global default.
  ai_strictness_profile_id uuid REFERENCES ai_strictness_profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (company_id, stage_kind)
);
CREATE INDEX idx_company_stages_company_ordinal ON company_stages(company_id, ordinal);

-- ─── mock_pipelines (one per user attempt) ───────────────────────────────
CREATE TYPE mock_pipeline_verdict AS ENUM ('in_progress', 'pass', 'fail', 'cancelled');

CREATE TABLE mock_pipelines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL when "random mode" — orchestrator picks tasks from the global
  -- active pool ignoring company_stages.
  company_id         uuid REFERENCES companies(id) ON DELETE SET NULL,
  ai_assist          boolean NOT NULL DEFAULT false,
  current_stage_idx  smallint NOT NULL DEFAULT 0,
  verdict            mock_pipeline_verdict NOT NULL DEFAULT 'in_progress',
  total_score        real,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz
);
CREATE INDEX idx_mock_pipelines_user_started ON mock_pipelines(user_id, started_at DESC);
CREATE INDEX idx_mock_pipelines_active ON mock_pipelines(user_id)
  WHERE verdict = 'in_progress';

-- ─── pipeline_stages (one row per stage instance in a pipeline) ──────────
CREATE TYPE pipeline_stage_status AS ENUM ('pending', 'in_progress', 'finished', 'skipped');
CREATE TYPE pipeline_stage_verdict AS ENUM ('pass', 'fail', 'borderline');

CREATE TABLE pipeline_stages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     uuid NOT NULL REFERENCES mock_pipelines(id) ON DELETE CASCADE,
  stage_kind      mock_stage_kind NOT NULL,
  ordinal         smallint NOT NULL,
  status          pipeline_stage_status NOT NULL DEFAULT 'pending',
  score           real,
  verdict         pipeline_stage_verdict,
  ai_feedback_md  text,
  -- Captured snapshot of the strictness profile at stage start so admin
  -- changes don't retroactively rescore old pipelines.
  ai_strictness_profile_id uuid REFERENCES ai_strictness_profiles(id) ON DELETE SET NULL,
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (pipeline_id, ordinal)
);
CREATE INDEX idx_pipeline_stages_pipeline_status ON pipeline_stages(pipeline_id, status);

-- ─── pipeline_attempts (one row per task solve / question answer) ────────
CREATE TYPE pipeline_attempt_kind AS ENUM (
  'task_solve',          -- algo/coding/sysdesign task submission
  'question_answer',     -- HR/behavioral question reply OR follow-up after task
  'sysdesign_canvas',    -- excalidraw image + context_md
  'voice_answer'         -- v2: voice transcript
);
CREATE TYPE pipeline_attempt_verdict AS ENUM ('pass', 'fail', 'borderline', 'pending');

CREATE TABLE pipeline_attempts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_stage_id           uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  kind                        pipeline_attempt_kind NOT NULL,
  task_id                     uuid REFERENCES mock_tasks(id) ON DELETE SET NULL,
  task_question_id            uuid REFERENCES task_questions(id) ON DELETE SET NULL,
  default_question_id         uuid REFERENCES stage_default_questions(id) ON DELETE SET NULL,
  company_question_id         uuid REFERENCES company_questions(id) ON DELETE SET NULL,
  user_answer_md              text,
  user_voice_url              text,
  user_excalidraw_image_url   text,
  user_context_md             text,
  -- AI judge output
  ai_score                    real,
  ai_verdict                  pipeline_attempt_verdict NOT NULL DEFAULT 'pending',
  ai_feedback_md              text,
  ai_water_score              real,
  ai_missing_points           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_judged_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pipeline_attempts_stage ON pipeline_attempts(pipeline_stage_id, created_at);
-- Exactly one of (task_id, task_question_id, default_question_id, company_question_id) should be set;
-- enforce via partial unique index when needed; for now keep flexible.

-- ─── seed: v1 companies (UPSERT — 5 already exist from 00003) ───────────
-- difficulty/min_level_required/sections are 00003 NOT NULL columns;
-- supply sane defaults so INSERT succeeds for new rows. Existing rows
-- (avito/vk/t-bank/ozon/yandex) keep their original values, only get new
-- sort_order / active / description set.
--
-- Note: 00003 has slug='t-bank' (with dash); v1-list uses 'tbank' (no
-- dash) for T-Bank. Reusing 't-bank' to avoid duplicate company under two
-- slugs. This is the canonical T-Bank row.
INSERT INTO companies (slug, name, difficulty, min_level_required, sections, sort_order)
VALUES
  ('yandex',  'Yandex',  'boss',   30, ARRAY['algorithms','sql','go','system_design','behavioral'],  10),
  ('google',  'Google',  'boss',   30, ARRAY['algorithms','system_design','behavioral'],             20),
  ('ozon',    'Ozon',    'hard',   10, ARRAY['algorithms','sql','go','system_design','behavioral'],  30),
  ('wb',      'WB',      'hard',   10, ARRAY['algorithms','sql','go','system_design','behavioral'],  40),
  ('vk',      'VK',      'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral'],  50),
  ('avito',   'Avito',   'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral'],  60),
  ('tinkoff', 'Tinkoff', 'hard',   10, ARRAY['algorithms','sql','go','system_design','behavioral'],  70),
  ('t-bank',  'T-Bank',  'hard',   12, ARRAY['algorithms','sql','go','system_design','behavioral'],  80),
  ('sber',    'Sber',    'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral'],  90),
  ('meta',    'Meta',    'boss',   30, ARRAY['algorithms','system_design','behavioral'],            100)
ON CONFLICT (slug) DO UPDATE
SET name        = EXCLUDED.name,
    sort_order  = EXCLUDED.sort_order,
    active      = true;

-- +goose Down
-- DON'T drop `companies` — 00003 owns it, downstream FKs still reference.
-- Just remove the columns we added.
DROP TABLE IF EXISTS pipeline_attempts;
DROP TABLE IF EXISTS pipeline_stages;
DROP TABLE IF EXISTS mock_pipelines;
DROP TABLE IF EXISTS company_stages;
DROP TABLE IF EXISTS company_questions;
DROP TABLE IF EXISTS stage_default_questions;
DROP TABLE IF EXISTS task_questions;
DROP TABLE IF EXISTS mock_tasks;
DROP TABLE IF EXISTS ai_strictness_profiles;

ALTER TABLE companies
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS active,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS updated_at;
DROP INDEX IF EXISTS idx_companies_active_sort;

DROP TYPE IF EXISTS pipeline_attempt_verdict;
DROP TYPE IF EXISTS pipeline_attempt_kind;
DROP TYPE IF EXISTS pipeline_stage_verdict;
DROP TYPE IF EXISTS pipeline_stage_status;
DROP TYPE IF EXISTS mock_pipeline_verdict;
DROP TYPE IF EXISTS mock_task_language;
DROP TYPE IF EXISTS mock_stage_kind;
