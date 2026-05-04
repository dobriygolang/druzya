-- 00033_ml_track.sql — pivot 2026-05-01.
--
-- Добавляет ML engineering track:
--   1. ALTER TYPE track_kind ADD VALUE 'ml' (NO TRANSACTION mode — Postgres
--      запрещает использование нового enum-значения в той же транзакции).
--   2. Атлас seed: 12 узлов под track_kind='ml'.
--   3. Re-tag существующих ml_platform узлов под новый track_kind=`ml`,
--      cluster=`ml_platform` остаётся (как sub-cluster внутри ml track).
--
-- Mock prompt + section enum + frontend panel — отдельно (см
-- backend/services/ai_mock/domain/ml.go и shared/enums/section.go).

-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'ml'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'track_kind')
    ) THEN
        ALTER TYPE track_kind ADD VALUE 'ml';
    END IF;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
-- Re-tag ml_platform cluster nodes (00023) под ml track. cluster='ml_platform'
-- остаётся как «вертикальный сабкластер для платформенных инженеров».
UPDATE atlas_nodes SET track_kind = 'ml'
WHERE cluster = 'ml_platform';

-- 12 узлов ML eng track. sort_order 800-899 после ml_platform 700-706.
INSERT INTO atlas_nodes (id, title, section, kind, cluster, description, total_count, sort_order, track_kind) VALUES
    -- Hub
    ('ml_root',           'ML Engineering',          'system_design', 'hub',      'ml',         'Точка входа в ML eng-трек',                                          0, 800, 'ml'),

    -- Classical ML
    ('ml_classical',      'Classical ML',            'algorithms',    'keystone', 'ml',         'Регрессии, деревья, ансамбли, feature engineering, регуляризации',  0, 801, 'ml'),
    ('ml_evaluation',     'Evaluation & metrics',    'system_design', 'keystone', 'ml',         'Offline metrics, A/B-online metrics, drift detection, leakage',     0, 802, 'ml'),
    ('ml_data_intuition', 'Data intuition',          'system_design', 'notable',  'ml',         'Distribution shift, label noise, sampling biases, feature stores',  0, 803, 'ml'),

    -- Deep Learning
    ('ml_deep_learning',  'Deep Learning fundamentals', 'system_design', 'keystone', 'ml',      'Backprop, optimizers, BatchNorm/LayerNorm, regularization',         0, 804, 'ml'),
    ('ml_transformers',   'Transformers & attention', 'system_design',  'keystone', 'ml',       'Self-attention math, positional encodings, scaling, KV-cache',      0, 805, 'ml'),
    ('ml_cnn_rnn',        'CNN / RNN architectures', 'system_design', 'small',    'ml',         'Convolutions, pooling, RNN/LSTM, vanishing gradients',              0, 806, 'ml'),

    -- LLM / GenAI
    ('ml_llm',            'LLM / GenAI',             'system_design', 'keystone', 'ml',         'Tokenization, embeddings, RAG vs fine-tuning, RLHF, hallucination',  0, 807, 'ml'),
    ('ml_lora_pft',       'LoRA / PEFT',             'system_design', 'small',    'ml',         'Parameter-efficient fine-tuning: LoRA, QLoRA, adapters',            0, 808, 'ml'),

    -- ML system design
    ('ml_system_design',  'ML system design',        'system_design', 'keystone', 'ml',         'Recsys, ranking, candidate generation → light → heavy stack',       0, 809, 'ml'),
    ('ml_serving',        'Inference & serving',     'system_design', 'notable',  'ml',         'Latency budget p99, distillation, quantization, ONNX, caching',     0, 810, 'ml'),

    -- MLOps
    ('ml_mlops',          'MLOps practices',         'system_design', 'notable',  'ml',         'Model registry, lineage, A/B serving, observability, retrain cadence', 0, 811, 'ml')
ON CONFLICT (id) DO NOTHING;

INSERT INTO atlas_edges (from_id, to_id) VALUES
    ('ml_root', 'ml_classical'),
    ('ml_root', 'ml_evaluation'),
    ('ml_root', 'ml_data_intuition'),
    ('ml_root', 'ml_deep_learning'),
    ('ml_root', 'ml_transformers'),
    ('ml_root', 'ml_llm'),
    ('ml_root', 'ml_system_design'),
    ('ml_root', 'ml_mlops'),
    ('ml_deep_learning', 'ml_cnn_rnn'),
    ('ml_deep_learning', 'ml_transformers'),
    ('ml_transformers', 'ml_llm'),
    ('ml_llm', 'ml_lora_pft'),
    ('ml_system_design', 'ml_serving'),
    ('ml_serving', 'ml_mlops')
ON CONFLICT (from_id, to_id) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
