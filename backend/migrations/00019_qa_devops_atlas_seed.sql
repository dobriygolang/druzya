-- +goose Up
-- +goose StatementBegin

-- 00019_qa_devops_atlas_seed.sql
--
-- Wave 9.2 + 9.3 of docs/feature/plan.md — Atlas seed для QA и DevOps
-- треков. Mirrors 00018_analyst_atlas_seed.sql:
--   * 6 sub-skills + branch hub per трек
--   * sort_order 500-599 для QA, 600-699 для DevOps (00011 reserved)
--   * track_kind values: 'qa' уже в enum'е (00001 baseline);
--     'devops' добавляем здесь (Postgres ALTER TYPE ADD VALUE
--     additive, не блокирующая операция).
--
-- Sections подобраны под существующие mock-rubric'и:
--   QA: 'behavioral' для test-design / process; 'sql' для api;
--       'system_design' для automation. Cluster `qa`.
--   DevOps: 'system_design' для infra/observability/cicd/security;
--           'behavioral' для incident response. Cluster `devops`.

-- ── DevOps в track_kind enum (additive — IF NOT EXISTS защита)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'devops'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'track_kind')
    ) THEN
        ALTER TYPE track_kind ADD VALUE 'devops';
    END IF;
END $$;

-- +goose StatementEnd
-- +goose StatementBegin

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- ─── QA / тестировщик (6 sub-skills + branch hub) ───
    ('qa_root',          'QA / тестировщик',       'behavioral',    'hub',      'qa',     'Точка входа в QA-трек',                                       0, 500, 'qa'),
    ('qa_test_design',   'Test design',            'behavioral',    'keystone', 'qa',     'Boundary, equivalence, decision tables, pairwise',            0, 501, 'qa'),
    ('qa_api',           'API testing',            'sql',           'notable',  'qa',     'REST/contract tests, idempotency, auth edge cases',           0, 502, 'qa'),
    ('qa_automation',    'Test automation',        'system_design', 'notable',  'qa',     'Selenium/Playwright/pytest, page objects, flake hunting',     0, 503, 'qa'),
    ('qa_bug_analysis',  'Bug analysis & RCA',     'behavioral',    'small',    'qa',     'Root-cause analysis, severity vs priority, repro discipline', 0, 504, 'qa'),
    ('qa_process',       'Process & strategy',     'behavioral',    'small',    'qa',     'Test plans, coverage strategy, risk-based prioritisation',    0, 505, 'qa'),
    ('qa_performance',   'Performance / load',     'system_design', 'small',    'qa',     'Load testing tools, scaling tests, perf SLI design',          0, 506, 'qa'),

    -- ─── DevOps / SRE (6 sub-skills + branch hub) ───
    ('do_root',          'DevOps / SRE',           'system_design', 'hub',      'devops', 'Точка входа в DevOps-трек',                                   0, 600, 'devops'),
    ('do_infra',         'Infrastructure',         'system_design', 'keystone', 'devops', 'Containers, k8s, IaC (Terraform/Pulumi), capacity planning', 0, 601, 'devops'),
    ('do_observability', 'Observability & SLO',    'system_design', 'keystone', 'devops', 'Metrics/tracing/logs, SLO/SLI, cardinality awareness',        0, 602, 'devops'),
    ('do_cicd',          'CI/CD pipelines',        'system_design', 'notable',  'devops', 'Blue-green/canary/rolling, secrets, rollback strategy',       0, 603, 'devops'),
    ('do_incident',      'Incident response',      'behavioral',    'notable',  'devops', 'Runbooks, post-mortems, error budgets, on-call rotation',     0, 604, 'devops'),
    ('do_security',      'Platform security',      'system_design', 'small',    'devops', 'Secrets rotation, network policy, vulnerability triage',      0, 605, 'devops'),
    ('do_cloud',         'Cloud-provider depth',   'system_design', 'small',    'devops', 'AWS/GCP/Azure-specific: IAM, networking, managed services',   0, 606, 'devops')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    -- QA branch
    ('qa_root', 'qa_test_design'),
    ('qa_root', 'qa_api'),
    ('qa_root', 'qa_automation'),
    ('qa_root', 'qa_bug_analysis'),
    ('qa_root', 'qa_process'),
    ('qa_root', 'qa_performance'),

    -- DevOps branch
    ('do_root', 'do_infra'),
    ('do_root', 'do_observability'),
    ('do_root', 'do_cicd'),
    ('do_root', 'do_incident'),
    ('do_root', 'do_security'),
    ('do_root', 'do_cloud')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
