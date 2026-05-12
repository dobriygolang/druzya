-- 00101_coach_episodes_edited_at.sql — F1 Memory expansion: user-editable entries.
--
-- Юзер может уточнить formulation entry'и (например, mock_complete summary
-- сгенерирован LLM, а user знает что слабое место было не «алгоритмы» а
-- «графовые алгоритмы»). edited_at = last user edit; NULL = never edited.
-- UI рисует subtle «· edited» индикатор когда edited_at IS NOT NULL.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE coach_episodes
    ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE coach_episodes
    DROP COLUMN IF EXISTS edited_at;

-- +goose StatementEnd
