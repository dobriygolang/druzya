-- +goose Up
-- +goose StatementBegin
INSERT INTO dynamic_config(key, value, type, description) VALUES
  ('arena_workers_count',         to_jsonb(4),     'int',   'Число воркеров матчмейкинга'),
  ('arena_anticheat_threshold',   to_jsonb(70),    'int',   'Порог suspicion score для предупреждения'),
  ('arena_match_confirm_sec',     to_jsonb(10),    'int',   'Окно подтверждения матча (сек)'),
  ('ai_max_concurrent_sessions',  to_jsonb(100),   'int',   'Максимум параллельных AI мок сессий'),
  ('ai_stress_pause_threshold_ms', to_jsonb(120000), 'int', 'Порог паузы для наводящего вопроса'),
  ('elo_k_factor_new',            to_jsonb(32),    'int',   'K-фактор ELO для новичков (< 30 матчей)'),
  ('elo_k_factor_veteran',        to_jsonb(16),    'int',   'K-фактор ELO для ветеранов'),
  ('xp_arena_win',                to_jsonb(120),   'int',   'XP за победу в арене'),
  ('xp_arena_loss',               to_jsonb(20),    'int',   'XP за поражение в арене'),
  ('xp_mock_complete',            to_jsonb(80),    'int',   'XP за завершение AI мока'),
  ('xp_kata_daily',               to_jsonb(30),    'int',   'Базовый XP за Daily Kata'),
  ('xp_kata_cursed_multiplier',   to_jsonb(3),     'int',   'Множитель XP за проклятую Kata'),
  ('skill_decay_days',            to_jsonb(7),     'int',   'Дней без практики до начала деградации'),
  ('skill_decay_rate_pct',        to_jsonb(2),     'int',   'Процент деградации в день'),
  ('cohort_max_size',              to_jsonb(10),    'int',   'Максимум участников когорты'),
  ('season_pass_enabled',         to_jsonb(true),  'bool',  'Включён ли Season Pass'),
  ('voice_mode_enabled',          to_jsonb(false), 'bool',  'Включён ли голосовой мок режим'),
  ('llm_default_free_model',      to_jsonb('openai/gpt-4o-mini'::text), 'string', 'Дефолтная LLM для free'),
  ('llm_default_paid_model',      to_jsonb('openai/gpt-4o'::text),      'string', 'Дефолтная LLM для premium');

INSERT INTO seasons(name, slug, theme, starts_at, ends_at, is_current) VALUES
  ('The Awakening', 'season-1', 'awakening',
   now() - interval '2 weeks', now() + interval '4 weeks', TRUE);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM dynamic_config;
DELETE FROM seasons WHERE slug = 'season-1';
-- +goose StatementEnd
