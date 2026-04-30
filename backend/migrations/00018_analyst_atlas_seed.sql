-- +goose Up
-- +goose StatementBegin

-- 00018_analyst_atlas_seed.sql
--
-- Wave 7 + Wave 8 of docs/feature/plan.md — Atlas seed для двух новых
-- треков: системный аналитик (sysanalyst) и product analyst.
--
-- Mirrors 00009_english_atlas_seed.sql и 00011_senior_atlas_seed.sql:
-- бранчует под конкретный `track_kind` (уже существует в enum'е,
-- баseline lines 2065-2066), сорт-orderы 300-399 (sysanalyst) и
-- 400-499 (product_analyst) — пространство зарезервировано в
-- комментарии 00011, теперь занимаем его.
--
-- 6 sub-skill nodes per track + branch hub. Sections для свежих
-- треков:
--   * sysanalyst использует 'system_design' для modeling/integration
--     узлов (closest engineering analogue) + 'sql' для data-design;
--     'behavioral' для process — это та секция, под которую заточена
--     existing rubric «человеческой» оценки. Cluster `sysanalyst`
--     группирует их визуально на Atlas page без необходимости новой
--     section в proto enum'е.
--   * product_analyst — 'sql' для analytical-SQL узлов, 'behavioral'
--     для frameworks/communication, 'system_design' для opportunity
--     sizing (ближе всего по типу reasoning'а). Cluster
--     `product_analyst`.
--
-- Mock-rounds для этих треков — free-form (см `domain/sysanalyst.go`
-- и `product_analyst.go`); прогресс по узлам обновляется агрегатами
-- из mock_sessions.ai_report.sections.{requirements,modeling,...}
-- (та же мехика, что у English HR / Tech Lead).

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- ─── Sysanalyst (6 sub-skills + branch hub) ───
    ('sa_root',           'Sysanalyst',                  'system_design', 'hub',      'sysanalyst', 'Точка входа в трек системного аналитика',                            0, 300, 'sysanalyst'),
    ('sa_requirements',   'Requirements engineering',    'behavioral',    'keystone', 'sysanalyst', 'Eliciting, user stories + Gherkin, NFRs, stakeholder mapping',       0, 301, 'sysanalyst'),
    ('sa_modeling',       'Modeling: UML / BPMN / C4',   'system_design', 'notable',  'sysanalyst', 'Sequence/activity/class/state, BPMN flows, C4 levels',                0, 302, 'sysanalyst'),
    ('sa_integration',    'Integration patterns',        'system_design', 'notable',  'sysanalyst', 'REST/SOAP/gRPC, brokers (Kafka/RabbitMQ), idempotency, sagas, 2PC',   0, 303, 'sysanalyst'),
    ('sa_data',           'Data design & SQL',           'sql',           'notable',  'sysanalyst', 'Schema design + normalisation, transactions/isolation, indexes',     0, 304, 'sysanalyst'),
    ('sa_process',        'Process & BABOK',             'behavioral',    'small',    'sysanalyst', 'Agile ceremonies, DoR/DoD, RACI, BABOK basics',                       0, 305, 'sysanalyst'),
    ('sa_documentation',  'Documentation craft',         'behavioral',    'small',    'sysanalyst', 'SRS (IEEE 830), OpenAPI/Swagger, glossary, ADRs',                     0, 306, 'sysanalyst'),

    -- ─── Product analyst (6 sub-skills + branch hub) ───
    ('pa_root',           'Product analyst',             'sql',           'hub',      'product_analyst', 'Точка входа в трек product-аналитика',                          0, 400, 'product_analyst'),
    ('pa_metrics',        'Product metrics & NSM',       'behavioral',    'keystone', 'product_analyst', 'DAU/MAU/WAU split, retention cohorts, funnels, NSM picks',      0, 401, 'product_analyst'),
    ('pa_sql',            'SQL for analytics',           'sql',           'keystone', 'product_analyst', 'Window functions, cohorts, funnels, anti-joins, ranking',       0, 402, 'product_analyst'),
    ('pa_experimentation','A/B testing fundamentals',    'system_design', 'notable',  'product_analyst', 'Sample size + MDE, CUPED, peeking, sequential vs fixed-horizon',0, 403, 'product_analyst'),
    ('pa_frameworks',     'Prioritisation frameworks',   'behavioral',    'notable',  'product_analyst', 'RICE / ICE / JTBD, opportunity sizing',                         0, 404, 'product_analyst'),
    ('pa_communication',  'Insight communication',       'behavioral',    'small',    'product_analyst', 'Insight memos, exec summaries, dashboard structure',            0, 405, 'product_analyst'),
    ('pa_tooling',        'Analytics tooling',           'system_design', 'small',    'product_analyst', 'Amplitude/Mixpanel/GA, Tableau/Looker, BI semantic layers',     0, 406, 'product_analyst')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    -- Sysanalyst branch
    ('sa_root', 'sa_requirements'),
    ('sa_root', 'sa_modeling'),
    ('sa_root', 'sa_integration'),
    ('sa_root', 'sa_data'),
    ('sa_root', 'sa_process'),
    ('sa_root', 'sa_documentation'),

    -- Product analyst branch
    ('pa_root', 'pa_metrics'),
    ('pa_root', 'pa_sql'),
    ('pa_root', 'pa_experimentation'),
    ('pa_root', 'pa_frameworks'),
    ('pa_root', 'pa_communication'),
    ('pa_root', 'pa_tooling')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB (see baseline policy)
-- +goose StatementEnd
