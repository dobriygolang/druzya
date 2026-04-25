-- +goose Up
-- +goose StatementBegin
-- ============================================================
-- 00046  F-2: Judge0 sandbox for mock task_solve attempts
-- ============================================================
-- Adds `mock_task_test_cases` — per-task stdin/expected_stdout cases that
-- the orchestrator runs through the Judge0 sandbox when a `task_solve`
-- attempt is submitted. When a task has zero rows here (or task.language
-- = 'any' which Judge0 can't pin down), the orchestrator falls back to
-- the LLM code-review judge (legacy behavior).
--
-- Shape mirrors `test_cases` from 00003_content (daily kata pipeline) so
-- the same Judge0 protocol applies: each case is fed via stdin, stdout
-- is trimmed and compared exactly to expected_output.

CREATE TABLE mock_task_test_cases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id          UUID NOT NULL REFERENCES mock_tasks(id) ON DELETE CASCADE,
    input            TEXT NOT NULL,
    expected_output  TEXT NOT NULL,
    is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
    ordinal          INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mock_task_test_cases_task ON mock_task_test_cases(task_id, ordinal);

-- ─── Seed: a sandbox-ready Two Sum task in Python ─────────────────────
-- The existing 00044 Two Sum is language='any' (LLM-only). We add a new
-- algo task pinned to Python 3 with a stdin/stdout contract so Judge0
-- can grade it. The pre-existing 'any'-language Two Sum stays
-- LLM-graded, exercising the sandbox/LLM split.

INSERT INTO mock_tasks (
  stage_kind, language, difficulty, title, body_md, sample_io_md,
  reference_criteria, reference_solution_md, time_limit_min, active
)
VALUES (
  'algo',
  'python',
  1,
  'Two Sum (sandbox)',
  E'# Two Sum (sandbox)\n\nДана строка с числами через запятую и целое число `target`. Верни индексы двух элементов, сумма которых равна target.\n\n## Протокол ввода/вывода\n\n- stdin: первая строка — числа через запятую, вторая — target.\n- stdout: два индекса через пробел, по возрастанию.\n\n## Пример\n\nstdin:\n```\n2,7,11,15\n9\n```\nstdout:\n```\n0 1\n```\n',
  E'### Sample\nstdin:\n```\n2,7,11,15\n9\n```\nstdout:\n```\n0 1\n```\n',
  '{"must_mention": ["hash map / dict", "single pass O(n)"], "nice_to_have": ["edge case: no solution"], "common_pitfalls": ["O(n^2) double loop", "returning the values instead of indices"]}'::jsonb,
  E'```python\nimport sys\n\nnums = list(map(int, sys.stdin.readline().strip().split('','')))\ntarget = int(sys.stdin.readline().strip())\nseen = {}\nfor i, n in enumerate(nums):\n    if target - n in seen:\n        a, b = sorted((seen[target - n], i))\n        print(a, b)\n        break\n    seen[n] = i\n```',
  20,
  TRUE
)
ON CONFLICT DO NOTHING;

-- Test cases for the new task. Idempotent via WHERE NOT EXISTS so the
-- migration is replayable.
INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT t.id, '2,7,11,15' || E'\n' || '9', '0 1', FALSE, 0
FROM mock_tasks t
WHERE t.title = 'Two Sum (sandbox)'
  AND NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases c
    WHERE c.task_id = t.id AND c.ordinal = 0
  );

INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT t.id, '3,2,4' || E'\n' || '6', '1 2', TRUE, 1
FROM mock_tasks t
WHERE t.title = 'Two Sum (sandbox)'
  AND NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases c
    WHERE c.task_id = t.id AND c.ordinal = 1
  );

INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT t.id, '3,3' || E'\n' || '6', '0 1', TRUE, 2
FROM mock_tasks t
WHERE t.title = 'Two Sum (sandbox)'
  AND NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases c
    WHERE c.task_id = t.id AND c.ordinal = 2
  );

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM mock_task_test_cases
WHERE task_id IN (SELECT id FROM mock_tasks WHERE title = 'Two Sum (sandbox)');
DELETE FROM mock_tasks WHERE title = 'Two Sum (sandbox)';
DROP TABLE IF EXISTS mock_task_test_cases;
-- +goose StatementEnd
