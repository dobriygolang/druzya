-- 00070_drop_career_stage.sql — удаление profiles.career_stage column.
--
-- Колонка хранила derived seniority label (junior/middle/senior/staff/principal),
-- считалась через CareerStageFromPowerScore по ELO. После удаления arena/ratings
-- никто не UPDATE'ит — поле всегда default 'junior'. UpdateCareerStage метод и
-- CareerStage type удалены, frontend ProfileHeader больше не показывает sub-стат.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE profiles DROP COLUMN IF EXISTS career_stage;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop
-- +goose StatementEnd
