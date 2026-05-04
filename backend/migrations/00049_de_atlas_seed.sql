-- 00049_de_atlas_seed.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- 12 атлас-узлов под track_kind='de', cluster='de', sort_order 900-911.
-- Контент — ranking-proxy, не self-authored курс: external_resources
-- jsonb (миграция 00051) наполнится через cmd/seed_resources CLI
-- (Phase 1b). Здесь — только skeleton структуры + edges.
--
-- Cross-edge de_mlops_overlap → ml_mlops намеренно: фиксируем границу
-- fork-branch DE↔MLE, intelligence ForkProgressReader (Phase 1.7c)
-- читает обе ветки.

-- +goose Up
-- +goose StatementBegin
INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    ('de_root',            'Data Engineering',           'system_design', 'hub',      'de', 'Точка входа в DE-трек',                                                       0, 900, 'de'),

    ('de_etl_pipelines',   'ETL / ELT pipelines',        'system_design', 'keystone', 'de', 'Идемпотентность, late-arriving data, backfill, batch vs incremental',        0, 901, 'de'),
    ('de_warehouses',      'Data warehouses',            'system_design', 'keystone', 'de', 'Snowflake, BigQuery, ClickHouse: storage layout, partitioning, clustering',  0, 902, 'de'),
    ('de_streaming',       'Streaming systems',          'system_design', 'keystone', 'de', 'Kafka, exactly-once semantics, watermarks, windowing, backpressure',         0, 903, 'de'),
    ('de_sql_optimization','SQL optimization',           'algorithms',    'keystone', 'de', 'Plan reading, joins, window functions, CTE vs subquery, index strategy',     0, 904, 'de'),
    ('de_modeling',        'Dimensional modeling',       'system_design', 'keystone', 'de', 'Kimball star/snowflake, slowly-changing dims, fact/dim grain, conformed dims', 0, 905, 'de'),

    ('de_spark',           'Spark / distributed compute','system_design', 'notable',  'de', 'Shuffle, skew, broadcast joins, AQE, partitioning by cardinality',           0, 906, 'de'),
    ('de_data_quality',    'Data quality & contracts',   'system_design', 'notable',  'de', 'Great Expectations, dbt tests, schema evolution, data contracts',            0, 907, 'de'),
    ('de_orchestration',   'Orchestration',              'system_design', 'notable',  'de', 'Airflow, Dagster, DAG design, retry semantics, SLA monitoring',              0, 908, 'de'),

    ('de_observability',   'Pipeline observability',     'system_design', 'small',    'de', 'Lineage (OpenLineage), freshness SLAs, anomaly detection on metrics',        0, 909, 'de'),
    ('de_governance',      'Data governance',            'system_design', 'small',    'de', 'PII, GDPR/152-FZ, retention, masking, access tiers, catalog tools',          0, 910, 'de'),
    ('de_mlops_overlap',   'MLOps boundary',             'system_design', 'small',    'de', 'Feature stores, training data versioning — пересечение DE↔MLE',             0, 911, 'de')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    ('de_root', 'de_etl_pipelines'),
    ('de_root', 'de_warehouses'),
    ('de_root', 'de_streaming'),
    ('de_root', 'de_sql_optimization'),
    ('de_root', 'de_modeling'),
    ('de_root', 'de_spark'),
    ('de_root', 'de_data_quality'),
    ('de_root', 'de_orchestration'),

    ('de_etl_pipelines',   'de_orchestration'),
    ('de_etl_pipelines',   'de_data_quality'),
    ('de_warehouses',      'de_modeling'),
    ('de_warehouses',      'de_sql_optimization'),
    ('de_streaming',       'de_spark'),
    ('de_streaming',       'de_observability'),
    ('de_modeling',        'de_governance'),
    ('de_orchestration',   'de_observability'),
    ('de_mlops_overlap',   'ml_mlops')
ON CONFLICT (from_id, to_id) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM atlas_edges
 WHERE from_id LIKE 'de_%' OR to_id LIKE 'de_%';

DELETE FROM atlas_nodes
 WHERE id LIKE 'de_%';
-- +goose StatementEnd
