-- 00126_llm_invocations.sql — Wave 15 LLM cost / usage audit table.
--
-- Why a new table instead of expanding dynamic_config_metrics:
--   * dynamic_config_metrics is daily-bucketed (task, provider, bucket_day)
--     → no row-level granularity, can't break down by user or list
--     individual expensive calls.
--   * Wave 15 admin panel needs per-call rows so it can group by user,
--     by day, by task, by provider — pivoting on the dashboard UI without
--     pre-aggregation.
--   * Retention: keep raw rows 30 days (mirror of telemetry retention), then
--     prune via batch job. Aggregated counters keep living elsewhere
--     (Prometheus + dynamic_config_metrics).
--
-- Write path: backend/shared/pkg/llmchain/chain.go fires an async event
-- after a successful Chat() return. Worker (see backend/cmd/monolith/services/admin/
-- llm_invocation_worker.go in Wave 15 wiring) consumes the channel and
-- INSERTs rows in batch — non-blocking, drops on full buffer (best-effort,
-- audit only). The fire-and-forget posture matches the existing observeCost
-- prometheus path.
--
-- cost_estimate_cents — USD cents from llmchain.EstimateCostUSD. Free-tier
-- providers (Groq, Cerebras, Google free tier, Cloudflare) emit 0 — the row
-- is still kept for call-count / latency analytics + provider breakdown.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE llm_invocations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- provider — groq / cerebras / google / cloudflare / zai / mistral /
    -- openrouter / deepseek / ollama. NULLABLE because cost-only events
    -- (e.g. probe-call) may lack provider attribution.
    provider             TEXT NOT NULL,
    -- model — concrete model id ('llama-3.3-70b-versatile', 'gemini-2.0-flash',
    -- 'deepseek-chat'). Cost rate looked up here.
    model                TEXT NOT NULL,
    -- task_kind — Task constant ('next_action', 'daily_brief', 'writing_grade',
    -- 'note_qa', 'milestones', etc.). Empty if direct ModelOverride call
    -- without Task set.
    task_kind            TEXT NOT NULL DEFAULT '',
    -- user_id — NULLABLE (admin-triggered probe / health-check calls have no user).
    user_id              UUID,
    input_tokens         INT  NOT NULL DEFAULT 0,
    output_tokens        INT  NOT NULL DEFAULT 0,
    -- cost_estimate_cents — integer USD cents per call. Free-tier = 0.
    cost_estimate_cents  INT  NOT NULL DEFAULT 0,
    -- latency_ms — wall time of the successful Chat() call (excludes fallback hops).
    latency_ms           INT  NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT llm_invocations_tokens_nonneg
        CHECK (input_tokens >= 0 AND output_tokens >= 0),
    CONSTRAINT llm_invocations_cost_nonneg
        CHECK (cost_estimate_cents >= 0),
    CONSTRAINT llm_invocations_latency_nonneg
        CHECK (latency_ms >= 0)
);

-- Primary admin query: «top tasks by cost in last N days».
CREATE INDEX idx_llm_invocations_task_created
    ON llm_invocations (task_kind, created_at DESC);

-- Group-by user / day / provider — separate indices.
CREATE INDEX idx_llm_invocations_user_created
    ON llm_invocations (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_llm_invocations_provider_created
    ON llm_invocations (provider, created_at DESC);

CREATE INDEX idx_llm_invocations_day
    ON llm_invocations (date_trunc('day', created_at) DESC);

COMMENT ON TABLE llm_invocations IS 'Per-call LLM audit log. Source for admin LLM usage panel (Wave 15). Retention 30 days via prune job; long-term aggregates live in dynamic_config_metrics + Prometheus.';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_llm_invocations_day;
DROP INDEX IF EXISTS idx_llm_invocations_provider_created;
DROP INDEX IF EXISTS idx_llm_invocations_user_created;
DROP INDEX IF EXISTS idx_llm_invocations_task_created;
DROP TABLE IF EXISTS llm_invocations;

-- +goose StatementEnd
