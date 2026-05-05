-- 00069_drop_ai_credits.sql — удаление ai_credits таблицы.
--
-- Free-tier-only платформа после Boosty pivot'а — никто не списывает credits.
-- Backend INSERT'ил default 0 при регистрации, читал balance в Bundle, но
-- никогда не UPDATE'ил. Frontend поле получал, но ни одна страница не
-- отображала. Bundle.AICredits / Profile.AiCredits (proto) / EnsureAICredits
-- SQLC удалены.

-- +goose Up
-- +goose StatementBegin

DROP TABLE IF EXISTS ai_credits CASCADE;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- one-way drop
-- +goose StatementEnd
