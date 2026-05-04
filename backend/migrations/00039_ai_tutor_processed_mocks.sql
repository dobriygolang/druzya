-- 00039_ai_tutor_processed_mocks.sql — idempotency guard для OnFailedMock.
--
-- AI-tutor подписан на mock.ReportReady event (см services/ai_tutor + ai_mock
-- ReportWorker). EventBus delivery-once в InProcess, но crash recovery /
-- worker rerun могли бы привести к дубль assignment'ам в Hone TaskBoard.
-- Этот lookup-таблица — guard: каждая (session_id, persona_id)-пара
-- обрабатывается ровно один раз; повторный fire → пропуск без push.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ai_tutor_processed_mocks (
    session_id  UUID        NOT NULL,
    persona_id  UUID        NOT NULL REFERENCES ai_tutor_personas(id) ON DELETE CASCADE,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, persona_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ai_tutor_processed_mocks;
-- +goose StatementEnd
