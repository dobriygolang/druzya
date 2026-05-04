-- 00056_step_checkpoint_attempts.sql — Phase 1a step UX flow (2026-05-04).
--
-- Хранит результаты checkpoint quiz юзера на каждый track_step. UC поток
-- Phase 2 (StartCheckpoint / SubmitCheckpoint в services/tracks):
--   1. Юзер открывает step → видит checkpoint CTA после ≥2 core resources
--   2. Backend выбирает 5 questions из mock_pool по track_steps.checkpoint_skill_keys
--   3. Юзер отвечает → SubmitCheckpoint вызывает TaskCheckpointGrade
--   4. Запись в этой таблице: score 0..100, attempts jsonb (per-question)
--   5. Если score >= 70 → passed_at = now(), soft-unlock следующего step'а
--
-- Множественные attempts разрешены — UI показывает «retake» без блокировки.
-- Last-passed lookup делается через `ORDER BY created_at DESC LIMIT 1`.
--
-- step_id ссылается на (track_id, step_index) из track_steps. Так как у
-- track_steps composite PK, мы храним id шага через UUID — это сложнее.
-- Вместо этого ссылаемся на пару полей напрямую (track_id + step_index),
-- что match'ит реальный PK. Cascade'им на DELETE track_id (track удалён —
-- attempts уже неактуальны).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE step_checkpoint_attempts (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id    UUID         NOT NULL,
    step_index  SMALLINT     NOT NULL,
    score       INT          NOT NULL CHECK (score >= 0 AND score <= 100),
    attempts    JSONB        NOT NULL DEFAULT '[]'::jsonb,
    passed_at   TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT step_checkpoint_attempts_step_fk
        FOREIGN KEY (track_id, step_index) REFERENCES track_steps(track_id, step_index)
        ON DELETE CASCADE,
    CONSTRAINT step_checkpoint_attempts_passed_score
        CHECK (passed_at IS NULL OR score >= 70)
);

-- Latest-attempt-per-step lookup (используется UC для "passed?" check).
CREATE INDEX idx_step_checkpoint_attempts_user_step_recent
    ON step_checkpoint_attempts (user_id, track_id, step_index, created_at DESC);

-- Partial index для быстрого "all passed steps in track" — admin
-- distribution-tab Phase 12.5 + intelligence ForkProgressReader.
CREATE INDEX idx_step_checkpoint_attempts_passed
    ON step_checkpoint_attempts (user_id, track_id, step_index)
    WHERE passed_at IS NOT NULL;

COMMENT ON TABLE  step_checkpoint_attempts             IS 'Per-attempt results of step checkpoint quiz (5 questions из mock_pool по track_steps.checkpoint_skill_keys, AI-graded via TaskCheckpointGrade).';
COMMENT ON COLUMN step_checkpoint_attempts.attempts    IS 'Per-question results: array of {question_id, user_answer, model_answer, correct, comment}.';
COMMENT ON COLUMN step_checkpoint_attempts.passed_at   IS 'Set when score >= 70. NULL = failed/not yet graded. Latest passed_at IS NOT NULL row gates next-step unlock.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS step_checkpoint_attempts;
-- +goose StatementEnd
