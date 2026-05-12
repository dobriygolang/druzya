-- 00105_speaking.sql — Phase J / H4 (P1) Speaking modality в English hub.
--
-- Hone English hub had three modalities (Reading SRS / Writing grader /
-- Listening transcript) but Speaking was missing → hub ≈ Reader. H4
-- closes the loop: shadowing exercises (read prompt → record mic →
-- STT-grade against reference → coach feedback) + persisted sessions
-- для accent drift tracking.
--
-- Two tables:
--   • speaking_exercises — canned prompts (B1/B2/C1) seeded via insert.
--     Not per-user — every Hone install reads the same fixed catalog.
--     Audio (reference TTS) deferred: column kept nullable so we can
--     backfill when ElevenLabs/Google TTS gets wired.
--   • speaking_sessions — one row per recording. user_transcript +
--     scores + coach feedback. Idempotent via UNIQUE(user_id,
--     client_session_id) — Hone outbox replay-safe.
--
-- Index strategy:
--   • idx_speaking_sessions_user_created — covers history list (14
--     most-recent per user) + sparkline trend query (30d window).
--   • UNIQUE(user_id, client_session_id) — outbox idempotency.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE speaking_exercises (
    id          TEXT PRIMARY KEY,
    level       TEXT NOT NULL,
    topic       TEXT NOT NULL DEFAULT '',
    prompt      TEXT NOT NULL,
    audio_url   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT speaking_exercises_level_valid
        CHECK (level IN ('B1','B2','C1'))
);

CREATE TABLE speaking_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- client_session_id — client-generated UUID for outbox idempotency.
    -- Hone may replay a grade-RPC after reconnect; UNIQUE guarantees the
    -- repeat collapses into one row (server-side ON CONFLICT DO NOTHING
    -- in the use-case).
    client_session_id    TEXT NOT NULL,
    -- exercise_id — soft FK to speaking_exercises(id). Not a hard FK so
    -- exercise catalog can be re-seeded without orphaning history rows.
    exercise_id          TEXT NOT NULL,
    -- prompt snapshot — keep verbatim text at submission time. Catalog
    -- edits don't rewrite history.
    prompt               TEXT NOT NULL,
    user_transcript      TEXT NOT NULL DEFAULT '',
    pronunciation_score  SMALLINT CHECK (pronunciation_score IS NULL OR pronunciation_score BETWEEN 0 AND 100),
    fluency_score        SMALLINT CHECK (fluency_score IS NULL OR fluency_score BETWEEN 0 AND 100),
    coach_feedback       TEXT NOT NULL DEFAULT '',
    duration_ms          INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT speaking_sessions_user_client_unique
        UNIQUE (user_id, client_session_id)
);

CREATE INDEX idx_speaking_sessions_user_created
    ON speaking_sessions(user_id, created_at DESC);

-- Seed exercise catalog. Mix of B1/B2/C1, topics aligned with druz9
-- identity (interview prep + daily English + sysdesign verbal explanation).
-- Audio URL empty for now → client uses native speechSynthesis as TTS
-- fallback (TODO: wire ElevenLabs/Google TTS pipeline → CDN).
INSERT INTO speaking_exercises (id, level, topic, prompt) VALUES
    ('greet-1',    'B1', 'daily',     'How do you do? Nice to meet you. I work as a software engineer.'),
    ('greet-2',    'B1', 'daily',     'Could you tell me a little about yourself and your background?'),
    ('idiom-1',    'B1', 'daily',     'Let me think about that for a second. That''s a good question.'),
    ('idiom-2',    'B2', 'daily',     'I''d like to take a step back and look at the bigger picture here.'),
    ('algo-1',     'B2', 'interview', 'Let me walk you through the algorithm step by step.'),
    ('algo-2',     'B2', 'interview', 'The time complexity is O of N log N, and the space complexity is O of N.'),
    ('algo-3',     'B2', 'interview', 'I would use a hash map to keep track of the values we have already seen.'),
    ('sysdes-1',   'B2', 'sysdesign', 'We would shard the database by user ID to distribute the load evenly.'),
    ('sysdes-2',   'C1', 'sysdesign', 'To handle the read-heavy workload, I would introduce a caching layer between the API and the database.'),
    ('sysdes-3',   'C1', 'sysdesign', 'The trade-off here is consistency versus availability — under CAP, we have to choose one when a network partition occurs.'),
    ('behave-1',   'B2', 'interview', 'In my previous role, I was responsible for designing the payment processing pipeline.'),
    ('behave-2',   'B2', 'interview', 'One of the most challenging projects I worked on involved migrating a legacy monolith to microservices.'),
    ('behave-3',   'C1', 'interview', 'When I run into a tricky bug, I usually start by writing a failing test that reproduces the issue.'),
    ('debate-1',   'C1', 'sysdesign', 'I would argue that strong consistency is overrated for most user-facing features — eventual consistency is usually sufficient.'),
    ('debate-2',   'C1', 'sysdesign', 'Microservices add operational complexity that you should only pay for if your team is large enough to absorb it.');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_speaking_sessions_user_created;
DROP TABLE IF EXISTS speaking_sessions;
DROP TABLE IF EXISTS speaking_exercises;

-- +goose StatementEnd
