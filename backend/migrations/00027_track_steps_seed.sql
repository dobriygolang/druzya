-- +goose Up
-- +goose StatementBegin

-- 00027_track_steps_seed.sql
--
-- Seed для `track_steps` — без него `LearningTrackProgress.steps_total = 0`,
-- vanguard JSON-transcoder опускает proto3 default-int → frontend
-- видит `undefined`, рендерит «STEP UNDEFINED/UNDEFINED» + NaN-кругляшки.
-- Defensive guards в TrackDetail добавлены, но реальная семантика
-- (continue/advance/practice CTA) ждёт здесь живые шаги.
--
-- Покрываем 4 курируемых трека из 00001 baseline. По 7 шагов на трек —
-- достаточно чтобы UI читался; админ может расширить через CMS.

-- Helper: вынимаем track_id по slug в CTE-стиле через подзапросы.

INSERT INTO track_steps (track_id, step_index, title, description_md, skill_keys, required_kind, required_count, recommended_reading, estimated_minutes)
SELECT t.id, v.step_index, v.title, v.description_md, v.skill_keys, v.required_kind::track_step_kind, v.required_count, v.recommended_reading, v.estimated_minutes
FROM tracks t
JOIN (VALUES
    -- ── algorithms-full-cycle ──
    ('algorithms-full-cycle', 0::SMALLINT, 'Two pointers warm-up',         'Базовый паттерн на массивах. Решить 5 кат на two-pointers.',           ARRAY['two-pointers']::TEXT[],                'kata',     5, ARRAY['sliding-window']::TEXT[],                                     90),
    ('algorithms-full-cycle', 1::SMALLINT, 'Sliding window mastery',       'Перейти от фиксированного окна к динамическому. 5 кат + одна arena.',  ARRAY['sliding-window']::TEXT[],              'kata',     5, ARRAY['two-pointers']::TEXT[],                                       120),
    ('algorithms-full-cycle', 2::SMALLINT, 'Binary search depth',          'Не только в массивах: бинарка по ответу + boundary-задачи.',            ARRAY['binary-search']::TEXT[],               'kata',     5, ARRAY[]::TEXT[],                                                     120),
    ('algorithms-full-cycle', 3::SMALLINT, 'Hashing / dedup',              'Hash map шаблоны: счётчики, anagrams, prefix-sums.',                    ARRAY['hashing']::TEXT[],                     'kata',     5, ARRAY[]::TEXT[],                                                     90),
    ('algorithms-full-cycle', 4::SMALLINT, 'Stack / monotonic',            'Sequencing-задачи: largest rectangle, daily temperatures.',             ARRAY['stack']::TEXT[],                       'kata',     4, ARRAY[]::TEXT[],                                                     90),
    ('algorithms-full-cycle', 5::SMALLINT, 'BFS / DFS',                    'Графы и обходы. 4 кат + одна 1v1 arena duel.',                          ARRAY['graphs','bfs','dfs']::TEXT[],          'arena',    1, ARRAY['union-find']::TEXT[],                                         180),
    ('algorithms-full-cycle', 6::SMALLINT, 'DP foundations',               'Memoization → bottom-up. 5 кат на classic DP.',                         ARRAY['dp']::TEXT[],                          'kata',     5, ARRAY[]::TEXT[],                                                     150),

    -- ── system-design-from-zero ──
    ('system-design-from-zero', 0::SMALLINT, 'Caching strategies',          'Read-through / write-back / write-around. Codex pre-read + краткий sketch.', ARRAY['caching']::TEXT[],         'codex_read', 1, ARRAY['caching-strategies']::TEXT[],                                 60),
    ('system-design-from-zero', 1::SMALLINT, 'Consistency models',          'CAP, ACID vs BASE, eventually consistent системы.',                   ARRAY['consistency']::TEXT[],                'codex_read', 2, ARRAY['cap']::TEXT[],                                                90),
    ('system-design-from-zero', 2::SMALLINT, 'Sharding & partitioning',     'Range / hash / directory. Trade-offs и migration patterns.',           ARRAY['sharding']::TEXT[],                   'mock',       1, ARRAY['consistent-hashing']::TEXT[],                                 120),
    ('system-design-from-zero', 3::SMALLINT, 'Load balancing',              'L4 vs L7, sticky sessions, health checks.',                            ARRAY['load-balancer']::TEXT[],              'codex_read', 1, ARRAY['load-balancing']::TEXT[],                                     60),
    ('system-design-from-zero', 4::SMALLINT, 'Queues / messaging',          'Kafka / RabbitMQ / SQS — выбор и trade-offs.',                          ARRAY['queues']::TEXT[],                     'codex_read', 1, ARRAY[]::TEXT[],                                                     90),
    ('system-design-from-zero', 5::SMALLINT, 'Sysdesign mock #1',           'Design twitter feed. 45 минут, AI-judge.',                              ARRAY['system-design']::TEXT[],              'mock',       1, ARRAY[]::TEXT[],                                                     180),
    ('system-design-from-zero', 6::SMALLINT, 'Sysdesign mock #2',           'Design URL shortener. С метриками + capacity planning.',                ARRAY['system-design']::TEXT[],              'mock',       1, ARRAY[]::TEXT[],                                                     180),

    -- ── senior-backend-pack ──
    ('senior-backend-pack', 0::SMALLINT, 'Algo screen warm-up',             '3 medium-кат на 30 минут каждая. Симуляция screen.',                    ARRAY['algorithms']::TEXT[],                 'kata',       3, ARRAY[]::TEXT[],                                                     90),
    ('senior-backend-pack', 1::SMALLINT, 'Sysdesign baseline',              'Один полный sysdesign-mock с AI-judge.',                                 ARRAY['system-design']::TEXT[],              'mock',       1, ARRAY[]::TEXT[],                                                     180),
    ('senior-backend-pack', 2::SMALLINT, 'Behavioral STAR',                 '5 STAR-историй, разобранных по структуре.',                              ARRAY['behavioral']::TEXT[],                 'mock',       1, ARRAY['star-method']::TEXT[],                                        120),
    ('senior-backend-pack', 3::SMALLINT, 'Coding under pressure',           '1v1 arena duel — без подсказок, на скорость.',                          ARRAY['algorithms']::TEXT[],                 'arena',      1, ARRAY[]::TEXT[],                                                     90),
    ('senior-backend-pack', 4::SMALLINT, 'SQL sanity',                      'Window functions + EXPLAIN reading.',                                    ARRAY['sql']::TEXT[],                        'kata',       3, ARRAY['window-functions','indexes']::TEXT[],                         90),
    ('senior-backend-pack', 5::SMALLINT, 'Sysdesign mock #2',               'Под другую доменную область — payments / search / feed.',               ARRAY['system-design']::TEXT[],              'mock',       1, ARRAY[]::TEXT[],                                                     180),
    ('senior-backend-pack', 6::SMALLINT, 'Mock interview pipeline',         'Полный 4-stage pipeline. Финальная репетиция.',                         ARRAY['interview']::TEXT[],                  'mock',       1, ARRAY[]::TEXT[],                                                     240),

    -- ── mock-marathon-7 ──
    ('mock-marathon-7', 0::SMALLINT, 'Day 1 · screening',                   'Одна algo-секция на 45 минут. Без подсказок.',                          ARRAY['algorithms']::TEXT[],                 'mock',       1, ARRAY[]::TEXT[],                                                     90),
    ('mock-marathon-7', 1::SMALLINT, 'Day 2 · algo',                        'Две medium-задачи + одна hard. С таймером.',                            ARRAY['algorithms']::TEXT[],                 'mock',       1, ARRAY[]::TEXT[],                                                     120),
    ('mock-marathon-7', 2::SMALLINT, 'Day 3 · coding',                      '1v1 arena duel + одна solo kata.',                                       ARRAY['coding']::TEXT[],                     'arena',      1, ARRAY[]::TEXT[],                                                     120),
    ('mock-marathon-7', 3::SMALLINT, 'Day 4 · sysdesign',                   'Полный sysdesign-mock с AI-judge.',                                      ARRAY['system-design']::TEXT[],              'mock',       1, ARRAY[]::TEXT[],                                                     180),
    ('mock-marathon-7', 4::SMALLINT, 'Day 5 · behavioral',                  '5 STAR-историй + разбор слабых.',                                        ARRAY['behavioral']::TEXT[],                 'mock',       1, ARRAY['star-method']::TEXT[],                                        90),
    ('mock-marathon-7', 5::SMALLINT, 'Day 6 · debrief',                     'Разбор всех 5 mock-результатов. Что подкрутить.',                       ARRAY['debrief']::TEXT[],                    'codex_read', 1, ARRAY[]::TEXT[],                                                     90),
    ('mock-marathon-7', 6::SMALLINT, 'Day 7 · rest',                        'Active recovery — лёгкая kata + сон.',                                   ARRAY['recovery']::TEXT[],                   'kata',       1, ARRAY[]::TEXT[],                                                     45)
) AS v(slug, step_index, title, description_md, skill_keys, required_kind, required_count, recommended_reading, estimated_minutes)
ON v.slug = t.slug
ON CONFLICT (track_id, step_index) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
