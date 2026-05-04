-- +goose Up
-- +goose StatementBegin

-- 00028_mock_seed.sql
--
-- Минимальный seed для mock-interview core-flow:
--   1. mock_tasks — задачи под coding/algo/sysdesign стейджи (5 шт).
--   2. stage_default_questions — fallback-вопросы под все 5 stage_kind (~10).
--
-- StageKind enum (см backend/services/mock_interview/domain/enum.go):
--   hr / algo / coding / sysdesign / behavioral
-- TaskLanguage: go / python / sql / any
-- ai_strictness_profile_id привязан к 'standard'-профилю из baseline.

-- ── mock_tasks (Phase B/C schema, см 00001 line 1696) ──
INSERT INTO mock_tasks (stage_kind, language, difficulty, title, body_md, sample_io_md, reference_solution_md, time_limit_min, ai_strictness_profile_id)
SELECT v.stage_kind, v.language, v.difficulty, v.title, v.body_md, v.sample_io_md, v.reference_solution_md, v.time_limit_min, p.id
FROM ai_strictness_profiles p
JOIN (VALUES
    ('algo', 'any',    2::SMALLINT, 'Two Sum',
     E'Дан массив целых чисел и target. Верни индексы двух чисел, дающих в сумме target. Каждый input имеет ровно одно решение, один и тот же индекс использовать нельзя.',
     E'Input: nums=[2,7,11,15], target=9\nOutput: [0,1]',
     E'Hash map от value к index: за один проход проверяем complement = target - nums[i] и сразу пишем nums[i]→i. O(n) time, O(n) space.',
     30),

    ('algo', 'any',    3::SMALLINT, 'Longest Substring Without Repeating Characters',
     E'Дана строка. Найди длину самой длинной подстроки без повторяющихся символов.',
     E'Input: "abcabcbb"\nOutput: 3 (abc)\n\nInput: "bbbbb"\nOutput: 1',
     E'Sliding window: left/right указатели + hash-map last-seen-index. При повторе двигаем left = max(left, last_seen[ch] + 1).',
     30),

    ('coding', 'go',   2::SMALLINT, 'Reverse linked list',
     E'Дана голова односвязного списка. Верни голову развёрнутого списка. Решение должно быть iterative.',
     E'Input: 1 → 2 → 3 → 4 → 5\nOutput: 5 → 4 → 3 → 2 → 1',
     E'Three pointers: prev=nil, curr=head, next. В цикле: next = curr.Next; curr.Next = prev; prev = curr; curr = next. В конце return prev.',
     25),

    ('coding', 'python', 3::SMALLINT, 'Group Anagrams',
     E'Дан массив строк. Сгруппируй анаграммы.',
     E'Input: ["eat","tea","tan","ate","nat","bat"]\nOutput: [["bat"],["nat","tan"],["ate","eat","tea"]]',
     E'defaultdict(list) с ключом = tuple(sorted(s)) или 26-tuple частот. O(n·k·log k) или O(n·k).',
     30),

    ('sysdesign', 'any', 4::SMALLINT, 'Design URL Shortener',
     E'Спроектируй сервис вроде bit.ly. Trade-offs: storage, read/write QPS, partitioning, caching, custom aliases.\n\nОжидаемые секции ответа:\n- Functional / non-functional requirements\n- Capacity estimation (QPS, storage)\n- High-level diagram (LB → app → KV/SQL)\n- Hash generation strategy (counter+base62 vs random+collision-check)\n- Read-heavy cache layer\n- Analytics pipeline',
     E'Capacity: 100M URLs/day → ~1B/year → 7-char base62 = 62^7 ≈ 3.5T (хватит).',
     E'',
     45)
) AS v(stage_kind, language, difficulty, title, body_md, sample_io_md, reference_solution_md, time_limit_min)
ON p.slug = 'standard';
-- Без ON CONFLICT — у mock_tasks нет UNIQUE-ограничения кроме id (gen_random_uuid).
-- Goose не повторяет успешно применённую миграцию, дубликатов не будет.

