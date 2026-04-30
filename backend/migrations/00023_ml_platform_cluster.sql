-- +goose Up
-- +goose StatementBegin

-- 00023_ml_platform_cluster.sql
--
-- ML Platform — отвилка от dev-трека (а не самостоятельный track_kind).
-- Решение Б из обсуждения с Sergey 2026-04-30: вакансии типа «Go ML
-- Platform engineer» по факту требуют «Go senior + узкая ML-обвязка»,
-- базовая system_design / SQL / behavioral rubric'а покрывает 80%.
-- Уникальные оси (Airflow, MLOps practices, model registry, K8s deep,
-- at-least-once на pipeline'ах, Grafana SLO) живут как cluster
-- 'ml_platform' под track_kind='dev'. Это позволяет:
--   * показать узлы только тем юзерам, кто на dev-треке
--   * не дублировать mock rubric'у — вопросы попадают в существующую
--     SECTION_SYSTEM_DESIGN
--   * отфильтровать узлы во фронте `cluster='ml_platform'` без новой
--     enum-метки (ALTER TYPE = тяжёлая операция, см 00019)
--
-- sort_order 700-799 зарезервирован под этот cluster (после 600-699
-- DevOps из 00022). Sections подобраны так:
--   * system_design — для всего платформенного / архитектурного
--     (k8s_deep, model_serving, pipelines, observability)
--   * behavioral — для cross-functional (mlops_practices)
--   * sql — для at-least-once семантики (idempotency keys, outbox)

INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- Hub (виден всем dev-юзерам, но визуально подсвечивается как
    -- «направление» — фронт фильтрует по cluster='ml_platform').
    ('mlplat_root',          'ML Platform (Go)',          'system_design', 'hub',      'ml_platform', 'Платформенный Go: K8s, pipelines, model serving, observability', 0, 700, 'dev'),
    -- Keystones — то, что прямо в требованиях вакансии и без чего
    -- говорить не о чем.
    ('mlplat_k8s_deep',      'K8s deep / debugging',      'system_design', 'keystone', 'ml_platform', 'kubectl debug, operators/CRDs, resource quotas, CRD-based scheduling, kubelet edge cases', 0, 701, 'dev'),
    ('mlplat_atleastonce',   'At-least-once semantics',   'sql',           'keystone', 'ml_platform', 'Idempotency keys, outbox/inbox, dedup tables, Kafka offsets, pipeline retries без double-execution', 0, 702, 'dev'),
    ('mlplat_pipelines',     'ML pipelines & DAGs',       'system_design', 'keystone', 'ml_platform', 'Airflow / собственный graph-engine, перезапуск с учётом code/config/artifact-diff, lineage', 0, 703, 'dev'),
    -- Notable — серьёзные темы, но матчатся в большее число вакансий.
    ('mlplat_model_serving', 'Model registry & serving',  'system_design', 'notable',  'ml_platform', 'Versioning моделей и датасетов, контейнерный реестр для ML, A/B serving, shadow traffic',  0, 704, 'dev'),
    ('mlplat_observability', 'Observability & SLO',       'system_design', 'notable',  'ml_platform', 'Grafana дашборды, метрики утилизации, SLI/SLO для ML-сервисов, инференс-латентность p99', 0, 705, 'dev'),
    -- Small — soft-skill / cross-functional.
    ('mlplat_mlops_practices','MLOps / DS interaction',   'behavioral',    'small',    'ml_platform', 'Что нужно DS-команде, JupyterHub, эксперимент-трекинг, integrations с MLflow/Wandb',     0, 706, 'dev')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    ('mlplat_root', 'mlplat_k8s_deep'),
    ('mlplat_root', 'mlplat_atleastonce'),
    ('mlplat_root', 'mlplat_pipelines'),
    ('mlplat_root', 'mlplat_model_serving'),
    ('mlplat_root', 'mlplat_observability'),
    ('mlplat_root', 'mlplat_mlops_practices')
ON CONFLICT (from_id, to_id) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
