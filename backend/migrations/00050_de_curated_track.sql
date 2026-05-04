-- 00050_de_curated_track.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- Curated DE-track: tracks row + 9 track_steps по порядку освоения.
-- Steps — sequences-of-resources (recommended_reading TEXT[] остаётся
-- пустым, реальный контент придёт через external_resources jsonb из
-- 00051 + cmd/seed_resources в Phase 1b).
--
-- Финальный шаг — mock через services/ai_mock DE-pool (Phase 1c).
-- Curation principle: своих кат / codex'ов под DE не пишем —
-- ranking-proxy на DDIA / Spark docs / Kimball / dbt / mlcourse §SQL.
--
-- 2026-05-04 step UX update: миграция также добавляет на track_steps
-- 3 колонки под новый flow «resources → reflection → checkpoint →
-- optional graduation mock» (см implementation-plan.md §Phase 1a):
--   * checkpoint_skill_keys text[] — какие skill-теги юзаются для
--     5-question checkpoint quiz из mock_pool. Default = skill_keys
--     самого step'а (заполняется явно при INSERT).
--   * reflection_required boolean — обязать reflection после core
--     resource (auto-creates Note + auto-link на atlas-node через
--     TaskReflectionExtract в Phase 5).
--   * graduation_mock_section text — section enum value (`'de'`,
--     `'ml_eng'`, …) для optional graduation AI-mock; NULL = шаг
--     закрывается checkpoint'ом без полного mock'а.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE track_steps
    ADD COLUMN IF NOT EXISTS checkpoint_skill_keys TEXT[]    NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS reflection_required   BOOLEAN   NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS graduation_mock_section TEXT    NULL;

COMMENT ON COLUMN track_steps.checkpoint_skill_keys IS 'Skill tags для checkpoint quiz (5 questions из mock_pool). Empty = step без checkpoint (e.g. сам step — mock).';
COMMENT ON COLUMN track_steps.reflection_required   IS 'Если true — после core resource UI открывает 1-line reflection-modal. Submit auto-creates Note linked на atlas-node.';
COMMENT ON COLUMN track_steps.graduation_mock_section IS 'enums.Section value для optional graduation AI-mock после step. NULL = closed by checkpoint.';

INSERT INTO tracks (slug, name, tagline, description_md, accent_color,
                    estimated_weeks, difficulty, is_curated, tags, company_focus)
VALUES
  ('data-engineering-senior',
   'Data Engineering · senior',
   'От SQL до streaming + Spark',
   '9 шагов под DE-собес: dimensional modeling → SQL optimization → ETL/orchestration → warehouses → streaming → Spark → data quality → финальный mock с 5-axis rubric.',
   '#FFFFFF', 9, 'hard', TRUE,
   ARRAY['data_engineering', 'core'], ARRAY[]::text[])
ON CONFLICT (slug) DO NOTHING;

INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes,
                         checkpoint_skill_keys, reflection_required, graduation_mock_section)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes,
       x.checkpoint_skill_keys, x.reflection_required, x.graduation_mock_section
  FROM tracks t,
       (VALUES
         (0, 'SQL · plans, joins, window functions',
             'EXPLAIN ANALYZE, hash vs merge vs nested loop, window-functions для аналитики, CTE optimization.',
             ARRAY['sql', 'sql_optimization'],            'focus_block', 1, 90,
             ARRAY['sql', 'sql_optimization'],            TRUE,  NULL::text),

         (1, 'Dimensional modeling · Kimball',
             'Star/snowflake, fact-grain, conformed dims, SCD type 1/2/3, surrogate keys.',
             ARRAY['data_modeling', 'kimball'],            'focus_block', 1, 90,
             ARRAY['data_modeling', 'kimball'],            TRUE,  NULL),

         (2, 'ETL / ELT pipelines',
             'Идемпотентность, late-arriving data, backfill стратегии, incremental vs full refresh, change data capture.',
             ARRAY['etl', 'pipelines'],                    'focus_block', 1, 90,
             ARRAY['etl', 'pipelines'],                    TRUE,  NULL),

         (3, 'Data warehouses',
             'Snowflake / BigQuery / ClickHouse: storage layout, partitioning, clustering, materialized views, cost optimization.',
             ARRAY['warehouse', 'snowflake', 'bigquery'],  'focus_block', 1, 90,
             ARRAY['warehouse', 'snowflake', 'bigquery'],  TRUE,  NULL),

         (4, 'Orchestration · Airflow / Dagster',
             'DAG design, retries, SLA, sensors, dynamic task mapping, lineage hooks.',
             ARRAY['airflow', 'dagster', 'orchestration'], 'focus_block', 1, 75,
             ARRAY['orchestration'],                       TRUE,  NULL),

         (5, 'Streaming · Kafka + windowing',
             'Exactly-once semantics, watermarks, tumbling/sliding/session windows, backpressure, dead-letter queues.',
             ARRAY['kafka', 'streaming'],                  'focus_block', 1, 90,
             ARRAY['kafka', 'streaming'],                  TRUE,  'de'),

         (6, 'Spark · shuffle, skew, AQE',
             'Broadcast vs shuffle joins, partition cardinality, salting под skew, Adaptive Query Execution.',
             ARRAY['spark', 'distributed'],                'focus_block', 1, 90,
             ARRAY['spark', 'distributed'],                TRUE,  NULL),

         (7, 'Data quality · contracts + tests',
             'Great Expectations, dbt tests, schema evolution, data contracts, freshness SLAs.',
             ARRAY['data_quality', 'dbt'],                 'focus_block', 1, 60,
             ARRAY['data_quality'],                        TRUE,  NULL),

         (8, 'Mock · DE-собес 5-axis',
             'Полный DE-мок: etl_design / distributed / sql_modeling / streaming / production_ops.',
             ARRAY['data_engineering'],                    'mock', 1, 75,
             ARRAY[]::text[],                              FALSE, NULL)
       ) AS x(step_index, title, description_md, skill_keys,
              required_kind, required_count, estimated_minutes,
              checkpoint_skill_keys, reflection_required, graduation_mock_section)
 WHERE t.slug = 'data-engineering-senior'
ON CONFLICT (track_id, step_index) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM track_steps
 WHERE track_id IN (SELECT id FROM tracks WHERE slug = 'data-engineering-senior');

DELETE FROM tracks WHERE slug = 'data-engineering-senior';

-- ALTER columns не дропаем в Down — 00052_ml_curated_track зависит от
-- этих колонок при вставке своих steps. Если действительно нужен
-- полный rollback — отдельной миграцией после rollback'а 00052.
-- +goose StatementEnd
