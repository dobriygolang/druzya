-- 00119_writing_prompts.sql — Phase K Wave 11 (2026-05-13)
--
-- Curated prompts library for Hone English Writing modality. Replaces
-- the placeholder admin page (frontend/src/pages/admin/lingua/WritingPromptsPage.tsx)
-- that was deferred in Wave 8 because backend didn't exist.
--
-- Schema:
--   id              TEXT PK (slug — kebab-case, e.g. "b2-tech-blog-bugfix").
--                   Admin-authored, immutable post-creation.
--   level           B1 | B2 | C1 (CEFR) — gates which exercises a user sees
--                   based on their current English level setting.
--   topic           Short tag ("email", "tech-blog", "retrospective"). Used
--                   for grouping in the picker UI.
--   prompt          The actual prompt body shown to the user.
--   rubric_md       Optional grader rubric. Currently informational; planned
--                   for future LLMChainWritingGrader system-prompt injection.
--   archived_at     Soft-delete. Archived prompts hidden from List but kept
--                   for analytics / referrer integrity.
--   created_at, updated_at  Standard audit cols.
--
-- Seed: 10 baseline prompts across B1/B2/C1 covering common SWE
-- communication scenarios (PTO emails, tech-blog posts, retrospectives,
-- microservice vs monolith explainers, one-pagers). Curators can add more
-- via admin UI (List/Add/Archive RPCs).

-- +goose Up
-- +goose StatementBegin

CREATE TABLE writing_prompts (
    id           TEXT PRIMARY KEY,
    level        TEXT NOT NULL CHECK (level IN ('B1', 'B2', 'C1')),
    topic        TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    rubric_md    TEXT NOT NULL DEFAULT '',
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index — most queries filter by (level, NOT archived).
CREATE INDEX writing_prompts_level_active_idx
    ON writing_prompts (level)
    WHERE archived_at IS NULL;

-- Seed: 10 baseline prompts.
INSERT INTO writing_prompts (id, level, topic, prompt, rubric_md) VALUES
('b1-email-pto',
 'B1',
 'email',
 'Write a 200-word email to your manager explaining why you need PTO next week. Keep it professional but warm — mention what you''ll do to wrap up open items before leaving.',
 'Grading: greeting/closing tone, clear date range, handoff plan, simple grammar (past/future correctly used).'),

('b1-standup-update',
 'B1',
 'standup',
 'Write a 150-word async standup update covering yesterday / today / blockers. Pretend you''re a backend engineer on a payments team.',
 'Grading: clear structure (3 sections), specific verbs, avoid vague status ("working on stuff").'),

('b1-bug-report',
 'B1',
 'bug-report',
 'Write a 200-word bug report for an issue you found in a checkout flow. Include: what you expected, what happened, repro steps, environment (browser/OS).',
 'Grading: structured sections, precise verbs, no ambiguity about expected vs actual.'),

('b2-tech-blog-bugfix',
 'B2',
 'tech-blog',
 'Write a 350-word technical blog post explaining a recent bug fix in your service. Choose a real issue or invent one (e.g. race condition / N+1 query). Aim for clarity > depth.',
 'Grading: clarity of problem statement, technical depth without jargon overload, structured intro → diagnosis → fix → takeaways.'),

('b2-one-pager-product',
 'B2',
 'product',
 'Write a 400-word sales-engineering one-pager for a B2B product targeting devops engineers. Cover: pain point, your solution, integration story, pricing tier hint, CTA.',
 'Grading: customer-first language, concrete value claims, no fluff, professional CTA.'),

('b2-retro-summary',
 'B2',
 'retrospective',
 'Write a 300-word sprint retrospective summary. Focus on: what went well (2 items), what to improve (2 items), one experiment for next sprint. Avoid blame language.',
 'Grading: balanced positive/negative, actionable improvements, neutral team-oriented tone.'),

('b2-code-review-comment',
 'B2',
 'code-review',
 'Write 4 code review comments for a hypothetical PR adding a new API endpoint. Cover: a bug, a missing test, a clarity issue, and one praise comment.',
 'Grading: specific (line/function refs), constructive tone, balance of negative + positive feedback.'),

('c1-microservices-vs-monolith',
 'C1',
 'technical-explainer',
 'Write a 500-word post explaining microservices vs monolith trade-offs to a non-technical manager. Use one concrete analogy. Avoid acronyms without expansion.',
 'Grading: accessibility to non-engineers, clear trade-off framing (3+ axes), confidence without hedging, well-chosen analogy.'),

('c1-incident-postmortem',
 'C1',
 'postmortem',
 'Write a 500-word incident postmortem summary covering: impact, timeline, root cause, contributing factors, action items. Blameless tone — avoid "X failed", prefer "the system allowed X".',
 'Grading: blameless framing, precise timeline language, clear action-item ownership pattern, structural rigor.'),

('c1-architecture-design-doc',
 'C1',
 'design-doc',
 'Write a 500-word design-doc intro for a feature you''d build: problem statement, proposed approach, alternatives considered (≥2), rejected options + why. No implementation detail.',
 'Grading: tight problem framing, justified architecture choice, alternatives shown ≥2 with rejection rationale, professional doc-style register.');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS writing_prompts_level_active_idx;
DROP TABLE IF EXISTS writing_prompts;

-- +goose StatementEnd
