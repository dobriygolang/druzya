-- 00060_observability_tables.sql — Phase 1.7h admin observability hooks.
--
-- 2 таблицы для admin LLMChainPanel + IntelligenceObservabilityPanel
-- (Phase 12.5):
--
--   * dynamic_config_metrics — per-task volume/latency/cost rolling
--     counters. Запись через middleware на каждый llmchain call. Read'ы
--     в admin UI агрегируют по day-bucket.
--
--   * eval_runs — снапшот latest results from `make eval-ai` (Phase 1.7f).
--     CI или admin-кнопка дёргает eval suite, итог записывается сюда.
--     Регресс tracking + alert'ы (Phase 12.5).
--
-- Почему отдельной таблицей, а не колонкой в существующих:
-- llmchain metrics уже частично экспонированы в Prometheus
-- (см shared/pkg/llmchain/metrics.go), но Prometheus retention коротка
-- (15-30 days в нашем setup'е). Эти таблицы — long-term snapshot для
-- per-task admin-визуализации без зависимости от Prometheus retention.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE dynamic_config_metrics (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    task            TEXT         NOT NULL,
    bucket_day      DATE         NOT NULL,
    -- Provider-bucket'инг (groq / cerebras / mistral / openrouter / ollama).
    provider        TEXT         NOT NULL DEFAULT '',
    -- Volume/cost per bucket.
    calls           INT          NOT NULL DEFAULT 0,
    tokens_in_sum   BIGINT       NOT NULL DEFAULT 0,
    tokens_out_sum  BIGINT       NOT NULL DEFAULT 0,
    cost_usd_cents  INT          NOT NULL DEFAULT 0,
    -- Latency percentiles за bucket — пересчитываются raw'ом или
    -- t-digest depending'но на storage choice. Здесь храним готовые ms.
    latency_p50_ms  INT          NOT NULL DEFAULT 0,
    latency_p95_ms  INT          NOT NULL DEFAULT 0,
    latency_p99_ms  INT          NOT NULL DEFAULT 0,
    error_count     INT          NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (task, provider, bucket_day)
);

CREATE INDEX idx_dynamic_config_metrics_recent
    ON dynamic_config_metrics (bucket_day DESC, task);

COMMENT ON TABLE dynamic_config_metrics IS 'Per-task per-provider per-day rolling counters. Source for admin LLMChainPanel cost breakdown + IntelligenceObservabilityPanel latency charts.';

CREATE TABLE eval_runs (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Какой dataset гонялся. e.g. 'dataset_next_action.json',
    -- 'dataset_fork_analysis.json', 'dataset.json' (legacy coach).
    dataset_name    TEXT         NOT NULL,
    -- Какой Task оценивался (если eval per-task).
    task            TEXT         NOT NULL DEFAULT '',
    triggered_by    TEXT         NOT NULL,  -- 'ci' | 'admin' | 'cron'
    -- Aggregate scores (parser-specific shape — keep as JSONB).
    summary         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    parsed_total    INT          NOT NULL DEFAULT 0,
    parsed_ok       INT          NOT NULL DEFAULT 0,
    duration_ms     INT          NOT NULL DEFAULT 0,
    git_commit      TEXT         NOT NULL DEFAULT '',
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_eval_runs_recent
    ON eval_runs (dataset_name, occurred_at DESC);

COMMENT ON TABLE eval_runs IS 'Snapshot results from make eval-ai / eval-coach runs. Admin views latest scores per dataset; CI compares against threshold для regression alerting.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS eval_runs;
DROP TABLE IF EXISTS dynamic_config_metrics;
-- +goose StatementEnd
