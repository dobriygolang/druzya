-- 00111_ml_companies_seed.sql — M2 Phase K vertical analysis (2026-05-12).
--
-- Baseline companies (00001) — 5 RU engineering brands (Avito, VK, T-Bank,
-- Ozon, Yandex). ML user picks goal=ml_offer но не видит TARGET company
-- where ML interview = the thing.
--
-- Эта миграция добавляет ML-focused companies:
--   • US/EU FAANG-like — Google ML, Meta AI/ML, OpenAI, Anthropic,
--     DeepMind, NVIDIA — ML interview loop = ml_coding + ml_system_design
--     + behavioral (no generic algorithms).
--   • RU ML brands — Yandex Cloud ML, Sber Devices, T-Bank AI/ML,
--     Avito ML — отдельно от engineering parent brand (ranking /
--     recommendations / LLM teams).
--
-- Sections wire to granular ML stages (M2 enum extension в
-- shared/enums/section.go + proto/druz9/v1/common.proto):
--   • ml_coding — hands-on numpy/torch (replaces generic algorithms)
--   • ml_system_design — recsys / ranking / training pipeline
--   • ml_theory — DL fundamentals (optional, mostly research roles)
--   • behavioral — STAR rounds
--
-- Skill radar (intelligence/app/skill_radar.go `mle` rubric) folds all
-- 4 ML sections into same 5-axis radar so granular stage results
-- прозрачно копятся в общий ML radar.

-- +goose Up
-- +goose StatementBegin

INSERT INTO companies(slug, name, difficulty, min_level_required, sections, description, sort_order, active) VALUES
    -- US/EU FAANG-like ML.
    ('google-ml',     'Google ML',       'boss',  35, ARRAY['ml_coding','ml_system_design','behavioral'],
        'Google ML — L3-L5 ML Engineer + Research Scientist roles. Hiring loop: ML coding (numpy/torch), ML system design (recsys / ranking / training pipeline), behavioral. Algorithms раунд опционален для L3.',
        100, TRUE),
    ('meta-ai',       'Meta AI',         'boss',  30, ARRAY['ml_coding','ml_system_design','behavioral'],
        'Meta AI / Reality Labs — ranking, ads, GenAI. ML interview loop: PyTorch coding, ML system design (feed ranking, candidate gen), behavioral.',
        110, TRUE),
    ('openai',        'OpenAI',          'boss',  35, ARRAY['ml_coding','ml_system_design','ml_theory','behavioral'],
        'OpenAI — Research Engineer / ML Engineer. Loop: ML theory deep-dive (attention, optimization, scaling laws), coding (numpy/torch), system design (training infra, RLHF pipeline), behavioral.',
        120, TRUE),
    ('anthropic',     'Anthropic',       'boss',  35, ARRAY['ml_coding','ml_system_design','ml_theory','behavioral'],
        'Anthropic — Research Engineer / ML Engineer. Focus: alignment, interpretability, large-scale training. Loop похож на OpenAI — theory + coding + system design + behavioral.',
        130, TRUE),
    ('deepmind',      'DeepMind',        'boss',  35, ARRAY['ml_theory','ml_coding','ml_system_design','behavioral'],
        'Google DeepMind — Research Scientist. Heavy на ML theory (RL, optimization, generative models), coding (numpy/jax/torch), research design, behavioral.',
        140, TRUE),
    ('nvidia-ml',     'NVIDIA ML',       'hard',  25, ARRAY['ml_coding','ml_system_design','behavioral'],
        'NVIDIA — ML Systems Engineer. Loop: low-level coding (CUDA-adjacent, kernel optimization), ML system design (distributed training, inference pipelines), behavioral.',
        150, TRUE),

    -- RU ML brands.
    ('yandex-cloud-ml','Yandex Cloud ML', 'hard',  20, ARRAY['ml_coding','ml_system_design','behavioral'],
        'Yandex Cloud ML — production ML platform engineer. Loop: ml_coding (Python/torch), ml_system_design (feature store, training pipelines, inference SLO), behavioral.',
        160, TRUE),
    ('sber-devices',  'Sber Devices',    'hard',  20, ARRAY['ml_coding','ml_system_design','behavioral'],
        'Sber Devices — speech, NLP, LLM teams (GigaChat, SaluteSpeech). Loop: coding + ML system design + behavioral.',
        170, TRUE),
    ('t-bank-ml',     'T-Bank AI/ML',    'hard',  18, ARRAY['ml_coding','ml_system_design','behavioral'],
        'T-Bank AI/ML — credit scoring, fraud detection, recommender systems. Отдельный hiring track от regular engineering: ML coding + ML system design + behavioral.',
        180, TRUE),
    ('avito-ml',      'Avito ML',        'hard',  18, ARRAY['ml_coding','ml_system_design','behavioral'],
        'Avito ML — ranking, recommendations, search relevance. ML interview loop: coding + ML system design + behavioral.',
        190, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Goal presets — company-specific ML goals so GoalWizard shows ML companies
-- as quick-start options. Generic 'ml-faang' preset (00096) остаётся для
-- backwards compat (empty target_company). Sort_order 65-72 inserts these
-- между existing ml-faang (60) и english-toefl (70). Mirror primary_goal_kind
-- 'ml_offer' value через 'GOAL_KIND_ML_OFFER'.
INSERT INTO goal_presets (slug, title, kind, target_company, default_target_days, sort_order, is_active) VALUES
    ('ml-google',     'ML Engineer @ Google',       'GOAL_KIND_ML_OFFER',  'Google ML',        150, 65, TRUE),
    ('ml-meta',       'ML Engineer @ Meta',         'GOAL_KIND_ML_OFFER',  'Meta AI',          150, 66, TRUE),
    ('ml-openai',     'Research Engineer @ OpenAI', 'GOAL_KIND_ML_OFFER',  'OpenAI',           180, 67, TRUE),
    ('ml-anthropic',  'Research Engineer @ Anthropic', 'GOAL_KIND_ML_OFFER', 'Anthropic',      180, 68, TRUE),
    ('ml-yandex-cloud','ML @ Yandex Cloud',         'GOAL_KIND_ML_OFFER',  'Yandex Cloud ML',  90,  69, TRUE),
    ('ml-sber',       'ML @ Sber Devices',          'GOAL_KIND_ML_OFFER',  'Sber Devices',     90,  70, TRUE),
    ('ml-avito',      'ML @ Avito',                 'GOAL_KIND_ML_OFFER',  'Avito ML',         75,  71, TRUE),
    ('ml-t-bank',     'ML @ T-Bank AI',             'GOAL_KIND_ML_OFFER',  'T-Bank AI/ML',     75,  72, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: seed-only insert; rollback would require knowing which rows
-- were added by this migration vs existing user picks. Drop & rebuild instead.
SELECT 1;
-- +goose StatementEnd