-- ── stage_default_questions (Phase B/C schema, см 00001 line 1750) ──
INSERT INTO stage_default_questions (stage_kind, body, expected_answer_md, sort_order) VALUES
-- HR
('hr',          'Расскажи о себе за 90 секунд. Технологии, последние 1-2 проекта, чего ищешь.', E'Структура: технологии (1 фраза) → один impact-проект → motivation. **Не надо**: жизненная история / жалобы.', 10),
('hr',          'Почему наша компания и почему сейчас?',                                      E'Конкретика: один продукт + одна команда / стек. **Не надо**: «у вас классная культура» без подкрепления.', 20),

-- algo
('algo',        'Приведи пример O(n²) → O(n log n) оптимизации, которую ты делал.',           E'Конкретный пример с измеримым impact. Sorting / hashing / two-pointers — стандартные ходы.', 10),
('algo',        'Что за алгоритм Дейкстры и в чём его ограничение?',                          E'Кратчайшие пути из одной вершины в графе с **неотрицательными** весами. Ограничение: с отрицательными — Bellman-Ford.', 20),

-- coding
('coding',      'Как ты дебажишь рандомно зависающую горутину в проде?',                      E'pprof goroutine dump → grep на блокирующие select/chan. Race detector (тестово). runtime.Stack для slow path.', 10),
('coding',      'Как реализовать context.WithTimeout без stdlib?',                            E'Канал done; goroutine с time.NewTimer; в Done() возвращаем канал; cancel() закрывает done. Tricky: race на close — sync.Once.', 20),

-- sysdesign
('sysdesign',   'Когда выбрать SQL vs NoSQL?',                                                E'SQL: транзакции, joins, известная схема, ACID. NoSQL: горизонтальный scale, гибкая схема, eventual consistency OK.', 10),
('sysdesign',   'Объясни consistency vs availability на примере.',                            E'CAP: при partition выбирай одно. Пример CP: Postgres replication с sync. AP: DynamoDB с eventual.', 20),

-- behavioral
('behavioral',  'Расскажи о конфликте с коллегой и как ты его разрешил (STAR).',              E'Situation / Task / Action / Result. Action = специфика твоего шага, Result = метрика.', 10),
('behavioral',  'Опиши проект, где ты не справился. Чему научился?',                          E'Реальный fail (не «работал слишком много»). Урок про process / communication / scope.', 20);
-- Без ON CONFLICT — gen_random_uuid PK, UNIQUE-ограничений нет.

-- task_templates (Phase A schema, см 00001 line 368). Привязан к
-- arena/daily-kata `tasks` (засеяны в 00026). Минимальный starter-code
-- per language под несколько задач. Если задача не из 00026, миграция
-- молча её пропустит (LEFT JOIN не используется — внутренний JOIN).
INSERT INTO task_templates (task_id, language, starter_code)
SELECT t.id, v.language, v.starter_code
FROM tasks t
JOIN (VALUES
    ('two-sum',           'go',         E'package main\n\nfunc twoSum(nums []int, target int) []int {\n\t// TODO\n\treturn nil\n}'),
    ('two-sum',           'python',     E'def two_sum(nums: list[int], target: int) -> list[int]:\n    # TODO\n    return []'),
    ('two-sum',           'javascript', E'function twoSum(nums, target) {\n  // TODO\n  return [];\n}'),
    ('reverse-string',    'go',         E'package main\n\nfunc reverseString(s []byte) {\n\t// in-place\n}'),
    ('reverse-string',    'python',     E'def reverse_string(s: list[str]) -> None:\n    # in-place\n    pass'),
    ('valid-parentheses', 'go',         E'package main\n\nfunc isValid(s string) bool {\n\t// TODO\n\treturn false\n}'),
    ('valid-parentheses', 'python',     E'def is_valid(s: str) -> bool:\n    # TODO\n    return False'),
    ('longest-substring', 'go',         E'package main\n\nfunc lengthOfLongestSubstring(s string) int {\n\t// TODO\n\treturn 0\n}'),
    ('longest-substring', 'python',     E'def length_of_longest_substring(s: str) -> int:\n    # TODO\n    return 0'),
    ('select-employees',  'sql',        E'-- employees(id, name, salary, dept_id)\nSELECT /* TODO */ FROM employees;')
) AS v(slug, language, starter_code)
ON t.slug = v.slug
ON CONFLICT (task_id, language) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
