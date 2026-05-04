-- 00057_persona_rename.sql — Phase 1.7b naming rule (2026-05-04).
--
-- Sergey 2026-05-04: AI personas с человеческими именами выглядят
-- странно — юзер думает что реальный человек. Drop human first names
-- везде, display_name = role-only, lowercase. См memory/feedback_persona_names.md.
--
-- Этот файл апдейтит ТОЛЬКО display_name. prompt_template нужно
-- отдельно проредить (drop «I'm Алёша» / «Lena here» / etc.) — это
-- сделается рядом с миграцией 00054_ml_de_personas (Phase 1.7b)
-- одной общей правкой prompt_template'ов.
--
-- Down — restore старые display_names (на случай, если кто-то решит
-- вернуть human names; код этого делать не должен, но миграция
-- симметрична).

-- +goose Up
-- +goose StatementBegin
UPDATE ai_tutor_personas SET display_name = 'algo coach',
       updated_at = now()
 WHERE slug = 'algo-coach';

UPDATE ai_tutor_personas SET display_name = 'sql mentor',
       updated_at = now()
 WHERE slug = 'sql-mentor';

UPDATE ai_tutor_personas SET display_name = 'system design guru',
       updated_at = now()
 WHERE slug = 'sysdesign-guru';

UPDATE ai_tutor_personas SET display_name = 'english coach',
       updated_at = now()
 WHERE slug = 'english-coach';

UPDATE ai_tutor_personas SET display_name = 'go coach',
       updated_at = now()
 WHERE slug = 'go-coach';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE ai_tutor_personas SET display_name = 'Алёша · алго-коуч',
       updated_at = now()
 WHERE slug = 'algo-coach';

UPDATE ai_tutor_personas SET display_name = 'Лена · sql-mentor',
       updated_at = now()
 WHERE slug = 'sql-mentor';

UPDATE ai_tutor_personas SET display_name = 'Кирилл · sysdesign-guru',
       updated_at = now()
 WHERE slug = 'sysdesign-guru';

UPDATE ai_tutor_personas SET display_name = 'Maria · english-coach',
       updated_at = now()
 WHERE slug = 'english-coach';

UPDATE ai_tutor_personas SET display_name = 'Гоша · Go-коуч',
       updated_at = now()
 WHERE slug = 'go-coach';
-- +goose StatementEnd
