-- 00097_coach_prompts.sql — Admin Phase 2: coach + system LLM prompt templates.
--
-- Centralises prompts that today живут inline в intelligence / admin / mock
-- services. Admin может править template + variables list без redeploy'а;
-- backend code lookup'ит row by slug при первой загрузке + слушает
-- dynconfig channel для hot-reload (см services/intelligence/infra).
--
-- variables — массив документированных placeholder'ов вида '{{user_goal}}',
-- '{{readiness}}'. Не enforced на DB уровне — UI просто рендерит hint для
-- curator'а; реальная подстановка — Go templating layer'ом.
--
-- version поднимается при каждом Update (audit-friendly). Initial seed —
-- six baseline prompts покрывают daily brief / insight / mock grade /
-- reflection grade / cue summary / milestones generation.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS coach_prompts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    category    TEXT NOT NULL,
    template    TEXT NOT NULL,
    variables   JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT NOT NULL DEFAULT '',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    version     INT NOT NULL DEFAULT 1,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_prompts_active
    ON coach_prompts(is_active, category);

INSERT INTO coach_prompts (slug, category, template, variables, description, is_active) VALUES
('daily_brief_baseline',
 'daily_brief',
 'Generate brief headline + 2-3 recommendations для user goal {{goal}} с readiness {{readiness}}%. Учти last 3 wins {{last_wins}} и open gaps {{gaps}}. Use Russian, tone — direct senior mentor.',
 '["{{goal}}","{{readiness}}","{{last_wins}}","{{gaps}}"]'::jsonb,
 'Default daily brief prompt — fallback when no admin override',
 TRUE),
('insight_baseline',
 'insight',
 'Synthesise an actionable insight для user {{user_id}} основанный на {{stage_kind}} stage. Inputs: latest signals {{signals}}. Output: 1-2 sentences, Russian, plain text, no markdown.',
 '["{{user_id}}","{{stage_kind}}","{{signals}}"]'::jsonb,
 'AI-coach insights surface — emitted on stage transitions',
 TRUE),
('mock_grade_baseline',
 'mock_grade',
 'Grade mock interview answer на 5-axis radar (technical / system_design / communication / behavior / problem_solving). Question: {{question}}. Transcript: {{transcript}}. Reference criteria: {{criteria}}. Output JSON.',
 '["{{question}}","{{transcript}}","{{criteria}}"]'::jsonb,
 'Mock interview 5-axis grader — used by mock_interview service',
 TRUE),
('reflection_grade_baseline',
 'reflection_grade',
 'Оцени user reflection по последней сессии «{{session_title}}». Reflection: {{reflection_text}}. Output: score 1-5 + 1-line feedback на русском.',
 '["{{session_title}}","{{reflection_text}}"]'::jsonb,
 'Reflection grade — used post-session в /focus и /mock',
 TRUE),
('cue_summary_baseline',
 'cue_summary',
 'Summarise Cue live-transcript chunk. Speakers: {{speakers}}. Last 10 lines: {{lines}}. Output: 1-2 bullets, Russian, focus на decisions + open questions.',
 '["{{speakers}}","{{lines}}"]'::jsonb,
 'Cue tray copilot live summary',
 TRUE),
('milestones_gen_baseline',
 'milestones_gen',
 'Generate 4-6 milestones для primary goal «{{goal_title}}». User track {{track}}. Target date {{target_date}}. Output JSON array of {title, target_date, kpi}.',
 '["{{goal_title}}","{{track}}","{{target_date}}"]'::jsonb,
 'Auto-milestones generator при goal creation',
 TRUE)
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS coach_prompts;

-- +goose StatementEnd
