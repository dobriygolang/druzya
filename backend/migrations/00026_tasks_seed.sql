-- +goose Up
-- +goose StatementBegin

-- 00026_tasks_seed.sql
--
-- Seed для `tasks` (daily kata + arena task pool). Без него
-- `GET /api/v1/daily/kata` возвращает 404 «no active tasks for
-- section=algorithms» (см backend/services/daily/app/get_kata.go:71).
--
-- 9 задач (3 easy / 3 medium / 3 hard) в section='algorithms', ещё
-- 3 в 'sql' для разнообразия. Title/description минимальные, но
-- достаточные чтобы UI зарендерился; продвинутый каталог админ
-- наполнит через admin-tools (или подключит из Codex).

INSERT INTO tasks (slug, title_ru, title_en, description_ru, description_en, difficulty, section, solution_hint) VALUES
('two-sum',
 'Two Sum',
 'Two Sum',
 E'Дан массив целых чисел и target. Верни индексы двух чисел, дающих в сумме target.\n\nПример:\n  Input: nums=[2,7,11,15], target=9\n  Output: [0,1]',
 'Given an array and target, return indices of the two numbers summing to target.',
 'easy', 'algorithms',
 'Hash map от value к index — за один проход.'),
('reverse-string',
 'Reverse String',
 'Reverse String',
 E'Разверни строку in-place.\n\nПример:\n  Input: ["h","e","l","l","o"]\n  Output: ["o","l","l","e","h"]',
 'Reverse a string in-place.',
 'easy', 'algorithms',
 'Two pointers слева и справа.'),
('valid-parentheses',
 'Valid Parentheses',
 'Valid Parentheses',
 E'Дана строка из ()[]{}. Проверь, что скобки сбалансированы.\n\nПример:\n  Input: "()[]{}"\n  Output: true',
 'Check if brackets in a string are balanced.',
 'easy', 'algorithms',
 'Stack: push открывающую, pop при закрывающей.'),
('longest-substring',
 'Longest Substring Without Repeat',
 'Longest Substring Without Repeat',
 E'Найди длину самой длинной подстроки без повторов.\n\nПример:\n  Input: "abcabcbb"\n  Output: 3',
 'Length of longest substring without repeating characters.',
 'medium', 'algorithms',
 'Sliding window + hash map последних позиций.'),
('product-except-self',
 'Product of Array Except Self',
 'Product of Array Except Self',
 E'Верни массив, где каждый элемент = произведение всех остальных. Без деления, O(n).',
 'Return array where each element is product of all others. No division, O(n).',
 'medium', 'algorithms',
 'Два прохода: префикс-произведение слева, суффикс справа.'),
('group-anagrams',
 'Group Anagrams',
 'Group Anagrams',
 E'Сгруппируй строки, являющиеся анаграммами.',
 'Group strings that are anagrams of each other.',
 'medium', 'algorithms',
 'Hash map: ключ — отсортированная строка.'),
('median-two-sorted',
 'Median of Two Sorted Arrays',
 'Median of Two Sorted Arrays',
 E'Найди медиану двух отсортированных массивов за O(log(m+n)).',
 'Find the median of two sorted arrays in O(log(m+n)).',
 'hard', 'algorithms',
 'Binary search по партициям.'),
('trap-rain-water',
 'Trapping Rain Water',
 'Trapping Rain Water',
 E'Дан массив высот столбиков. Сколько воды задержит между ними дождь?',
 'Given heights, compute how much water can be trapped after rain.',
 'hard', 'algorithms',
 'Two pointers с поддержкой left_max/right_max.'),
('word-ladder',
 'Word Ladder',
 'Word Ladder',
 E'Найди кратчайшую цепочку трансформаций одного слова в другое (-1 если невозможно).',
 'Shortest transformation chain between two words (or -1 if impossible).',
 'hard', 'algorithms',
 'BFS по графу слов с одной заменой буквы.'),

-- ── SQL ──
('select-employees',
 'Самые высокооплачиваемые',
 'Top Earners',
 E'Таблица employees(id, name, salary, dept_id). Найди сотрудников с максимальной зарплатой в каждом отделе.',
 'Find the highest-paid employee per department.',
 'easy', 'sql',
 'Window function: RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC).'),
('nth-highest',
 'N-я высокая зарплата',
 'Nth Highest Salary',
 E'Верни N-ю по величине зарплату из таблицы employees.',
 'Return the Nth highest salary.',
 'medium', 'sql',
 'DENSE_RANK() или OFFSET с LIMIT.'),
('consecutive-numbers',
 'Три подряд одинаковых',
 'Three Consecutive Numbers',
 E'Найди числа, появляющиеся 3 раза подряд в таблице logs(id, num).',
 'Find numbers appearing three times in a row.',
 'medium', 'sql',
 'Self-join по id+1 и id+2 или window LAG/LEAD.')
ON CONFLICT (slug) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive seed; rollback drops the DB
-- +goose StatementEnd
