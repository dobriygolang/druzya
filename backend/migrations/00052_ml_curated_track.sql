-- 00052_ml_curated_track.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- Curated ML-eng track: tracks row + 9 track_steps. Atlas-узлы под
-- этот трек уже посеяны в 00033_ml_track.sql (ml_classical, ml_evaluation,
-- ml_deep_learning, ml_transformers, ml_llm, ml_system_design, ml_serving,
-- ml_mlops, ...). После 00046 узлы re-tag'нуты track_kind='dev_senior',
-- cluster='ml' (sub-specialization внутри senior dev), но curated-track
-- остаётся отдельным learning path для тех, кто целит в MLE-роль.
--
-- Steps — sequences-of-resources, контент через external_resources
-- jsonb (00051) после прогона cmd/seed_resources (Phase 1b). Финальный
-- шаг — mock через services/ai_mock ML-pool (уже существует).

-- +goose Up
-- +goose StatementBegin
INSERT INTO tracks (slug, name, tagline, description_md, accent_color,
                    estimated_weeks, difficulty, is_curated, tags, company_focus)
VALUES
  ('ml-engineering-senior',
   'ML Engineering · senior',
   'Classical ML → DL → LLM → MLOps',
   '9 шагов под MLE-собес: classical ML → evaluation → deep learning → transformers → LLM/RAG → ML system design → inference & serving → MLOps → финальный mock с 5-axis rubric.',
   '#FFFFFF', 10, 'hard', TRUE,
   ARRAY['ml_engineering', 'core'], ARRAY[]::text[])
ON CONFLICT (slug) DO NOTHING;

-- Новые колонки track_steps (checkpoint_skill_keys / reflection_required /
-- graduation_mock_section) добавлены в 00050. Здесь populate'им их при INSERT.
INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys,
                         required_kind, required_count, estimated_minutes,
                         checkpoint_skill_keys, reflection_required, graduation_mock_section)
SELECT t.id, x.step_index, x.title, x.description_md, x.skill_keys,
       x.required_kind::track_step_kind, x.required_count, x.estimated_minutes,
       x.checkpoint_skill_keys, x.reflection_required, x.graduation_mock_section
  FROM tracks t,
       (VALUES
         (0, 'Classical ML · regressions, trees, ensembles',
             'Linear / logistic, decision trees, random forest, gradient boosting (XGBoost/LightGBM/CatBoost), feature engineering, регуляризации.',
             ARRAY['classical_ml', 'feature_engineering'],   'focus_block', 1, 120,
             ARRAY['classical_ml', 'feature_engineering'],   TRUE,  NULL::text),

         (1, 'Evaluation & metrics',
             'Offline metrics (precision/recall/AUC/MAP), online A/B, drift detection, label leakage, calibration.',
             ARRAY['ml_evaluation', 'metrics'],              'focus_block', 1, 75,
             ARRAY['ml_evaluation', 'metrics'],              TRUE,  NULL),

         (2, 'Deep Learning fundamentals',
             'Backprop, optimizers (SGD/Adam/AdamW), BatchNorm/LayerNorm, regularization, vanishing/exploding gradients.',
             ARRAY['deep_learning'],                         'focus_block', 1, 120,
             ARRAY['deep_learning'],                         TRUE,  NULL),

         (3, 'Transformers & attention',
             'Self-attention math, positional encodings, multi-head, scaling laws, KV-cache, RoPE.',
             ARRAY['transformers', 'attention'],             'focus_block', 1, 90,
             ARRAY['transformers', 'attention'],             TRUE,  NULL),

         (4, 'LLM / GenAI · RAG, fine-tuning, RLHF',
             'Tokenization, embeddings, RAG vs fine-tuning, LoRA/QLoRA, RLHF/DPO, hallucination mitigation, eval.',
             ARRAY['llm', 'rag', 'fine_tuning'],              'focus_block', 1, 120,
             ARRAY['llm', 'rag', 'fine_tuning'],              TRUE,  'ml_eng'),

         (5, 'ML system design',
             'Recsys / ranking architecture: candidate generation → light ranker → heavy ranker → re-ranker. Feature stores, online vs offline.',
             ARRAY['ml_system_design', 'recsys'],            'focus_block', 1, 120,
             ARRAY['ml_system_design', 'recsys'],            TRUE,  NULL),

         (6, 'Inference & serving',
             'Latency budget p99, distillation, quantization (INT8/INT4), ONNX, batching, caching, GPU utilization.',
             ARRAY['serving', 'inference'],                  'focus_block', 1, 75,
             ARRAY['serving', 'inference'],                  TRUE,  NULL),

         (7, 'MLOps practices',
             'Model registry, lineage, A/B serving, observability (drift/skew/perf), retrain cadence, shadow deploys.',
             ARRAY['mlops', 'observability'],                'focus_block', 1, 75,
             ARRAY['mlops'],                                 TRUE,  NULL),

         (8, 'Mock · MLE-собес 5-axis',
             'Полный MLE-мок через services/ai_mock ML-pool.',
             ARRAY['ml_engineering'],                        'mock', 1, 75,
             ARRAY[]::text[],                                FALSE, NULL)
       ) AS x(step_index, title, description_md, skill_keys,
              required_kind, required_count, estimated_minutes,
              checkpoint_skill_keys, reflection_required, graduation_mock_section)
 WHERE t.slug = 'ml-engineering-senior'
ON CONFLICT (track_id, step_index) DO NOTHING;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM track_steps
 WHERE track_id IN (SELECT id FROM tracks WHERE slug = 'ml-engineering-senior');

DELETE FROM tracks WHERE slug = 'ml-engineering-senior';
-- +goose StatementEnd
