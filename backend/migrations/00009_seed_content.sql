-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- COMPANIES (5)
-- Bible §26 MVP: Avito / Ozon / Yandex + VK / T-Bank for atmosphere
-- ============================================================
INSERT INTO companies(slug, name, difficulty, min_level_required, sections) VALUES
  ('avito',  'Avito',  'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('vk',     'VK',     'normal', 0,  ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('t-bank', 'T-Bank', 'hard',   12, ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('ozon',   'Ozon',   'hard',   10, ARRAY['algorithms','sql','go','system_design','behavioral']),
  ('yandex', 'Yandex', 'boss',   30, ARRAY['algorithms','sql','go','system_design','behavioral'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- TASKS (50): 30 algorithms + 15 sql + 3 go + 2 system_design
-- Bible §26: rephrase classic LeetCode patterns with druz9/backend flavour
-- ============================================================
INSERT INTO tasks(slug, title_ru, title_en, description_ru, description_en, difficulty, section, time_limit_sec, memory_limit_mb, solution_hint, version, is_active) VALUES

-- ---------- ALGORITHMS :: EASY (10) ----------
('two-sum-transactions', 'Две суммы транзакций', 'Two Transaction Sums',
'## Задача
Дан массив сумм транзакций `nums` и целевое значение `target`. Верните индексы двух транзакций, сумма которых равна `target`. Каждая пара встречается ровно один раз, один и тот же индекс использовать нельзя.

## Ограничения
- 2 ≤ len(nums) ≤ 10^4
- -10^9 ≤ nums[i], target ≤ 10^9

## Пример
Вход: `nums=[2,7,11,15], target=9`
Выход: `[0,1]` — транзакции 2 и 7 в сумме дают 9.',
'## Task
Given an array of transaction amounts `nums` and a target `target`, return indices of the two transactions whose sum equals `target`. Exactly one valid pair exists; the same index cannot be used twice.

## Constraints
- 2 ≤ len(nums) ≤ 10^4
- -10^9 ≤ nums[i], target ≤ 10^9

## Example
Input: `nums=[2,7,11,15], target=9`
Output: `[0,1]` — transactions 2 and 7 sum to 9.',
'easy', 'algorithms', 60, 256,
'Use a hash map value→index. For each x check if target-x already seen; O(n) time, O(n) memory. Brute force O(n^2) will TLE on 10^4.',
1, TRUE),

('valid-brackets-log', 'Валидные скобки в логе', 'Valid Log Brackets',
'## Задача
В строке лога встречаются только символы `()[]{}`. Строка валидна, если скобки открываются и закрываются в правильном порядке и каждому закрытию соответствует тот же тип открытия.

## Ограничения
- 1 ≤ len(s) ≤ 10^4

## Пример
Вход: `s="([]){}"` → `true`
Вход: `s="(]"` → `false`',
'## Task
A log string contains only `()[]{}`. A string is valid when brackets open and close in the proper order and every closing matches its opening type.

## Constraints
- 1 ≤ len(s) ≤ 10^4

## Example
Input: `s="([]){}"` → `true`
Input: `s="(]"` → `false`',
'easy', 'algorithms', 60, 256,
'Classic stack problem. Push openers, on closer pop and compare. Empty stack at end means valid. Any mismatch or empty-pop = false.',
1, TRUE),

('reverse-event-chain', 'Развернуть цепочку событий', 'Reverse Event Chain',
'## Задача
Односвязный список событий. Разверните порядок так, чтобы первый элемент стал последним. Верните голову нового списка.

## Ограничения
- 0 ≤ длина ≤ 5000

## Пример
Вход: `1 -> 2 -> 3 -> null`
Выход: `3 -> 2 -> 1 -> null`',
'## Task
Reverse a singly-linked event list so the first element becomes the last. Return the new head.

## Constraints
- 0 ≤ length ≤ 5000

## Example
Input: `1 -> 2 -> 3 -> null`
Output: `3 -> 2 -> 1 -> null`',
'easy', 'algorithms', 60, 256,
'Iterative with three pointers (prev, curr, next). Rewire curr.next=prev. O(n) time, O(1) memory. Recursive is elegant but uses O(n) stack.',
1, TRUE),

('max-subarray-revenue', 'Максимальный подотрезок выручки', 'Maximum Revenue Subarray',
'## Задача
Массив ежедневной выручки может содержать отрицательные значения (возвраты превышают продажи). Найдите непрерывный подотрезок с максимальной суммой.

## Ограничения
- 1 ≤ len(nums) ≤ 10^5
- -10^4 ≤ nums[i] ≤ 10^4

## Пример
Вход: `[-2,1,-3,4,-1,2,1,-5,4]` → `6` (подотрезок `[4,-1,2,1]`).',
'## Task
Given an array of daily revenue that may contain negatives (refunds exceed sales), find the contiguous subarray with the largest sum.

## Constraints
- 1 ≤ len(nums) ≤ 10^5
- -10^4 ≤ nums[i] ≤ 10^4

## Example
Input: `[-2,1,-3,4,-1,2,1,-5,4]` → `6` (subarray `[4,-1,2,1]`).',
'easy', 'algorithms', 60, 256,
'Kadane''s algorithm: curr = max(x, curr+x); best = max(best, curr). O(n) / O(1).',
1, TRUE),

('climbing-rating-ladder', 'Подъём по рейтинговой лестнице', 'Climbing the Rating Ladder',
'## Задача
Игрок может подняться на 1 или 2 ступени рейтинга за шаг. Сколькими способами он достигнет уровня n?

## Ограничения
- 1 ≤ n ≤ 45

## Пример
n=2 → 2, n=3 → 3, n=5 → 8.',
'## Task
A player can climb 1 or 2 rating tiers per move. How many distinct ways to reach tier n?

## Constraints
- 1 ≤ n ≤ 45

## Example
n=2 → 2, n=3 → 3, n=5 → 8.',
'easy', 'algorithms', 60, 256,
'Fibonacci-style DP. Two rolling vars, no array needed. f(n)=f(n-1)+f(n-2).',
1, TRUE),

('contains-duplicate-uid', 'Дубликаты user_id', 'Duplicate User IDs',
'## Задача
Массив user_id. Вернуть `true`, если какой-либо id встречается более одного раза.

## Ограничения
- 1 ≤ len(nums) ≤ 10^5

## Пример
`[1,2,3,1]` → `true`, `[1,2,3,4]` → `false`.',
'## Task
Return `true` if any user_id appears more than once in the array.

## Constraints
- 1 ≤ len(nums) ≤ 10^5

## Example
`[1,2,3,1]` → `true`, `[1,2,3,4]` → `false`.',
'easy', 'algorithms', 60, 256,
'Hash set: return true on first re-insert. O(n)/O(n). Sort + sweep is O(n log n)/O(1).',
1, TRUE),

('best-time-buy-sell-token', 'Лучший момент купить/продать токен', 'Best Time to Buy/Sell Token',
'## Задача
Массив цен токена по дням. Выберите день покупки и более поздний день продажи с максимальной прибылью. Если прибыли нет, верните 0.

## Ограничения
- 1 ≤ len(prices) ≤ 10^5

## Пример
`[7,1,5,3,6,4]` → `5` (купить на 1, продать на 6).',
'## Task
Array of daily token prices. Pick a buy day and a later sell day to maximise profit. Return 0 if no profit.

## Constraints
- 1 ≤ len(prices) ≤ 10^5

## Example
`[7,1,5,3,6,4]` → `5` (buy 1, sell 6).',
'easy', 'algorithms', 60, 256,
'Single pass, track min price so far and max profit = price-minSoFar. O(n)/O(1).',
1, TRUE),

('valid-palindrome-slug', 'Палиндромный slug', 'Valid Palindrome Slug',
'## Задача
Строка slug. Проверить, является ли она палиндромом, учитывая только буквы и цифры и игнорируя регистр.

## Ограничения
- 1 ≤ len(s) ≤ 2×10^5

## Пример
`"A man, a plan, a canal: Panama"` → `true`.',
'## Task
Given a slug, decide whether it is a palindrome considering only alphanumerics, ignoring case.

## Constraints
- 1 ≤ len(s) ≤ 2×10^5

## Example
`"A man, a plan, a canal: Panama"` → `true`.',
'easy', 'algorithms', 60, 256,
'Two pointers from both ends; skip non-alphanumeric; compare lower-cased. O(n)/O(1).',
1, TRUE),

('merge-sorted-queues', 'Слияние двух отсортированных очередей', 'Merge Two Sorted Queues',
'## Задача
Даны два отсортированных связанных списка запросов. Слейте их в один отсортированный список и верните голову.

## Ограничения
- 0 ≤ длины ≤ 50

## Пример
Вход: `1->2->4`, `1->3->4`
Выход: `1->1->2->3->4->4`',
'## Task
Merge two sorted linked lists of requests into one sorted list; return the new head.

## Constraints
- 0 ≤ lengths ≤ 50

## Example
Input: `1->2->4`, `1->3->4`
Output: `1->1->2->3->4->4`',
'easy', 'algorithms', 60, 256,
'Iterative with a dummy head; at each step append the smaller head. O(n+m)/O(1). Recursion also works but costs stack.',
1, TRUE),

('binary-search-logs', 'Двоичный поиск по логам', 'Binary Search Over Logs',
'## Задача
Отсортированный массив timestamp-ов логов и целевой `target`. Вернуть индекс или -1, если нет.

## Ограничения
- 1 ≤ len(nums) ≤ 10^4

## Пример
`nums=[-1,0,3,5,9,12], target=9` → `4`.',
'## Task
Sorted array of log timestamps and a target. Return index, or -1 if absent.

## Constraints
- 1 ≤ len(nums) ≤ 10^4

## Example
`nums=[-1,0,3,5,9,12], target=9` → `4`.',
'easy', 'algorithms', 60, 256,
'Classic binary search. Use lo+(hi-lo)/2 to avoid overflow. O(log n)/O(1).',
1, TRUE),

-- ---------- ALGORITHMS :: MEDIUM (15) ----------
('lru-session-cache', 'LRU-кэш сессий', 'LRU Session Cache',
'## Задача
Реализуйте LRU-кэш сессий фиксированной ёмкости с операциями `get(key)` и `put(key,value)` за O(1).

## Ограничения
- 1 ≤ capacity ≤ 3000
- до 2×10^5 операций

## Пример
`put(1,1); put(2,2); get(1)=1; put(3,3) вытесняет 2; get(2)=-1`',
'## Task
Implement an LRU session cache with fixed capacity supporting `get(key)` and `put(key,value)` in O(1).

## Constraints
- 1 ≤ capacity ≤ 3000
- up to 2×10^5 operations

## Example
`put(1,1); put(2,2); get(1)=1; put(3,3) evicts 2; get(2)=-1`',
'medium', 'algorithms', 90, 256,
'Doubly-linked list + hashmap: map key→node, list orders by recency. Touch on get, evict tail on overflow.',
1, TRUE),

('merge-incident-intervals', 'Слияние интервалов инцидентов', 'Merge Incident Intervals',
'## Задача
Массив интервалов инцидентов `[start,end]`. Слейте пересекающиеся и верните минимальный набор непересекающихся интервалов.

## Ограничения
- 1 ≤ len(intervals) ≤ 10^4

## Пример
`[[1,3],[2,6],[8,10],[15,18]]` → `[[1,6],[8,10],[15,18]]`',
'## Task
Given incident intervals `[start,end]`, merge overlaps and return the minimal set of disjoint intervals.

## Constraints
- 1 ≤ len(intervals) ≤ 10^4

## Example
`[[1,3],[2,6],[8,10],[15,18]]` → `[[1,6],[8,10],[15,18]]`',
'medium', 'algorithms', 90, 256,
'Sort by start. Walk; if cur.start ≤ last.end extend last.end=max(last.end,cur.end), else push. O(n log n).',
1, TRUE),

('group-anagram-tags', 'Группировка анаграмм-тегов', 'Group Anagram Tags',
'## Задача
Дан список тегов. Сгруппируйте те, что являются анаграммами друг друга.

## Ограничения
- 1 ≤ len(tags) ≤ 10^4
- 0 ≤ len(tag) ≤ 100

## Пример
`["eat","tea","tan","ate","nat","bat"]` → `[["bat"],["nat","tan"],["ate","eat","tea"]]`',
'## Task
Group tags that are anagrams of each other.

## Constraints
- 1 ≤ len(tags) ≤ 10^4
- 0 ≤ len(tag) ≤ 100

## Example
`["eat","tea","tan","ate","nat","bat"]` → `[["bat"],["nat","tan"],["ate","eat","tea"]]`',
'medium', 'algorithms', 90, 256,
'Key = sorted(tag) or 26-length count signature. Bucket into map[key][]string. O(n·k log k).',
1, TRUE),

('top-k-hottest-queries', 'Топ-K самых частых запросов', 'Top K Hottest Queries',
'## Задача
Массив строк-запросов, число `k`. Верните `k` наиболее частых. Порядок среди равных не важен.

## Ограничения
- 1 ≤ len(queries) ≤ 10^5
- 1 ≤ k ≤ число уникальных

## Пример
`["a","b","a","c","b","a"], k=2` → `["a","b"]`',
'## Task
Given an array of query strings and `k`, return the `k` most frequent. Order among ties is free.

## Constraints
- 1 ≤ len(queries) ≤ 10^5
- 1 ≤ k ≤ unique count

## Example
`["a","b","a","c","b","a"], k=2` → `["a","b"]`',
'medium', 'algorithms', 90, 256,
'Counter + min-heap of size k, or bucket sort on frequency. Heap: O(n log k).',
1, TRUE),

('codeword-in-grid', 'Поиск кодового слова в сетке', 'Codeword in Grid',
'## Задача
Сетка символов `board` и слово `word`. Существует ли путь из смежных (по стороне) клеток, образующих слово? Клетку повторно не использовать.

## Ограничения
- 1 ≤ m,n ≤ 6
- 1 ≤ len(word) ≤ 15

## Пример
`board=[["A","B"],["C","D"]], word="ABDC"` → `true`',
'## Task
Grid of characters `board` and a `word`. Does a path of side-adjacent cells spell the word without reusing cells?

## Constraints
- 1 ≤ m,n ≤ 6
- 1 ≤ len(word) ≤ 15

## Example
`board=[["A","B"],["C","D"]], word="ABDC"` → `true`',
'medium', 'algorithms', 90, 256,
'DFS + backtracking; mark visited then unmark. Prune when char ≠ word[i]. Worst O(m·n·4^L).',
1, TRUE),

('change-for-coin-drop', 'Размен монет дропа', 'Coin Drop Change',
'## Задача
Набор номиналов `coins` и целевая сумма `amount`. Минимальное число монет для суммы; -1, если невозможно. Каждую монету можно брать сколько угодно раз.

## Ограничения
- 1 ≤ len(coins) ≤ 12
- 1 ≤ amount ≤ 10^4

## Пример
`coins=[1,2,5], amount=11` → `3` (5+5+1).',
'## Task
Set of denominations `coins` and target `amount`. Minimum coins needed; -1 if impossible. Each coin is unlimited.

## Constraints
- 1 ≤ len(coins) ≤ 12
- 1 ≤ amount ≤ 10^4

## Example
`coins=[1,2,5], amount=11` → `3` (5+5+1).',
'medium', 'algorithms', 90, 256,
'Bottom-up DP: dp[i] = min over coins c ≤ i of dp[i-c]+1. O(amount·len(coins)).',
1, TRUE),

('count-region-islands', 'Подсчёт островов регионов', 'Count Region Islands',
'## Задача
Сетка `1`/`0` — регионы и пустоты. Остров = максимальная связная область `1` по 4-сторонам. Сколько островов?

## Ограничения
- 1 ≤ m,n ≤ 300

## Пример
```
11000
11000
00100
00011
```
→ `3`',
'## Task
Grid of `1`/`0` — regions and gaps. An island is a maximal 4-connected component of `1`s. How many islands?

## Constraints
- 1 ≤ m,n ≤ 300

## Example
```
11000
11000
00100
00011
```
→ `3`',
'medium', 'algorithms', 90, 256,
'DFS/BFS flood fill; flip visited to 0 or use visited set. O(m·n).',
1, TRUE),

('longest-unique-stream', 'Самая длинная уникальная подстрока потока', 'Longest Unique Stream',
'## Задача
Строка `s`. Найти длину самой длинной подстроки без повторяющихся символов.

## Ограничения
- 0 ≤ len(s) ≤ 5×10^4

## Пример
`"abcabcbb"` → `3` (`abc`). `"bbbbb"` → `1`.',
'## Task
Length of the longest substring with no repeating characters.

## Constraints
- 0 ≤ len(s) ≤ 5×10^4

## Example
`"abcabcbb"` → `3` (`abc`). `"bbbbb"` → `1`.',
'medium', 'algorithms', 90, 256,
'Sliding window, map char→lastIndex. Move left to max(left,lastIndex+1). O(n).',
1, TRUE),

('rotate-ring-buffer', 'Поворот кольцевого буфера', 'Rotate Ring Buffer',
'## Задача
Массив и число `k`. Поверните массив вправо на `k` позиций. In-place желательно.

## Ограничения
- 1 ≤ len(nums) ≤ 10^5
- 0 ≤ k ≤ 10^5

## Пример
`[1,2,3,4,5,6,7], k=3` → `[5,6,7,1,2,3,4]`.',
'## Task
Rotate array right by `k` positions, in place when possible.

## Constraints
- 1 ≤ len(nums) ≤ 10^5
- 0 ≤ k ≤ 10^5

## Example
`[1,2,3,4,5,6,7], k=3` → `[5,6,7,1,2,3,4]`.',
'medium', 'algorithms', 90, 256,
'k %= n; reverse entire, reverse first k, reverse rest. O(n)/O(1).',
1, TRUE),

('product-except-self-metric', 'Произведение кроме своей метрики', 'Product Except Self',
'## Задача
Массив целых `nums`. Вернуть массив `answer`, где `answer[i]` — произведение всех элементов, кроме `nums[i]`. Деление использовать нельзя.

## Ограничения
- 2 ≤ len(nums) ≤ 10^5

## Пример
`[1,2,3,4]` → `[24,12,8,6]`.',
'## Task
Given `nums`, return `answer[i] = product of all elements except nums[i]`. No division allowed.

## Constraints
- 2 ≤ len(nums) ≤ 10^5

## Example
`[1,2,3,4]` → `[24,12,8,6]`.',
'medium', 'algorithms', 90, 256,
'Two passes: prefix product from left, then suffix product from right multiplying into answer. O(n)/O(1) extra.',
1, TRUE),

('jump-game-matchmaker', 'Прыжки матчмейкера', 'Matchmaker Jump Game',
'## Задача
Массив неотрицательных целых `nums`. Стартуем в индексе 0. `nums[i]` — максимум прыжка. Можно ли дойти до последнего индекса?

## Ограничения
- 1 ≤ len(nums) ≤ 10^4

## Пример
`[2,3,1,1,4]` → `true`. `[3,2,1,0,4]` → `false`.',
'## Task
Non-negative array `nums`; each `nums[i]` is max jump. Can you reach the last index starting at 0?

## Constraints
- 1 ≤ len(nums) ≤ 10^4

## Example
`[2,3,1,1,4]` → `true`. `[3,2,1,0,4]` → `false`.',
'medium', 'algorithms', 90, 256,
'Greedy: track farthest reachable. If i > farthest, return false. O(n).',
1, TRUE),

('triple-sum-partners', 'Тройки-партнёры с суммой 0', 'Three Sum Partners',
'## Задача
Массив целых `nums`. Найти все уникальные тройки `(i,j,k)`, для которых `nums[i]+nums[j]+nums[k]=0`.

## Ограничения
- 3 ≤ len(nums) ≤ 3000

## Пример
`[-1,0,1,2,-1,-4]` → `[[-1,-1,2],[-1,0,1]]`.',
'## Task
Given `nums`, return all unique triples summing to 0.

## Constraints
- 3 ≤ len(nums) ≤ 3000

## Example
`[-1,0,1,2,-1,-4]` → `[[-1,-1,2],[-1,0,1]]`.',
'medium', 'algorithms', 90, 256,
'Sort; fix i, two-pointer the rest. Skip duplicates for both i and the pointers. O(n^2).',
1, TRUE),

('unique-paths-grid-release', 'Уникальные пути по сетке релизов', 'Unique Release Paths',
'## Задача
Робот на сетке `m×n` стартует из верхнего-левого угла и идёт только вправо или вниз. Сколько уникальных путей до правого-нижнего?

## Ограничения
- 1 ≤ m,n ≤ 100

## Пример
`m=3, n=7` → `28`.',
'## Task
A robot on an m×n grid moves only right or down from top-left to bottom-right. Count unique paths.

## Constraints
- 1 ≤ m,n ≤ 100

## Example
`m=3, n=7` → `28`.',
'medium', 'algorithms', 90, 256,
'DP: paths(i,j)=paths(i-1,j)+paths(i,j-1). Or combinatorics C(m+n-2, m-1). 1-D row array sufficient.',
1, TRUE),

('find-duplicate-id', 'Найти дубликат id', 'Find the Duplicate ID',
'## Задача
Массив длины `n+1`, элементы из диапазона `[1..n]`. Ровно один элемент повторяется. Найти его, не модифицируя массив, используя O(1) памяти.

## Ограничения
- 1 ≤ n ≤ 10^5

## Пример
`[1,3,4,2,2]` → `2`. `[3,1,3,4,2]` → `3`.',
'## Task
Array of length `n+1` with values in `[1..n]`; exactly one value repeats. Find it without modifying the array, using O(1) extra memory.

## Constraints
- 1 ≤ n ≤ 10^5

## Example
`[1,3,4,2,2]` → `2`. `[3,1,3,4,2]` → `3`.',
'medium', 'algorithms', 90, 256,
'Floyd''s cycle (tortoise & hare) on index→value mapping. The cycle entrance is the duplicate.',
1, TRUE),

('sort-priority-flags', 'Сортировка флагов приоритета', 'Sort Priority Flags',
'## Задача
Массив целых `0`, `1`, `2` — приоритеты задач. Отсортировать in-place за O(n), одним проходом, без подсчёта.

## Ограничения
- 1 ≤ len(nums) ≤ 300

## Пример
`[2,0,2,1,1,0]` → `[0,0,1,1,2,2]`.',
'## Task
Array of `0/1/2` priority flags. Sort in place in O(n) with one pass, no counting.

## Constraints
- 1 ≤ len(nums) ≤ 300

## Example
`[2,0,2,1,1,0]` → `[0,0,1,1,2,2]`.',
'medium', 'algorithms', 90, 256,
'Dutch National Flag: three pointers lo/mid/hi. Swap accordingly. One pass O(n).',
1, TRUE),

-- ---------- ALGORITHMS :: HARD (5) ----------
('trapping-rain-logs', 'Сбор дождя в контейнерах логов', 'Trapping Rainwater Logs',
'## Задача
Массив `height` — высоты столбцов. Сколько воды удержится между ними после дождя?

## Ограничения
- 1 ≤ len(height) ≤ 2×10^4

## Пример
`[0,1,0,2,1,0,1,3,2,1,2,1]` → `6`.',
'## Task
Given `height`, compute water trapped between bars after rain.

## Constraints
- 1 ≤ len(height) ≤ 2×10^4

## Example
`[0,1,0,2,1,0,1,3,2,1,2,1]` → `6`.',
'hard', 'algorithms', 120, 256,
'Two pointers. At each step the lower side caps the water. Track leftMax, rightMax. O(n)/O(1).',
1, TRUE),

('median-two-shards', 'Медиана двух шардов', 'Median of Two Shards',
'## Задача
Два отсортированных массива метрик из разных шардов. Найти медиану объединения за O(log(min(m,n))).

## Ограничения
- 0 ≤ m+n ≤ 2000, общее по задаче ≤ 10^6

## Пример
`a=[1,3], b=[2]` → `2.0`. `a=[1,2], b=[3,4]` → `2.5`.',
'## Task
Two sorted metric arrays from different shards. Find the median of their union in O(log(min(m,n))).

## Constraints
- 0 ≤ m+n ≤ 2000

## Example
`a=[1,3], b=[2]` → `2.0`. `a=[1,2], b=[3,4]` → `2.5`.',
'hard', 'algorithms', 120, 256,
'Binary search partition on the shorter array so that left-halves cover ceil((m+n)/2) and maxLeft ≤ minRight. Handle odd/even.',
1, TRUE),

('n-queens-cluster', 'N ферзей на кластере', 'N-Queens Cluster',
'## Задача
Разместите N ферзей на доске N×N так, чтобы никакие два не били друг друга. Верните все отличающиеся решения.

## Ограничения
- 1 ≤ N ≤ 9

## Пример
N=4 → 2 решения.',
'## Task
Place N queens on an N×N board so none attacks another. Return all distinct solutions.

## Constraints
- 1 ≤ N ≤ 9

## Example
N=4 → 2 solutions.',
'hard', 'algorithms', 120, 256,
'Backtracking by row. Track column, diag (r-c), anti-diag (r+c) sets. Prune aggressively.',
1, TRUE),

('word-ladder-docs', 'Словесная лестница документации', 'Doc Word Ladder',
'## Задача
Две строки одинаковой длины `begin`, `end` и словарь слов `wordList`. Минимальное число шагов трансформации `begin→end`, где каждый шаг меняет ровно одну букву, и промежуточное слово должно быть в словаре. 0, если недостижимо.

## Ограничения
- 1 ≤ len(word) ≤ 10
- 1 ≤ |wordList| ≤ 5000

## Пример
`begin="hit", end="cog", list=["hot","dot","dog","lot","log","cog"]` → `5`.',
'## Task
Given equal-length `begin`, `end` and a `wordList`, return the minimum number of single-letter transformations from begin to end where each intermediate is in the list. 0 if impossible.

## Constraints
- 1 ≤ len(word) ≤ 10
- 1 ≤ |wordList| ≤ 5000

## Example
`begin="hit", end="cog", list=["hot","dot","dog","lot","log","cog"]` → `5`.',
'hard', 'algorithms', 120, 256,
'BFS on implicit graph. Neighbours via "*"-pattern bucket (h*t→hot,hit,...) to avoid O(L·26) scan per node.',
1, TRUE),

('regex-match-route', 'Регулярка маршрутов', 'Regex Route Match',
'## Задача
Строка `s` и паттерн `p` с поддержкой `.` (любой символ) и `*` (ноль или более предыдущего символа). Проверить, совпадает ли весь `s` с `p`.

## Ограничения
- 1 ≤ len(s), len(p) ≤ 20

## Пример
`s="aa", p="a*"` → `true`. `s="mississippi", p="mis*is*p*."` → `false`.',
'## Task
String `s` and pattern `p` with `.` (any char) and `*` (zero-or-more of previous). Does `p` match all of `s`?

## Constraints
- 1 ≤ len(s), len(p) ≤ 20

## Example
`s="aa", p="a*"` → `true`. `s="mississippi", p="mis*is*p*."` → `false`.',
'hard', 'algorithms', 120, 256,
'DP dp[i][j]=match(s[:i],p[:j]). Branch on p[j-1]: ''*'' → zero-use dp[i][j-2] OR one-more dp[i-1][j] if chars match.',
1, TRUE),

-- ---------- SQL (15) ----------
('sql-total-revenue-by-month', 'Выручка по месяцам', 'Monthly Revenue Total',
'## Задача
Есть таблица `orders(id, user_id, amount, created_at)`. Вернуть суммарную выручку и число заказов по месяцам за 2024 год, отсортировав по месяцу по возрастанию.

## Столбцы ответа
`month` (YYYY-MM), `total_revenue`, `orders_count`.

## Пример данных
```
orders
id | user_id | amount | created_at
1  | 10      | 500    | 2024-01-05
2  | 11      | 300    | 2024-01-18
3  | 10      | 700    | 2024-02-03
```
Ожидается:
```
month   | total_revenue | orders_count
2024-01 | 800           | 2
2024-02 | 700           | 1
```',
'## Task
Given `orders(id, user_id, amount, created_at)`, return monthly total revenue and order count for 2024, ordered by month ascending.

## Output columns
`month` (YYYY-MM), `total_revenue`, `orders_count`.',
'easy', 'sql', 90, 256,
'GROUP BY to_char(created_at, ''YYYY-MM''); WHERE created_at >= ''2024-01-01'' AND < ''2025-01-01''. SUM + COUNT.',
1, TRUE),

('sql-top-5-users-by-spend', 'Топ-5 покупателей', 'Top 5 Spenders',
'## Задача
По таблице `orders(user_id, amount, created_at)` и `users(id, username)` вернуть топ-5 пользователей по суммарной выручке за всё время. Сортировать по сумме убыв.

## Столбцы ответа
`username`, `total_spent`.',
'## Task
Given `orders(user_id, amount, created_at)` and `users(id, username)`, return the top-5 users by total spend (all time). Order by sum desc.

## Output columns
`username`, `total_spent`.',
'easy', 'sql', 90, 256,
'JOIN users on user_id, GROUP BY username, ORDER BY SUM(amount) DESC LIMIT 5.',
1, TRUE),

('sql-second-highest-salary', 'Вторая по величине зарплата', 'Second Highest Salary',
'## Задача
Дана `employees(id, name, salary)`. Вернуть вторую уникальную зарплату по убыванию. Если её нет — NULL.

## Столбец ответа
`second_salary`.',
'## Task
Given `employees(id, name, salary)`, return the second distinct salary in descending order. NULL if absent.

## Output column
`second_salary`.',
'easy', 'sql', 90, 256,
'SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary)); or DENSE_RANK() OVER (ORDER BY salary DESC) = 2.',
1, TRUE),

('sql-running-total', 'Накопительный итог', 'Running Total',
'## Задача
Дана `orders(user_id, amount, created_at)`. Вернуть для каждого заказа пользователя накопительную сумму по дате.

## Столбцы ответа
`user_id`, `created_at`, `amount`, `running_total`.',
'## Task
Given `orders(user_id, amount, created_at)`, return a running total of amount per user ordered by date.

## Output columns
`user_id`, `created_at`, `amount`, `running_total`.',
'medium', 'sql', 90, 256,
'SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW).',
1, TRUE),

('sql-day-over-day-diff', 'Разница день к дню', 'Day-over-Day Diff',
'## Задача
Дана `daily_dau(day, dau)`. Вернуть день и дельту DAU к предыдущему дню. Для первого дня — NULL.

## Столбцы ответа
`day`, `dau`, `delta`.',
'## Task
Given `daily_dau(day, dau)`, return day, dau, and delta vs. previous day. NULL on the first row.

## Output columns
`day`, `dau`, `delta`.',
'medium', 'sql', 90, 256,
'LAG(dau) OVER (ORDER BY day). delta = dau - LAG(dau).',
1, TRUE),

('sql-rank-per-group', 'Ранжирование внутри группы', 'Per-Group Ranking',
'## Задача
Дана `products(category, name, price)`. Для каждой категории вернуть три самых дорогих товара с номером места.

## Столбцы ответа
`category`, `rank`, `name`, `price`.',
'## Task
Given `products(category, name, price)`, return the three most expensive products per category with rank.

## Output columns
`category`, `rank`, `name`, `price`.',
'medium', 'sql', 90, 256,
'ROW_NUMBER()/DENSE_RANK() OVER (PARTITION BY category ORDER BY price DESC) in CTE; WHERE rank ≤ 3.',
1, TRUE),

('sql-cte-order-summary', 'CTE: сводка заказов', 'CTE: Order Summary',
'## Задача
Через CTE посчитать среднее, медиану и стандартное отклонение `amount` по `orders` для каждого пользователя.

## Столбцы ответа
`user_id`, `avg_amount`, `median_amount`, `stddev_amount`.',
'## Task
Using a CTE, compute avg, median, and stddev of `amount` per `user_id` on `orders`.

## Output columns
`user_id`, `avg_amount`, `median_amount`, `stddev_amount`.',
'medium', 'sql', 90, 256,
'AVG, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount), STDDEV_SAMP. GROUP BY user_id.',
1, TRUE),

('sql-recursive-hierarchy', 'Рекурсивная иерархия сотрудников', 'Recursive Employee Hierarchy',
'## Задача
Дана `employees(id, name, manager_id)`. Для сотрудника `id=42` вернуть всю цепочку подчинения сверху вниз с уровнем глубины.

## Столбцы ответа
`id`, `name`, `depth`.',
'## Task
Given `employees(id, name, manager_id)`, return the full subordinate chain of employee 42 with depth.

## Output columns
`id`, `name`, `depth`.',
'hard', 'sql', 120, 256,
'WITH RECURSIVE sub AS (anchor=42 depth 0, recursive JOIN on manager_id=sub.id depth+1) SELECT ...',
1, TRUE),

('sql-inner-vs-left-join', 'INNER vs LEFT JOIN: сироты', 'INNER vs LEFT JOIN: Orphans',
'## Задача
`users(id, username)` и `orders(user_id)`. Вернуть список имен пользователей без единого заказа.

## Столбец ответа
`username`.',
'## Task
Given `users(id, username)` and `orders(user_id)`, list usernames with no orders.

## Output column
`username`.',
'easy', 'sql', 90, 256,
'LEFT JOIN + WHERE o.user_id IS NULL, or NOT EXISTS. Avoid NOT IN (null pitfalls).',
1, TRUE),

('sql-window-moving-avg', 'Скользящее среднее 7 дней', '7-Day Moving Average',
'## Задача
`daily_dau(day, dau)` — посчитать 7-дневное скользящее среднее DAU.

## Столбцы ответа
`day`, `dau`, `ma7`.',
'## Task
Given `daily_dau(day, dau)`, compute a 7-day moving average of DAU.

## Output columns
`day`, `dau`, `ma7`.',
'medium', 'sql', 90, 256,
'AVG(dau) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW).',
1, TRUE),

('sql-self-join-pairs', 'Self-join: одновременные сессии', 'Self-Join: Overlapping Sessions',
'## Задача
`sessions(id, user_id, started_at, ended_at)`. Найти все пары (id1,id2) одновременных сессий одного пользователя (пересечение по времени). Каждую пару — один раз.

## Столбцы ответа
`id1`, `id2`.',
'## Task
Given `sessions(id, user_id, started_at, ended_at)`, find all pairs of overlapping sessions of the same user. Each pair once.

## Output columns
`id1`, `id2`.',
'hard', 'sql', 120, 256,
'Self-join s1 JOIN s2 ON user_id AND s1.id<s2.id AND s1.started_at<s2.ended_at AND s2.started_at<s1.ended_at.',
1, TRUE),

('sql-anti-join-churn', 'Анти-join: отток', 'Anti-Join: Churn',
'## Задача
Из `orders(user_id, created_at)` — пользователи, покупавшие в 2023 году, но не в 2024.

## Столбец ответа
`user_id`.',
'## Task
From `orders(user_id, created_at)`, return users who ordered in 2023 but not in 2024.

## Output column
`user_id`.',
'medium', 'sql', 90, 256,
'Two CTEs or EXCEPT: users_2023 EXCEPT users_2024. Or LEFT JOIN/NOT EXISTS on 2024.',
1, TRUE),

('sql-pivot-by-month', 'PIVOT по месяцам', 'Pivot By Month',
'## Задача
Из `orders(user_id, amount, created_at)` построить таблицу сумм по user_id × месяц 2024 года. Месяцы — столбцы `jan`..`dec`.

## Столбцы ответа
`user_id`, `jan`, `feb`, ..., `dec`.',
'## Task
From `orders`, pivot amounts by user × month for 2024. Months become columns `jan..dec`.

## Output columns
`user_id`, `jan`, `feb`, ..., `dec`.',
'medium', 'sql', 90, 256,
'SUM(CASE WHEN EXTRACT(MONTH FROM created_at)=1 THEN amount END) AS jan, ... GROUP BY user_id.',
1, TRUE),

('sql-percentile-latency', 'Перцентиль задержки', 'Latency Percentile',
'## Задача
`api_calls(endpoint, latency_ms)`. Вернуть p50, p95, p99 латентности для каждой точки API.

## Столбцы ответа
`endpoint`, `p50`, `p95`, `p99`.',
'## Task
Given `api_calls(endpoint, latency_ms)`, return p50/p95/p99 per endpoint.

## Output columns
`endpoint`, `p50`, `p95`, `p99`.',
'medium', 'sql', 90, 256,
'PERCENTILE_CONT(0.5/0.95/0.99) WITHIN GROUP (ORDER BY latency_ms) per endpoint. GROUP BY endpoint.',
1, TRUE),

('sql-dedupe-keep-latest', 'Дедуп с сохранением последнего', 'Dedupe Keep Latest',
'## Задача
Таблица `events(user_id, event_type, created_at)` содержит дубликаты. Оставить для каждой пары (user_id, event_type) только самую свежую строку.

## Столбцы ответа
`user_id`, `event_type`, `created_at`.',
'## Task
Given `events(user_id, event_type, created_at)` with duplicates, keep only the latest row per (user_id, event_type).

## Output columns
`user_id`, `event_type`, `created_at`.',
'medium', 'sql', 90, 256,
'ROW_NUMBER() OVER (PARTITION BY user_id, event_type ORDER BY created_at DESC) = 1. Wrap in CTE.',
1, TRUE),

-- ---------- GO (3) ----------
('go-goroutine-channel-bug', 'Утечка горутины на канале', 'Goroutine Channel Leak',
'## Задача
Проанализируйте функцию `fanOut(n int) <-chan int`. Она запускает `n` горутин, каждая из которых что-то пишет в единственный канал и завершается. Найдите и исправьте утечку горутин / deadlock. Напишите финальную версию кода.

```go
func fanOut(n int) <-chan int {
    out := make(chan int)
    for i := 0; i < n; i++ {
        go func(i int) { out <- i*i }(i)
    }
    return out
}
```

## Что проверяется
- горутины не виснут, когда читатель взял меньше `n` значений
- нет лишних аллокаций
- `for v := range out` корректно завершится.',
'## Task
Analyse `fanOut(n int) <-chan int`. It spawns `n` goroutines each writing one value to a shared channel. Fix the goroutine leak / deadlock and submit the final version.

```go
func fanOut(n int) <-chan int {
    out := make(chan int)
    for i := 0; i < n; i++ {
        go func(i int) { out <- i*i }(i)
    }
    return out
}
```

## Rubric
- goroutines don''t hang when the consumer stops early
- no extra allocations
- `for v := range out` terminates cleanly.',
'medium', 'go', 90, 256,
'Use sync.WaitGroup + close(out) once all producers done, OR pass ctx to the goroutine and select on ctx.Done() to avoid blocking writes.',
1, TRUE),

('go-context-cancellation', 'Отмена через context', 'Context Cancellation',
'## Задача
Функция `doWork(ctx, urls []string) []Result` должна выполнять HTTP-запросы параллельно и отменять всё при `ctx.Done()`. Реализуйте с таймаутом и агрегацией результатов, чтобы при отмене ни одна горутина не продолжала работу.',
'## Task
Implement `doWork(ctx, urls []string) []Result` that performs HTTP requests in parallel and cancels everything on `ctx.Done()`. Use a timeout; ensure no goroutine keeps running after cancellation.',
'medium', 'go', 90, 256,
'context.WithTimeout, errgroup or manual WaitGroup + chan Result, NewRequestWithContext, early-return loop with select.',
1, TRUE),

('go-mutex-vs-syncmap', 'Mutex vs sync.Map', 'Mutex vs sync.Map',
'## Задача
Реализуйте конкурентный счётчик ключей с API `Inc(key)`, `Get(key)` и `Snapshot() map[string]int`. Предложите две реализации: `sync.RWMutex + map` и `sync.Map`. Оцените, когда какая эффективнее. В ответе — код обеих и 2-3 предложения сравнения.',
'## Task
Implement a concurrent key counter with `Inc(key)`, `Get(key)`, `Snapshot() map[string]int`. Provide two implementations: `sync.RWMutex + map` and `sync.Map`. Compare their trade-offs in 2-3 sentences.',
'medium', 'go', 90, 256,
'sync.Map shines on write-rare/read-many disjoint keys. RWMutex+map is simpler and faster for balanced write/read on the same keys. Snapshot requires full lock or Range.',
1, TRUE),

-- ---------- SYSTEM DESIGN (2) ----------
('sd-url-shortener', 'Дизайн URL-шортенера', 'Design a URL Shortener',
'## Задача
Спроектируйте сервис `bit.ly`-подобный. Ожидаемая нагрузка — 10k создаваемых ссылок/сек, 100k чтений/сек. TTL — 1 год.

## Рубрика ответа
1. API (create / resolve)
2. Схема хранения и выбор БД
3. Алгоритм генерации коротких ID
4. Стратегия кэша и TTL
5. Масштабирование и учёт аналитики
6. Обсуждение trade-off (консистентность, коллизии, rate-limit).',
'## Task
Design a `bit.ly`-style service. Load: 10k writes/s, 100k reads/s. TTL 1 year.

## Rubric
1. API (create / resolve)
2. Storage schema and DB choice
3. Short-ID generation strategy
4. Caching & TTL plan
5. Scaling + analytics pipeline
6. Trade-off discussion (consistency, collisions, rate limits).',
'hard', 'system_design', 120, 256,
'Base62 encoded 64-bit snowflake or DB-sequence; Postgres/DynamoDB for mapping; CDN+Redis caching for reads; async click analytics through Kafka.',
1, TRUE),

('sd-rate-limiter', 'Дизайн rate limiter', 'Design a Rate Limiter',
'## Задача
Спроектируйте распределённый rate limiter — 100 запросов/мин на пользователя для API-gateway с 10 инстансами.

## Рубрика
1. Выбор алгоритма (token bucket / leaky bucket / sliding window)
2. Хранилище (Redis INCR + TTL, Lua script)
3. Горячие ключи, burst, fairness
4. Поведение при отказе Redis
5. Согласованность между инстансами.',
'## Task
Design a distributed rate limiter — 100 req/min per user across a 10-instance API gateway.

## Rubric
1. Algorithm choice (token bucket / leaky bucket / sliding window)
2. Storage (Redis INCR + TTL, Lua script)
3. Hot keys, burst, fairness
4. Failure mode when Redis is down
5. Cross-instance consistency.',
'hard', 'system_design', 120, 256,
'Fixed-window counter via Redis INCR+EXPIRE; sliding log or sliding window counter for smoother; token bucket for bursts; Lua-script atomicity; fail-open vs fail-closed.',
1, TRUE)

ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- TEST CASES (≥3 per task, ≥1 hidden where applicable)
-- ============================================================

-- Helper pattern: SELECT id FROM tasks WHERE slug=... UNION ALL ...

INSERT INTO test_cases (task_id, input, expected_output, is_hidden, order_num)
SELECT t.id, v.input, v.expected, v.hidden, v.ord
FROM tasks t
JOIN (VALUES

-- two-sum-transactions
('two-sum-transactions', E'[2,7,11,15]\n9',                         '[0,1]',                false, 0),
('two-sum-transactions', E'[3,2,4]\n6',                             '[1,2]',                false, 1),
('two-sum-transactions', E'[3,3]\n6',                               '[0,1]',                true,  2),
('two-sum-transactions', E'[-1,-2,-3,-4,-5]\n-8',                   '[2,4]',                true,  3),

-- valid-brackets-log
('valid-brackets-log', '()',                                        'true',                 false, 0),
('valid-brackets-log', '()[]{}',                                    'true',                 false, 1),
('valid-brackets-log', '(]',                                        'false',                false, 2),
('valid-brackets-log', '([{}])',                                    'true',                 true,  3),
('valid-brackets-log', '(((',                                       'false',                true,  4),

-- reverse-event-chain
('reverse-event-chain', '[1,2,3,4,5]',                              '[5,4,3,2,1]',          false, 0),
('reverse-event-chain', '[1,2]',                                    '[2,1]',                false, 1),
('reverse-event-chain', '[]',                                       '[]',                   true,  2),

-- max-subarray-revenue
('max-subarray-revenue', '[-2,1,-3,4,-1,2,1,-5,4]',                 '6',                    false, 0),
('max-subarray-revenue', '[1]',                                     '1',                    false, 1),
('max-subarray-revenue', '[5,4,-1,7,8]',                            '23',                   false, 2),
('max-subarray-revenue', '[-5,-2,-3,-1,-4]',                        '-1',                   true,  3),

-- climbing-rating-ladder
('climbing-rating-ladder', '2',                                     '2',                    false, 0),
('climbing-rating-ladder', '3',                                     '3',                    false, 1),
('climbing-rating-ladder', '5',                                     '8',                    false, 2),
('climbing-rating-ladder', '45',                                    '1836311903',           true,  3),

-- contains-duplicate-uid
('contains-duplicate-uid', '[1,2,3,1]',                             'true',                 false, 0),
('contains-duplicate-uid', '[1,2,3,4]',                             'false',                false, 1),
('contains-duplicate-uid', '[1,1,1,3,3,4,3,2,4,2]',                 'true',                 true,  2),

-- best-time-buy-sell-token
('best-time-buy-sell-token', '[7,1,5,3,6,4]',                       '5',                    false, 0),
('best-time-buy-sell-token', '[7,6,4,3,1]',                         '0',                    false, 1),
('best-time-buy-sell-token', '[2,4,1]',                             '2',                    true,  2),

-- valid-palindrome-slug
('valid-palindrome-slug', 'A man, a plan, a canal: Panama',         'true',                 false, 0),
('valid-palindrome-slug', 'race a car',                             'false',                false, 1),
('valid-palindrome-slug', ' ',                                      'true',                 false, 2),
('valid-palindrome-slug', '0P',                                     'false',                true,  3),

-- merge-sorted-queues
('merge-sorted-queues', E'[1,2,4]\n[1,3,4]',                        '[1,1,2,3,4,4]',        false, 0),
('merge-sorted-queues', E'[]\n[]',                                  '[]',                   false, 1),
('merge-sorted-queues', E'[]\n[0]',                                 '[0]',                  true,  2),

-- binary-search-logs
('binary-search-logs', E'[-1,0,3,5,9,12]\n9',                       '4',                    false, 0),
('binary-search-logs', E'[-1,0,3,5,9,12]\n2',                       '-1',                   false, 1),
('binary-search-logs', E'[5]\n5',                                   '0',                    true,  2),

-- lru-session-cache
('lru-session-cache', E'["LRUCache","put","put","get","put","get","put","get","get","get"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]',
                                                                    '[null,null,null,1,null,-1,null,-1,3,4]',
                                                                                            false, 0),
('lru-session-cache', E'["LRUCache","put","get"]\n[[1],[2,1],[2]]', '[null,null,1]',        false, 1),
('lru-session-cache', E'["LRUCache","put","put","get"]\n[[2],[1,1],[1,2],[1]]',
                                                                    '[null,null,null,2]',   true,  2),

-- merge-incident-intervals
('merge-incident-intervals', '[[1,3],[2,6],[8,10],[15,18]]',        '[[1,6],[8,10],[15,18]]', false, 0),
('merge-incident-intervals', '[[1,4],[4,5]]',                       '[[1,5]]',              false, 1),
('merge-incident-intervals', '[[1,4],[0,4]]',                       '[[0,4]]',              true,  2),

-- group-anagram-tags
('group-anagram-tags', '["eat","tea","tan","ate","nat","bat"]',     '[["bat"],["nat","tan"],["ate","eat","tea"]]', false, 0),
('group-anagram-tags', '[""]',                                      '[[""]]',               false, 1),
('group-anagram-tags', '["a"]',                                     '[["a"]]',              true,  2),

-- top-k-hottest-queries
('top-k-hottest-queries', E'["a","b","a","c","b","a"]\n2',          '["a","b"]',            false, 0),
('top-k-hottest-queries', E'["x"]\n1',                              '["x"]',                false, 1),
('top-k-hottest-queries', E'["a","b","c","a","b","a"]\n3',          '["a","b","c"]',        true,  2),

-- codeword-in-grid
('codeword-in-grid', E'[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]]\nABCCED', 'true', false, 0),
('codeword-in-grid', E'[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]]\nSEE',    'true', false, 1),
('codeword-in-grid', E'[["A","B","C","E"],["S","F","C","S"],["A","D","E","E"]]\nABCB',   'false', true,  2),

-- change-for-coin-drop
('change-for-coin-drop', E'[1,2,5]\n11',                            '3',                    false, 0),
('change-for-coin-drop', E'[2]\n3',                                 '-1',                   false, 1),
('change-for-coin-drop', E'[1]\n0',                                 '0',                    true,  2),

-- count-region-islands
('count-region-islands', E'[["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', '3', false, 0),
('count-region-islands', E'[["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]', '1', false, 1),
('count-region-islands', E'[["0"]]',                                '0',                    true,  2),

-- longest-unique-stream
('longest-unique-stream', 'abcabcbb',                               '3',                    false, 0),
('longest-unique-stream', 'bbbbb',                                  '1',                    false, 1),
('longest-unique-stream', 'pwwkew',                                 '3',                    false, 2),
('longest-unique-stream', '',                                       '0',                    true,  3),

-- rotate-ring-buffer
('rotate-ring-buffer', E'[1,2,3,4,5,6,7]\n3',                       '[5,6,7,1,2,3,4]',      false, 0),
('rotate-ring-buffer', E'[-1,-100,3,99]\n2',                        '[3,99,-1,-100]',       false, 1),
('rotate-ring-buffer', E'[1,2]\n5',                                 '[2,1]',                true,  2),

-- product-except-self-metric
('product-except-self-metric', '[1,2,3,4]',                         '[24,12,8,6]',          false, 0),
('product-except-self-metric', '[-1,1,0,-3,3]',                     '[0,0,9,0,0]',          false, 1),
('product-except-self-metric', '[2,3]',                             '[3,2]',                true,  2),

-- jump-game-matchmaker
('jump-game-matchmaker', '[2,3,1,1,4]',                             'true',                 false, 0),
('jump-game-matchmaker', '[3,2,1,0,4]',                             'false',                false, 1),
('jump-game-matchmaker', '[0]',                                     'true',                 true,  2),

-- triple-sum-partners
('triple-sum-partners', '[-1,0,1,2,-1,-4]',                         '[[-1,-1,2],[-1,0,1]]', false, 0),
('triple-sum-partners', '[0,1,1]',                                  '[]',                   false, 1),
('triple-sum-partners', '[0,0,0]',                                  '[[0,0,0]]',            true,  2),

-- unique-paths-grid-release
('unique-paths-grid-release', E'3\n7',                              '28',                   false, 0),
('unique-paths-grid-release', E'3\n2',                              '3',                    false, 1),
('unique-paths-grid-release', E'1\n1',                              '1',                    true,  2),

-- find-duplicate-id
('find-duplicate-id', '[1,3,4,2,2]',                                '2',                    false, 0),
('find-duplicate-id', '[3,1,3,4,2]',                                '3',                    false, 1),
('find-duplicate-id', '[1,1]',                                      '1',                    true,  2),

-- sort-priority-flags
('sort-priority-flags', '[2,0,2,1,1,0]',                            '[0,0,1,1,2,2]',        false, 0),
('sort-priority-flags', '[2,0,1]',                                  '[0,1,2]',              false, 1),
('sort-priority-flags', '[0]',                                      '[0]',                  true,  2),

-- trapping-rain-logs
('trapping-rain-logs', '[0,1,0,2,1,0,1,3,2,1,2,1]',                 '6',                    false, 0),
('trapping-rain-logs', '[4,2,0,3,2,5]',                             '9',                    false, 1),
('trapping-rain-logs', '[]',                                        '0',                    true,  2),

-- median-two-shards
('median-two-shards', E'[1,3]\n[2]',                                '2.0',                  false, 0),
('median-two-shards', E'[1,2]\n[3,4]',                              '2.5',                  false, 1),
('median-two-shards', E'[]\n[1]',                                   '1.0',                  true,  2),

-- n-queens-cluster
('n-queens-cluster', '4',                                           '2',                    false, 0),
('n-queens-cluster', '1',                                           '1',                    false, 1),
('n-queens-cluster', '8',                                           '92',                   true,  2),

-- word-ladder-docs
('word-ladder-docs', E'hit\ncog\n["hot","dot","dog","lot","log","cog"]', '5',               false, 0),
('word-ladder-docs', E'hit\ncog\n["hot","dot","dog","lot","log"]',       '0',               false, 1),
('word-ladder-docs', E'a\nc\n["a","b","c"]',                             '2',               true,  2),

-- regex-match-route
('regex-match-route', E'aa\na',                                     'false',                false, 0),
('regex-match-route', E'aa\na*',                                    'true',                 false, 1),
('regex-match-route', E'ab\n.*',                                    'true',                 false, 2),
('regex-match-route', E'mississippi\nmis*is*p*.',                   'false',                true,  3),

-- ============================================================
-- SQL TEST CASES (schema + data as input; result set as expected)
-- ============================================================

('sql-total-revenue-by-month',
E'-- schema\nCREATE TABLE orders(id int, user_id int, amount int, created_at date);\nINSERT INTO orders VALUES\n (1,10,500,''2024-01-05''),\n (2,11,300,''2024-01-18''),\n (3,10,700,''2024-02-03'');',
E'month   | total_revenue | orders_count\n2024-01 | 800           | 2\n2024-02 | 700           | 1',
false, 0),
('sql-total-revenue-by-month',
E'CREATE TABLE orders(id int, user_id int, amount int, created_at date);\nINSERT INTO orders VALUES (1,1,100,''2023-12-31''),(2,1,200,''2024-01-01'');',
E'month   | total_revenue | orders_count\n2024-01 | 200           | 1',
false, 1),
('sql-total-revenue-by-month',
E'CREATE TABLE orders(id int, user_id int, amount int, created_at date); -- empty',
E'(0 rows)',
true, 2),

('sql-top-5-users-by-spend',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int, amount int, created_at date);\nINSERT INTO users VALUES (1,''a''),(2,''b''),(3,''c'');\nINSERT INTO orders VALUES (1,500,''2024-01-01''),(2,300,''2024-01-02''),(1,200,''2024-02-01''),(3,50,''2024-03-01'');',
E'username | total_spent\na        | 700\nb        | 300\nc        | 50',
false, 0),
('sql-top-5-users-by-spend',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int, amount int);\nINSERT INTO users VALUES (1,''solo'');\nINSERT INTO orders VALUES (1,10);',
E'username | total_spent\nsolo     | 10',
false, 1),
('sql-top-5-users-by-spend',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int, amount int);\n-- no rows',
E'(0 rows)',
true, 2),

('sql-second-highest-salary',
E'CREATE TABLE employees(id int, name text, salary int);\nINSERT INTO employees VALUES (1,''a'',100),(2,''b'',200),(3,''c'',300);',
E'second_salary\n200',
false, 0),
('sql-second-highest-salary',
E'CREATE TABLE employees(id int, name text, salary int);\nINSERT INTO employees VALUES (1,''only'',100);',
E'second_salary\nNULL',
false, 1),
('sql-second-highest-salary',
E'CREATE TABLE employees(id int, name text, salary int);\nINSERT INTO employees VALUES (1,''a'',100),(2,''b'',100);',
E'second_salary\nNULL',
true, 2),

('sql-running-total',
E'CREATE TABLE orders(user_id int, amount int, created_at date);\nINSERT INTO orders VALUES (1,10,''2024-01-01''),(1,20,''2024-01-02''),(2,50,''2024-01-01'');',
E'user_id | created_at | amount | running_total\n1       | 2024-01-01 | 10     | 10\n1       | 2024-01-02 | 20     | 30\n2       | 2024-01-01 | 50     | 50',
false, 0),
('sql-running-total',
E'CREATE TABLE orders(user_id int, amount int, created_at date);\nINSERT INTO orders VALUES (1,5,''2024-06-01'');',
E'user_id | created_at | amount | running_total\n1       | 2024-06-01 | 5      | 5',
false, 1),
('sql-running-total',
E'CREATE TABLE orders(user_id int, amount int, created_at date); -- empty',
E'(0 rows)',
true, 2),

('sql-day-over-day-diff',
E'CREATE TABLE daily_dau(day date, dau int);\nINSERT INTO daily_dau VALUES (''2024-01-01'',100),(''2024-01-02'',130),(''2024-01-03'',120);',
E'day        | dau | delta\n2024-01-01 | 100 | NULL\n2024-01-02 | 130 | 30\n2024-01-03 | 120 | -10',
false, 0),
('sql-day-over-day-diff',
E'CREATE TABLE daily_dau(day date, dau int);\nINSERT INTO daily_dau VALUES (''2024-01-01'',100);',
E'day        | dau | delta\n2024-01-01 | 100 | NULL',
false, 1),
('sql-day-over-day-diff',
E'CREATE TABLE daily_dau(day date, dau int);\nINSERT INTO daily_dau VALUES (''2024-01-01'',0),(''2024-01-02'',0);',
E'day        | dau | delta\n2024-01-01 | 0   | NULL\n2024-01-02 | 0   | 0',
true, 2),

('sql-rank-per-group',
E'CREATE TABLE products(category text, name text, price int);\nINSERT INTO products VALUES (''fruit'',''apple'',10),(''fruit'',''banana'',5),(''fruit'',''cherry'',20),(''fruit'',''date'',15),(''veggie'',''carrot'',3);',
E'category | rank | name   | price\nfruit    | 1    | cherry | 20\nfruit    | 2    | date   | 15\nfruit    | 3    | apple  | 10\nveggie   | 1    | carrot | 3',
false, 0),
('sql-rank-per-group',
E'CREATE TABLE products(category text, name text, price int);\nINSERT INTO products VALUES (''a'',''x'',1),(''a'',''y'',2);',
E'category | rank | name | price\na        | 1    | y    | 2\na        | 2    | x    | 1',
false, 1),
('sql-rank-per-group',
E'CREATE TABLE products(category text, name text, price int); -- empty',
E'(0 rows)',
true, 2),

('sql-cte-order-summary',
E'CREATE TABLE orders(user_id int, amount int);\nINSERT INTO orders VALUES (1,100),(1,200),(1,300),(2,50),(2,150);',
E'user_id | avg_amount | median_amount | stddev_amount\n1       | 200.00     | 200.00        | 100.00\n2       | 100.00     | 100.00        | 70.71',
false, 0),
('sql-cte-order-summary',
E'CREATE TABLE orders(user_id int, amount int);\nINSERT INTO orders VALUES (1,10);',
E'user_id | avg_amount | median_amount | stddev_amount\n1       | 10.00      | 10.00         | NULL',
false, 1),
('sql-cte-order-summary',
E'CREATE TABLE orders(user_id int, amount int); -- empty',
E'(0 rows)',
true, 2),

('sql-recursive-hierarchy',
E'CREATE TABLE employees(id int, name text, manager_id int);\nINSERT INTO employees VALUES (42,''CEO'',NULL),(43,''VP'',42),(44,''Eng'',43),(45,''Intern'',44),(99,''Other'',NULL);',
E'id | name   | depth\n42 | CEO    | 0\n43 | VP     | 1\n44 | Eng    | 2\n45 | Intern | 3',
false, 0),
('sql-recursive-hierarchy',
E'CREATE TABLE employees(id int, name text, manager_id int);\nINSERT INTO employees VALUES (42,''Solo'',NULL);',
E'id | name | depth\n42 | Solo | 0',
false, 1),
('sql-recursive-hierarchy',
E'CREATE TABLE employees(id int, name text, manager_id int);\nINSERT INTO employees VALUES (42,''A'',NULL),(43,''B'',42),(44,''C'',42),(45,''D'',43);',
E'id | name | depth\n42 | A    | 0\n43 | B    | 1\n44 | C    | 1\n45 | D    | 2',
true, 2),

('sql-inner-vs-left-join',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int);\nINSERT INTO users VALUES (1,''alice''),(2,''bob''),(3,''carol'');\nINSERT INTO orders VALUES (1),(1),(3);',
E'username\nbob',
false, 0),
('sql-inner-vs-left-join',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int);\nINSERT INTO users VALUES (1,''alice'');\nINSERT INTO orders VALUES (1);',
E'(0 rows)',
false, 1),
('sql-inner-vs-left-join',
E'CREATE TABLE users(id int, username text);\nCREATE TABLE orders(user_id int);\nINSERT INTO users VALUES (1,''lonely'');',
E'username\nlonely',
true, 2),

('sql-window-moving-avg',
E'CREATE TABLE daily_dau(day date, dau int);\nINSERT INTO daily_dau VALUES (''2024-01-01'',10),(''2024-01-02'',20),(''2024-01-03'',30),(''2024-01-04'',40),(''2024-01-05'',50),(''2024-01-06'',60),(''2024-01-07'',70),(''2024-01-08'',80);',
E'day        | dau | ma7\n2024-01-01 | 10  | 10.00\n2024-01-02 | 20  | 15.00\n2024-01-03 | 30  | 20.00\n2024-01-04 | 40  | 25.00\n2024-01-05 | 50  | 30.00\n2024-01-06 | 60  | 35.00\n2024-01-07 | 70  | 40.00\n2024-01-08 | 80  | 50.00',
false, 0),
('sql-window-moving-avg',
E'CREATE TABLE daily_dau(day date, dau int);\nINSERT INTO daily_dau VALUES (''2024-01-01'',100);',
E'day        | dau | ma7\n2024-01-01 | 100 | 100.00',
false, 1),
('sql-window-moving-avg',
E'CREATE TABLE daily_dau(day date, dau int); -- empty',
E'(0 rows)',
true, 2),

('sql-self-join-pairs',
E'CREATE TABLE sessions(id int, user_id int, started_at timestamp, ended_at timestamp);\nINSERT INTO sessions VALUES\n (1,1,''2024-01-01 10:00'',''2024-01-01 11:00''),\n (2,1,''2024-01-01 10:30'',''2024-01-01 12:00''),\n (3,1,''2024-01-01 13:00'',''2024-01-01 14:00''),\n (4,2,''2024-01-01 10:00'',''2024-01-01 11:00'');',
E'id1 | id2\n1   | 2',
false, 0),
('sql-self-join-pairs',
E'CREATE TABLE sessions(id int, user_id int, started_at timestamp, ended_at timestamp);\nINSERT INTO sessions VALUES (1,1,''2024-01-01 10:00'',''2024-01-01 11:00''),(2,1,''2024-01-01 11:30'',''2024-01-01 12:00'');',
E'(0 rows)',
false, 1),
('sql-self-join-pairs',
E'CREATE TABLE sessions(id int, user_id int, started_at timestamp, ended_at timestamp);\nINSERT INTO sessions VALUES (1,1,''2024-01-01 10:00'',''2024-01-01 12:00''),(2,1,''2024-01-01 10:30'',''2024-01-01 11:00''),(3,1,''2024-01-01 11:30'',''2024-01-01 13:00'');',
E'id1 | id2\n1   | 2\n1   | 3',
true, 2),

('sql-anti-join-churn',
E'CREATE TABLE orders(user_id int, created_at date);\nINSERT INTO orders VALUES (1,''2023-06-01''),(1,''2024-06-01''),(2,''2023-12-01''),(3,''2024-01-01'');',
E'user_id\n2',
false, 0),
('sql-anti-join-churn',
E'CREATE TABLE orders(user_id int, created_at date);\nINSERT INTO orders VALUES (1,''2023-01-01'');',
E'user_id\n1',
false, 1),
('sql-anti-join-churn',
E'CREATE TABLE orders(user_id int, created_at date);\nINSERT INTO orders VALUES (1,''2024-01-01'');',
E'(0 rows)',
true, 2),

('sql-pivot-by-month',
E'CREATE TABLE orders(user_id int, amount int, created_at date);\nINSERT INTO orders VALUES (1,100,''2024-01-01''),(1,200,''2024-02-01''),(2,50,''2024-01-15'');',
E'user_id | jan | feb | mar | apr | may | jun | jul | aug | sep | oct | nov | dec\n1       | 100 | 200 | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0\n2       | 50  | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0',
false, 0),
('sql-pivot-by-month',
E'CREATE TABLE orders(user_id int, amount int, created_at date);\nINSERT INTO orders VALUES (1,10,''2024-12-31'');',
E'user_id | jan | feb | mar | apr | may | jun | jul | aug | sep | oct | nov | dec\n1       | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 0   | 10',
false, 1),
('sql-pivot-by-month',
E'CREATE TABLE orders(user_id int, amount int, created_at date); -- empty',
E'(0 rows)',
true, 2),

('sql-percentile-latency',
E'CREATE TABLE api_calls(endpoint text, latency_ms int);\nINSERT INTO api_calls VALUES (''/a'',10),(''/a'',20),(''/a'',30),(''/a'',40),(''/a'',50),(''/a'',60),(''/a'',70),(''/a'',80),(''/a'',90),(''/a'',100);',
E'endpoint | p50  | p95  | p99\n/a       | 55.0 | 95.5 | 99.1',
false, 0),
('sql-percentile-latency',
E'CREATE TABLE api_calls(endpoint text, latency_ms int);\nINSERT INTO api_calls VALUES (''/x'',10);',
E'endpoint | p50  | p95  | p99\n/x       | 10.0 | 10.0 | 10.0',
false, 1),
('sql-percentile-latency',
E'CREATE TABLE api_calls(endpoint text, latency_ms int); -- empty',
E'(0 rows)',
true, 2),

('sql-dedupe-keep-latest',
E'CREATE TABLE events(user_id int, event_type text, created_at timestamp);\nINSERT INTO events VALUES (1,''login'',''2024-01-01 10:00''),(1,''login'',''2024-01-02 10:00''),(1,''click'',''2024-01-03 10:00''),(2,''login'',''2024-01-04 10:00'');',
E'user_id | event_type | created_at\n1       | click      | 2024-01-03 10:00\n1       | login      | 2024-01-02 10:00\n2       | login      | 2024-01-04 10:00',
false, 0),
('sql-dedupe-keep-latest',
E'CREATE TABLE events(user_id int, event_type text, created_at timestamp);\nINSERT INTO events VALUES (1,''a'',''2024-01-01 00:00'');',
E'user_id | event_type | created_at\n1       | a          | 2024-01-01 00:00',
false, 1),
('sql-dedupe-keep-latest',
E'CREATE TABLE events(user_id int, event_type text, created_at timestamp); -- empty',
E'(0 rows)',
true, 2),

-- ============================================================
-- GO TEST CASES (rubric-style: input = description, expected = key signals)
-- ============================================================

('go-goroutine-channel-bug',
E'Review the fanOut implementation. Submit corrected function.',
E'MUST: close(out) after all producers finish (sync.WaitGroup); producers select on ctx.Done() OR receiver drains all N values; range over channel terminates.',
false, 0),
('go-goroutine-channel-bug',
E'What happens if the caller reads only 1 value out of N?',
E'Original deadlocks N-1 goroutines forever. Fixed version with cancelable ctx lets producers exit on ctx.Done().',
false, 1),
('go-goroutine-channel-bug',
E'Bench: fanOut(1_000_000). Does memory grow linearly?',
E'Fixed version bounded: WaitGroup + closed chan; leaked original grows linearly and never frees goroutines.',
true, 2),

('go-context-cancellation',
E'5 URLs, ctx timeout 100ms. How many results do you return?',
E'As many as completed before deadline; remaining return ctx.Err(). Use NewRequestWithContext so in-flight HTTP is cancelled.',
false, 0),
('go-context-cancellation',
E'Caller cancels after 50ms. Goroutines must exit; verify via runtime.NumGoroutine().',
E'Baseline NumGoroutine restored within a few ms post-cancel. No goroutine waits on closed channel.',
false, 1),
('go-context-cancellation',
E'One URL hangs forever. Does the function still return?',
E'Yes: ctx cancels; http.Client with ctx respects cancel; WaitGroup doesn''t block because we collect via select or buffered channel.',
true, 2),

('go-mutex-vs-syncmap',
E'100 workers each call Inc on 10 hot keys. Which is faster?',
E'RWMutex+map — lower overhead on contended small key set; sync.Map adds atomic double-checked paths.',
false, 0),
('go-mutex-vs-syncmap',
E'1M workers each call Inc on a unique key.',
E'sync.Map wins — writes go through concurrent read+dirty path without single lock.',
false, 1),
('go-mutex-vs-syncmap',
E'Implement Snapshot() without races.',
E'RWMutex+map: RLock then copy. sync.Map: Range into new map; Range is snapshot-ish but not consistent — document caveat.',
true, 2),

-- ============================================================
-- SYSTEM DESIGN rubric-style test cases
-- ============================================================

('sd-url-shortener',
E'Scoring rubric criterion 1: Short-ID generation strategy.',
E'Accept: base62 of snowflake/sequence, collision handling via retry, length 7-8 chars for 10^12 keyspace.',
false, 0),
('sd-url-shortener',
E'Scoring rubric criterion 2: Read path & caching.',
E'Accept: Redis cache in front of DB with LRU eviction; CDN-level caching for very hot links; cache miss fills from primary.',
false, 1),
('sd-url-shortener',
E'Scoring rubric criterion 3: Analytics pipeline.',
E'Accept: async event emission to Kafka/Kinesis; downstream aggregation into warehouse; no synchronous write on redirect path.',
true, 2),

('sd-rate-limiter',
E'Scoring rubric criterion 1: Algorithm choice and justification.',
E'Accept: sliding window counter or token bucket, with explanation of burst allowance vs smoothness trade-off.',
false, 0),
('sd-rate-limiter',
E'Scoring rubric criterion 2: Consistency across 10 gateway instances.',
E'Accept: central Redis with atomic Lua script, or distributed cell-based approach; reject: local in-memory counters (violates limit).',
false, 1),
('sd-rate-limiter',
E'Scoring rubric criterion 3: Failure mode when Redis is down.',
E'Accept: fail-open for availability OR fail-closed with circuit breaker; candidate must articulate trade-off.',
true, 2)

) AS v(slug, input, expected, hidden, ord) ON t.slug = v.slug
ON CONFLICT DO NOTHING;

-- ============================================================
-- TASK TEMPLATES (starter code per language)
-- Every task gets Go starter. Algo+SQL get Python too. SQL gets SQL starter.
-- ============================================================

-- GO starters
INSERT INTO task_templates (task_id, language, starter_code)
SELECT t.id, v.lang, v.code
FROM tasks t
JOIN (VALUES

('two-sum-transactions', 'go',
E'package solution\n\n// TwoSum returns indices i, j such that nums[i]+nums[j] == target.\nfunc TwoSum(nums []int, target int) []int {\n\t// TODO\n\treturn nil\n}\n'),
('valid-brackets-log', 'go',
E'package solution\n\nfunc IsValid(s string) bool {\n\t// TODO\n\treturn false\n}\n'),
('reverse-event-chain', 'go',
E'package solution\n\ntype ListNode struct {\n\tVal  int\n\tNext *ListNode\n}\n\nfunc ReverseList(head *ListNode) *ListNode {\n\t// TODO\n\treturn nil\n}\n'),
('max-subarray-revenue', 'go',
E'package solution\n\nfunc MaxSubArray(nums []int) int {\n\t// TODO\n\treturn 0\n}\n'),
('climbing-rating-ladder', 'go',
E'package solution\n\nfunc ClimbStairs(n int) int {\n\t// TODO\n\treturn 0\n}\n'),
('contains-duplicate-uid', 'go',
E'package solution\n\nfunc ContainsDuplicate(nums []int) bool {\n\t// TODO\n\treturn false\n}\n'),
('best-time-buy-sell-token', 'go',
E'package solution\n\nfunc MaxProfit(prices []int) int {\n\t// TODO\n\treturn 0\n}\n'),
('valid-palindrome-slug', 'go',
E'package solution\n\nfunc IsPalindrome(s string) bool {\n\t// TODO\n\treturn false\n}\n'),
('merge-sorted-queues', 'go',
E'package solution\n\ntype ListNode struct {\n\tVal  int\n\tNext *ListNode\n}\n\nfunc MergeTwoLists(a, b *ListNode) *ListNode {\n\t// TODO\n\treturn nil\n}\n'),
('binary-search-logs', 'go',
E'package solution\n\nfunc Search(nums []int, target int) int {\n\t// TODO\n\treturn -1\n}\n'),
('lru-session-cache', 'go',
E'package solution\n\ntype LRUCache struct {\n\tcapacity int\n\t// TODO: doubly-linked list + map\n}\n\nfunc Constructor(capacity int) LRUCache {\n\treturn LRUCache{capacity: capacity}\n}\n\nfunc (c *LRUCache) Get(key int) int { return -1 }\nfunc (c *LRUCache) Put(key, value int) {}\n'),
('merge-incident-intervals', 'go',
E'package solution\n\nfunc Merge(intervals [][]int) [][]int {\n\t// TODO\n\treturn nil\n}\n'),
('group-anagram-tags', 'go',
E'package solution\n\nfunc GroupAnagrams(tags []string) [][]string {\n\t// TODO\n\treturn nil\n}\n'),
('top-k-hottest-queries', 'go',
E'package solution\n\nfunc TopKFrequent(queries []string, k int) []string {\n\t// TODO\n\treturn nil\n}\n'),
('codeword-in-grid', 'go',
E'package solution\n\nfunc Exist(board [][]byte, word string) bool {\n\t// TODO\n\treturn false\n}\n'),
('change-for-coin-drop', 'go',
E'package solution\n\nfunc CoinChange(coins []int, amount int) int {\n\t// TODO\n\treturn -1\n}\n'),
('count-region-islands', 'go',
E'package solution\n\nfunc NumIslands(grid [][]byte) int {\n\t// TODO\n\treturn 0\n}\n'),
('longest-unique-stream', 'go',
E'package solution\n\nfunc LengthOfLongestSubstring(s string) int {\n\t// TODO\n\treturn 0\n}\n'),
('rotate-ring-buffer', 'go',
E'package solution\n\nfunc Rotate(nums []int, k int) {\n\t// TODO: in place\n}\n'),
('product-except-self-metric', 'go',
E'package solution\n\nfunc ProductExceptSelf(nums []int) []int {\n\t// TODO\n\treturn nil\n}\n'),
('jump-game-matchmaker', 'go',
E'package solution\n\nfunc CanJump(nums []int) bool {\n\t// TODO\n\treturn false\n}\n'),
('triple-sum-partners', 'go',
E'package solution\n\nfunc ThreeSum(nums []int) [][]int {\n\t// TODO\n\treturn nil\n}\n'),
('unique-paths-grid-release', 'go',
E'package solution\n\nfunc UniquePaths(m, n int) int {\n\t// TODO\n\treturn 0\n}\n'),
('find-duplicate-id', 'go',
E'package solution\n\nfunc FindDuplicate(nums []int) int {\n\t// TODO: O(1) memory, do not modify nums\n\treturn 0\n}\n'),
('sort-priority-flags', 'go',
E'package solution\n\nfunc SortColors(nums []int) {\n\t// TODO: one pass, no counting\n}\n'),
('trapping-rain-logs', 'go',
E'package solution\n\nfunc Trap(height []int) int {\n\t// TODO\n\treturn 0\n}\n'),
('median-two-shards', 'go',
E'package solution\n\nfunc FindMedianSortedArrays(a, b []int) float64 {\n\t// TODO: O(log(min(m,n)))\n\treturn 0\n}\n'),
('n-queens-cluster', 'go',
E'package solution\n\n// TotalNQueens returns the number of distinct solutions.\nfunc TotalNQueens(n int) int {\n\t// TODO: backtracking\n\treturn 0\n}\n'),
('word-ladder-docs', 'go',
E'package solution\n\nfunc LadderLength(beginWord, endWord string, wordList []string) int {\n\t// TODO: BFS\n\treturn 0\n}\n'),
('regex-match-route', 'go',
E'package solution\n\nfunc IsMatch(s, p string) bool {\n\t// TODO: DP\n\treturn false\n}\n'),
('go-goroutine-channel-bug', 'go',
E'package solution\n\n// BROKEN — fix the leak / deadlock and return the corrected function.\nfunc FanOut(n int) <-chan int {\n\tout := make(chan int)\n\tfor i := 0; i < n; i++ {\n\t\tgo func(i int) {\n\t\t\tout <- i * i\n\t\t}(i)\n\t}\n\treturn out\n}\n'),
('go-context-cancellation', 'go',
E'package solution\n\nimport (\n\t"context"\n\t"net/http"\n)\n\ntype Result struct {\n\tURL    string\n\tStatus int\n\tErr    error\n}\n\nfunc DoWork(ctx context.Context, urls []string) []Result {\n\t// TODO: parallel fetch, cancel all on ctx.Done()\n\treturn nil\n}\n\nvar _ = http.DefaultClient\n'),
('go-mutex-vs-syncmap', 'go',
E'package solution\n\n// Implement TWO versions and compare.\ntype CounterMutex struct {\n\t// TODO: sync.RWMutex + map[string]int\n}\n\nfunc (c *CounterMutex) Inc(key string) {}\nfunc (c *CounterMutex) Get(key string) int { return 0 }\nfunc (c *CounterMutex) Snapshot() map[string]int { return nil }\n\ntype CounterSyncMap struct {\n\t// TODO: sync.Map with atomic increment\n}\n\nfunc (c *CounterSyncMap) Inc(key string) {}\nfunc (c *CounterSyncMap) Get(key string) int { return 0 }\nfunc (c *CounterSyncMap) Snapshot() map[string]int { return nil }\n'),

-- SQL starter (SQL starter uses sql language; plus go placeholder for runners)
('sql-total-revenue-by-month', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-top-5-users-by-spend', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-second-highest-salary', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-running-total', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-day-over-day-diff', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-rank-per-group', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-cte-order-summary', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-recursive-hierarchy', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-inner-vs-left-join', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-window-moving-avg', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-self-join-pairs', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-anti-join-churn', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-pivot-by-month', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-percentile-latency', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),
('sql-dedupe-keep-latest', 'go',
E'package solution\n\n// SQL task — submit in the sql editor.\n'),

-- system design go placeholder (text answer expected)
('sd-url-shortener', 'go',
E'package solution\n\n// System design task — submit as markdown in the design editor.\n'),
('sd-rate-limiter', 'go',
E'package solution\n\n// System design task — submit as markdown in the design editor.\n')

) AS v(slug, lang, code) ON t.slug = v.slug
ON CONFLICT DO NOTHING;

-- PYTHON starters (algorithms + sql placeholders)
INSERT INTO task_templates (task_id, language, starter_code)
SELECT t.id, v.lang, v.code
FROM tasks t
JOIN (VALUES

('two-sum-transactions', 'python',
E'from typing import List\n\nclass Solution:\n    def two_sum(self, nums: List[int], target: int) -> List[int]:\n        # TODO\n        return []\n'),
('valid-brackets-log', 'python',
E'class Solution:\n    def is_valid(self, s: str) -> bool:\n        # TODO\n        return False\n'),
('reverse-event-chain', 'python',
E'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\nclass Solution:\n    def reverse_list(self, head):\n        # TODO\n        return None\n'),
('max-subarray-revenue', 'python',
E'from typing import List\n\nclass Solution:\n    def max_sub_array(self, nums: List[int]) -> int:\n        # TODO\n        return 0\n'),
('climbing-rating-ladder', 'python',
E'class Solution:\n    def climb_stairs(self, n: int) -> int:\n        # TODO\n        return 0\n'),
('contains-duplicate-uid', 'python',
E'from typing import List\n\nclass Solution:\n    def contains_duplicate(self, nums: List[int]) -> bool:\n        # TODO\n        return False\n'),
('best-time-buy-sell-token', 'python',
E'from typing import List\n\nclass Solution:\n    def max_profit(self, prices: List[int]) -> int:\n        # TODO\n        return 0\n'),
('valid-palindrome-slug', 'python',
E'class Solution:\n    def is_palindrome(self, s: str) -> bool:\n        # TODO\n        return False\n'),
('merge-sorted-queues', 'python',
E'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\nclass Solution:\n    def merge_two_lists(self, a, b):\n        # TODO\n        return None\n'),
('binary-search-logs', 'python',
E'from typing import List\n\nclass Solution:\n    def search(self, nums: List[int], target: int) -> int:\n        # TODO\n        return -1\n'),
('lru-session-cache', 'python',
E'class LRUCache:\n    def __init__(self, capacity: int):\n        self.capacity = capacity\n        # TODO: OrderedDict or dll + hashmap\n\n    def get(self, key: int) -> int:\n        return -1\n\n    def put(self, key: int, value: int) -> None:\n        pass\n'),
('merge-incident-intervals', 'python',
E'from typing import List\n\nclass Solution:\n    def merge(self, intervals: List[List[int]]) -> List[List[int]]:\n        # TODO\n        return []\n'),
('group-anagram-tags', 'python',
E'from typing import List\n\nclass Solution:\n    def group_anagrams(self, tags: List[str]) -> List[List[str]]:\n        # TODO\n        return []\n'),
('top-k-hottest-queries', 'python',
E'from typing import List\n\nclass Solution:\n    def top_k_frequent(self, queries: List[str], k: int) -> List[str]:\n        # TODO\n        return []\n'),
('codeword-in-grid', 'python',
E'from typing import List\n\nclass Solution:\n    def exist(self, board: List[List[str]], word: str) -> bool:\n        # TODO\n        return False\n'),
('change-for-coin-drop', 'python',
E'from typing import List\n\nclass Solution:\n    def coin_change(self, coins: List[int], amount: int) -> int:\n        # TODO\n        return -1\n'),
('count-region-islands', 'python',
E'from typing import List\n\nclass Solution:\n    def num_islands(self, grid: List[List[str]]) -> int:\n        # TODO\n        return 0\n'),
('longest-unique-stream', 'python',
E'class Solution:\n    def length_of_longest_substring(self, s: str) -> int:\n        # TODO\n        return 0\n'),
('rotate-ring-buffer', 'python',
E'from typing import List\n\nclass Solution:\n    def rotate(self, nums: List[int], k: int) -> None:\n        # TODO: in-place\n        pass\n'),
('product-except-self-metric', 'python',
E'from typing import List\n\nclass Solution:\n    def product_except_self(self, nums: List[int]) -> List[int]:\n        # TODO\n        return []\n'),
('jump-game-matchmaker', 'python',
E'from typing import List\n\nclass Solution:\n    def can_jump(self, nums: List[int]) -> bool:\n        # TODO\n        return False\n'),
('triple-sum-partners', 'python',
E'from typing import List\n\nclass Solution:\n    def three_sum(self, nums: List[int]) -> List[List[int]]:\n        # TODO\n        return []\n'),
('unique-paths-grid-release', 'python',
E'class Solution:\n    def unique_paths(self, m: int, n: int) -> int:\n        # TODO\n        return 0\n'),
('find-duplicate-id', 'python',
E'from typing import List\n\nclass Solution:\n    def find_duplicate(self, nums: List[int]) -> int:\n        # TODO: O(1) extra memory\n        return 0\n'),
('sort-priority-flags', 'python',
E'from typing import List\n\nclass Solution:\n    def sort_colors(self, nums: List[int]) -> None:\n        # TODO: one pass\n        pass\n'),
('trapping-rain-logs', 'python',
E'from typing import List\n\nclass Solution:\n    def trap(self, height: List[int]) -> int:\n        # TODO\n        return 0\n'),
('median-two-shards', 'python',
E'from typing import List\n\nclass Solution:\n    def find_median_sorted_arrays(self, a: List[int], b: List[int]) -> float:\n        # TODO\n        return 0.0\n'),
('n-queens-cluster', 'python',
E'class Solution:\n    def total_n_queens(self, n: int) -> int:\n        # TODO\n        return 0\n'),
('word-ladder-docs', 'python',
E'from typing import List\n\nclass Solution:\n    def ladder_length(self, begin: str, end: str, word_list: List[str]) -> int:\n        # TODO\n        return 0\n'),
('regex-match-route', 'python',
E'class Solution:\n    def is_match(self, s: str, p: str) -> bool:\n        # TODO\n        return False\n')

) AS v(slug, lang, code) ON t.slug = v.slug
ON CONFLICT DO NOTHING;

-- SQL language starter for SQL tasks
INSERT INTO task_templates (task_id, language, starter_code)
SELECT t.id, 'sql', v.code
FROM tasks t
JOIN (VALUES

('sql-total-revenue-by-month',
E'-- Monthly revenue for 2024, ordered by month asc.\n-- columns: month (YYYY-MM), total_revenue, orders_count\nSELECT\n  to_char(created_at, ''YYYY-MM'') AS month,\n  -- TODO: sum, count\nFROM orders\nWHERE created_at >= ''2024-01-01'' AND created_at < ''2025-01-01''\nGROUP BY 1\nORDER BY 1;\n'),
('sql-top-5-users-by-spend',
E'-- Top 5 users by all-time spend.\nSELECT u.username, SUM(o.amount) AS total_spent\nFROM users u\nJOIN orders o ON o.user_id = u.id\n-- TODO\n;\n'),
('sql-second-highest-salary',
E'-- Second distinct salary (desc), NULL if absent.\nSELECT -- TODO\n  AS second_salary;\n'),
('sql-running-total',
E'-- Running total of amount per user, ordered by date.\nSELECT user_id, created_at, amount,\n       -- TODO: SUM(...) OVER (...)\n       AS running_total\nFROM orders\nORDER BY user_id, created_at;\n'),
('sql-day-over-day-diff',
E'-- Delta in dau vs previous day.\nSELECT day, dau,\n       -- TODO: LAG\n       AS delta\nFROM daily_dau\nORDER BY day;\n'),
('sql-rank-per-group',
E'-- Top 3 priciest per category.\nWITH ranked AS (\n  SELECT category, name, price,\n         -- TODO ROW_NUMBER/DENSE_RANK\n         AS rnk\n  FROM products\n)\nSELECT category, rnk AS rank, name, price\nFROM ranked\nWHERE rnk <= 3\nORDER BY category, rnk;\n'),
('sql-cte-order-summary',
E'-- avg / median / stddev of amount per user.\nWITH stats AS (\n  SELECT user_id,\n         -- TODO aggregates\n  FROM orders\n  GROUP BY user_id\n)\nSELECT * FROM stats;\n'),
('sql-recursive-hierarchy',
E'-- Full subordinate chain of employee 42 with depth.\nWITH RECURSIVE sub AS (\n  SELECT id, name, 0 AS depth FROM employees WHERE id = 42\n  UNION ALL\n  SELECT e.id, e.name, s.depth + 1\n  FROM employees e\n  JOIN sub s ON e.manager_id = s.id\n)\nSELECT * FROM sub ORDER BY depth, id;\n'),
('sql-inner-vs-left-join',
E'-- Users with no orders.\nSELECT u.username\nFROM users u\nLEFT JOIN orders o ON o.user_id = u.id\n-- TODO WHERE ... IS NULL\n;\n'),
('sql-window-moving-avg',
E'-- 7-day moving average of dau.\nSELECT day, dau,\n       -- TODO AVG OVER ROWS BETWEEN\n       AS ma7\nFROM daily_dau\nORDER BY day;\n'),
('sql-self-join-pairs',
E'-- Pairs of overlapping sessions of the same user.\nSELECT s1.id AS id1, s2.id AS id2\nFROM sessions s1\nJOIN sessions s2 ON s1.user_id = s2.user_id AND s1.id < s2.id\n-- TODO: overlap condition\n;\n'),
('sql-anti-join-churn',
E'-- Users who ordered in 2023 but not 2024.\n-- TODO: EXCEPT or NOT EXISTS\nSELECT DISTINCT user_id FROM orders;\n'),
('sql-pivot-by-month',
E'-- Pivot sum(amount) by user × month of 2024.\nSELECT user_id,\n       SUM(CASE WHEN EXTRACT(MONTH FROM created_at)=1 THEN amount ELSE 0 END) AS jan,\n       -- TODO feb..dec\n       0 AS dec\nFROM orders\nWHERE EXTRACT(YEAR FROM created_at) = 2024\nGROUP BY user_id\nORDER BY user_id;\n'),
('sql-percentile-latency',
E'-- p50, p95, p99 latency per endpoint.\nSELECT endpoint,\n       -- TODO percentile_cont\nFROM api_calls\nGROUP BY endpoint;\n'),
('sql-dedupe-keep-latest',
E'-- Keep only latest row per (user_id, event_type).\nWITH ranked AS (\n  SELECT *,\n         ROW_NUMBER() OVER (PARTITION BY user_id, event_type ORDER BY created_at DESC) AS rn\n  FROM events\n)\nSELECT user_id, event_type, created_at\nFROM ranked\nWHERE rn = 1\nORDER BY user_id, event_type;\n')

) AS v(slug, code) ON t.slug = v.slug
ON CONFLICT DO NOTHING;

-- ============================================================
-- FOLLOW-UP QUESTIONS (2-3 per task)
-- ============================================================

INSERT INTO follow_up_questions (task_id, question_ru, question_en, answer_hint, order_num)
SELECT t.id, v.q_ru, v.q_en, v.hint, v.ord
FROM tasks t
JOIN (VALUES

-- algorithms easy
('two-sum-transactions', 'Какая сложность по времени и памяти у вашего решения?', 'What is the time and space complexity?',
 'Hash map: O(n) time, O(n) memory. Brute force: O(n^2)/O(1).', 0),
('two-sum-transactions', 'Что если массив отсортирован — можно ли решить за O(1) памяти?', 'If the array is sorted, can you solve it in O(1) memory?',
 'Two pointers from both ends — O(n)/O(1).', 1),
('two-sum-transactions', 'Как расширить до k-Sum?', 'How would you extend to k-Sum?',
 'Recursion / fix first element and reduce to (k-1)-Sum. 3Sum is O(n^2), 4Sum is O(n^3).', 2),

('valid-brackets-log', 'Почему именно стек подходит лучше других структур?', 'Why is a stack the right structure here?',
 'LIFO matches the nested nature of brackets — the latest opener must match the next closer.', 0),
('valid-brackets-log', 'Как проверить валидность XML с тегами вместо символов?', 'Extend to XML tags instead of single chars?',
 'Same algorithm, but stack elements are tag names; compare full names on close.', 1),

('reverse-event-chain', 'Можно ли написать рекурсивное решение? Плюсы и минусы?', 'Can you do it recursively? Pros/cons?',
 'Yes — elegant, but O(n) call stack can overflow on long lists. Iterative is O(1) space.', 0),
('reverse-event-chain', 'Как развернуть список по группам из k?', 'Reverse in k-groups?',
 'Reverse each group with helper that returns new head+tail; stitch groups; handle remainder.', 1),

('max-subarray-revenue', 'Почему алгоритм Кадане работает?', 'Why does Kadane''s algorithm work?',
 'At each i the optimal subarray ending at i is max(nums[i], bestEndingAtPrev + nums[i]).', 0),
('max-subarray-revenue', 'Верните сам подотрезок, не только сумму.', 'Return the subarray itself, not just the sum.',
 'Track start/end indices; on reset set start=i; on new best, lock end=i.', 1),

('climbing-rating-ladder', 'Оцените сложность и память решения.', 'What is the complexity and memory?',
 'O(n) time, O(1) memory with two rolling variables.', 0),
('climbing-rating-ladder', 'Что если шагов 1,2,3? Или произвольное множество K?', 'What if steps are {1,2,3} or any set K?',
 'DP: dp[i] = sum over k in K of dp[i-k]. Time O(n·|K|).', 1),

('contains-duplicate-uid', 'Разберите решение set vs sort.', 'Compare set vs sort approaches.',
 'Set: O(n)/O(n). Sort+sweep: O(n log n)/O(1). Pick based on memory constraints.', 0),
('contains-duplicate-uid', 'Как найти все дубликаты в потоке, не держа всё в памяти?', 'Stream: find duplicates without holding everything?',
 'Bloom filter as first-pass; confirm on DB. Trade-off: false positives.', 1),

('best-time-buy-sell-token', 'А если разрешено несколько покупок/продаж?', 'What if multiple buy-sells are allowed?',
 'Sum up every positive delta between consecutive days — greedy works.', 0),
('best-time-buy-sell-token', 'С холодом в 1 день между сделками?', 'With a 1-day cooldown?',
 'DP with states held/sold/rest; transitions via max of options.', 1),

('valid-palindrome-slug', 'Как учесть Unicode-символы и casefold?', 'Handle Unicode and case-folding?',
 'Use Python str.casefold() or Go unicode.ToLower; iterate runes, not bytes.', 0),
('valid-palindrome-slug', 'Проверка почти-палиндрома (можно удалить один символ).', 'Check "almost palindrome" (delete 1 char)?',
 'On mismatch, try skipping either left or right — at most one allowed.', 1),

('merge-sorted-queues', 'Как слить k списков? Сложность?', 'Merge k lists? Complexity?',
 'Min-heap of heads: O(N log k). Or divide-and-conquer pairwise merge.', 0),
('merge-sorted-queues', 'А если поток бесконечный? Чем рискуем?', 'Infinite streams — what are the risks?',
 'Unbounded buffer; use backpressure or bounded channels.', 1),

('binary-search-logs', 'Что если массив содержит дубликаты? Как найти первое вхождение?', 'With duplicates — find leftmost?',
 'Instead of returning on equal, set hi = mid; return lo at end.', 0),
('binary-search-logs', 'Бинарный поиск по ответу — приведите пример.', 'Give an example of binary search on the answer.',
 'Minimising max load balancing, k-th smallest in sorted matrix, Koko bananas.', 1),

-- algorithms medium
('lru-session-cache', 'Почему sync.Map в Go — плохой выбор для LRU?', 'Why is sync.Map a bad choice for LRU?',
 'sync.Map has no ordering; you still need a separate order list; atomic ops are not coordinated with eviction.', 0),
('lru-session-cache', 'Как реализовать потокобезопасный LRU?', 'Make it thread-safe.',
 'Full mutex around both map and list ops; finer-grained locking is tricky because list + map must be consistent.', 1),

('merge-incident-intervals', 'А если интервалы поступают в потоке?', 'What if intervals arrive in a stream?',
 'Keep sorted structure (TreeMap/IntervalTree); insertions cost O(log n) and may split/merge neighbours.', 0),
('merge-incident-intervals', 'Как посчитать максимальное число одновременных инцидентов?', 'How many incidents overlap at most at once?',
 'Sweep line over sorted start/end events; maintain running counter; answer is max.', 1),

('group-anagram-tags', 'Почему счётчик-ключ лучше sorted() при больших строках?', 'Why is a counter key better than sorted() for long strings?',
 'Counter key is O(k) vs sorted O(k log k); faster on long words.', 0),
('group-anagram-tags', 'Unicode и локаль.', 'Unicode and locale.',
 'NFKC normalise; casefold; sort by code point.', 1),

('top-k-hottest-queries', 'Heap of k или bucket sort по частоте?', 'Heap-of-k or bucket-sort on frequency?',
 'Heap: O(n log k). Bucket: O(n) if k small and frequencies bounded. Pick by k/n ratio.', 0),
('top-k-hottest-queries', 'Стрим-версия с ограниченной памятью?', 'Streaming version with limited memory?',
 'Count-Min Sketch + min-heap of top-k candidates; approximate.', 1),

('codeword-in-grid', 'Почему нужен backtracking, а не просто DFS?', 'Why backtracking vs plain DFS?',
 'Must un-mark visited cell on return so other paths can use it.', 0),
('codeword-in-grid', 'Как ускорить для множества слов (Word Search II)?', 'Multiple words — speedup?',
 'Build a Trie of words, DFS the grid once matching trie edges; prune heavily.', 1),

('change-for-coin-drop', 'Разница между top-down (mem) и bottom-up DP.', 'Top-down memo vs bottom-up DP.',
 'Top-down recurses only needed states; bottom-up fills all, simpler code, cache-friendly.', 0),
('change-for-coin-drop', 'Число способов разменять vs минимум монет.', 'Number of ways vs minimum coins.',
 'Number of ways: sum of dp[i-c]; order of loops (coin outer, amount inner) matters to avoid permutations.', 1),

('count-region-islands', 'DFS vs BFS vs Union-Find — какой выбрать?', 'DFS vs BFS vs Union-Find — pick?',
 'All work. Union-Find shines when cells are added dynamically.', 0),
('count-region-islands', 'Как распараллелить на больших сетках?', 'How to parallelise on large grids?',
 'Chunk grid, find local components, then merge on boundaries via union-find.', 1),

('longest-unique-stream', 'Почему sliding window, а не brute force?', 'Why sliding window, not brute force?',
 'Brute force is O(n^3); sliding window is O(n) because each char is added/removed at most once.', 0),
('longest-unique-stream', 'А ограничено на ≤ k повторов?', 'At most k repeats allowed?',
 'Track counts in window; shrink while violated; record max.', 1),

('rotate-ring-buffer', 'Ещё подходы кроме триумвирата реверсов?', 'Other approaches besides the triple reverse?',
 'Cyclic replacements tracking GCD cycles; or O(n) extra memory with modular indexing.', 0),
('rotate-ring-buffer', 'Какой подход лучше для in-place с min ops?', 'Best in-place with fewest moves?',
 'GCD cycle approach: exactly n writes, O(1) memory.', 1),

('product-except-self-metric', 'Как быть, если есть нули в массиве?', 'What if there are zeros?',
 'Count zeros; if >1 all zeros; if =1 only zero-position has product of others; else normal.', 0),
('product-except-self-metric', 'Без доп. массива O(1) extra memory — возможно?', 'O(1) extra memory (output excluded)?',
 'Yes — one pass for prefix into output, one pass for suffix with a rolling variable.', 1),

('jump-game-matchmaker', 'Почему жадный алгоритм корректен?', 'Why is greedy correct?',
 'If farthest reachable at i >= n-1, we can reach end; monotone non-decreasing argument.', 0),
('jump-game-matchmaker', 'Минимальное число прыжков?', 'Minimum number of jumps?',
 'BFS-like greedy — expand current reach layer; increment jumps when current layer exhausted.', 1),

('triple-sum-partners', 'Как избежать дубликатов троек?', 'How to avoid duplicate triples?',
 'Sort, skip i when nums[i]==nums[i-1]; inside two-pointer skip equal left/right after match.', 0),
('triple-sum-partners', 'Обобщение на kSum?', 'kSum generalisation?',
 'Recursion: kSum reduces to (k-1)Sum with target-nums[i]; base case 2Sum with two pointers.', 1),

('unique-paths-grid-release', 'Формула через сочетания.', 'Combinatorial formula?',
 'C(m+n-2, m-1) — choose which steps are down.', 0),
('unique-paths-grid-release', 'С препятствиями?', 'With obstacles?',
 'DP with dp[i][j]=0 where blocked; else sum of top+left.', 1),

('find-duplicate-id', 'Почему нельзя сортировать или модифицировать массив?', 'Why can''t we sort or modify the array?',
 'Constraint of the problem; Floyd''s cycle keeps it pure.', 0),
('find-duplicate-id', 'Можно ли использовать bit manipulation?', 'Can bit manipulation work?',
 'XOR trick needs all elements to appear once — not applicable here; use Floyd''s or binary search on value range.', 1),

('sort-priority-flags', 'Ещё алгоритмы для трёх цветов?', 'Other algorithms for three colours?',
 'Counting sort: count and re-write. But DNF is one-pass O(1).', 0),
('sort-priority-flags', 'Четыре цвета — что меняется?', 'Four colours — what changes?',
 'Can''t do strict one-pass three-pointer; consider counting sort or multiple passes.', 1),

-- algorithms hard
('trapping-rain-logs', 'Трёхмерный вариант задачи?', '3D variant?',
 'Priority-queue-based: process cells from lowest boundary in, track water level; O(mn log(mn)).', 0),
('trapping-rain-logs', 'Edge case: все столбцы одной высоты.', 'All bars same height.',
 'Answer is 0 — trivial.', 1),

('median-two-shards', 'Как обобщить на k отсортированных массивов?', 'Generalise to k sorted arrays?',
 'No known O(log(sum)); heap-based O(total log k). For very large sizes use approximate percentiles (TDigest).', 0),
('median-two-shards', 'Что происходит при пустом массиве?', 'What if an array is empty?',
 'Reduce to median of the other; handle edge in partition logic.', 1),

('n-queens-cluster', 'Как симметрия уменьшает перебор?', 'How does symmetry reduce search?',
 'First queen only on half of first row; multiply answer appropriately. Halves runtime roughly.', 0),
('n-queens-cluster', 'Сложность и эвристики отсечения?', 'Complexity and pruning heuristics?',
 'Exponential worst-case ~O(n!); forward-checking on diagonals cuts drastically.', 1),

('word-ladder-docs', 'Как двусторонний BFS улучшает время?', 'Bidirectional BFS improvement?',
 'Expands from both ends; meets in the middle; reduces branching factor cost roughly to sqrt.', 0),
('word-ladder-docs', 'Почему обычный DFS плохо работает?', 'Why is plain DFS bad?',
 'Exponential paths; BFS gives shortest naturally.', 1),

('regex-match-route', 'DP vs recursion-with-memo — есть ли разница?', 'DP vs recursion+memo — any difference?',
 'Same asymptotics O(mn). DP easier to reason bottom-up; recursion clearer for some edge cases.', 0),
('regex-match-route', 'Как реализовать через NFA?', 'How would an NFA implementation look?',
 'Thompson''s construction: states, epsilon transitions; simulate set of active states per char.', 1),

-- sql
('sql-total-revenue-by-month', 'Какой индекс ускорит запрос на больших объёмах?', 'Which index speeds this up at scale?',
 'B-tree on created_at; BRIN for append-only append-ordered tables.', 0),
('sql-total-revenue-by-month', 'Как решить ту же задачу на материализованной view?', 'With a materialised view?',
 'Precompute monthly sums; REFRESH MATERIALIZED VIEW CONCURRENTLY on schedule.', 1),

('sql-top-5-users-by-spend', 'Что если два пользователя с равной суммой?', 'Ties in total_spent?',
 'Use DENSE_RANK or ORDER BY sum DESC, id to be deterministic.', 0),
('sql-top-5-users-by-spend', 'Масштаб: 100M заказов — как оптимизировать?', '100M orders — optimise?',
 'Pre-aggregate per user (materialised view or OLAP columnstore); partition by date.', 1),

('sql-second-highest-salary', 'А третья? N-я?', 'Third? N-th?',
 'DENSE_RANK() = N. Or OFFSET N-1 LIMIT 1 on distinct salaries desc.', 0),
('sql-second-highest-salary', 'Почему DISTINCT важен?', 'Why is DISTINCT important?',
 'Two employees with the highest same salary shouldn''t both occupy rank 1 in a rank-by-value question.', 1),

('sql-running-total', 'Что если заказы в один день?', 'Same-day orders?',
 'Specify tiebreaker in ORDER BY (e.g., id) to make the running total deterministic.', 0),
('sql-running-total', 'Отличие ROWS vs RANGE.', 'ROWS vs RANGE.',
 'ROWS counts physical rows; RANGE groups ties within the order value — different on ties.', 1),

('sql-day-over-day-diff', 'Как считать W-o-W и M-o-M?', 'WoW / MoM?',
 'LAG with offset=7 or 30; or join same table with shifted dates.', 0),
('sql-day-over-day-diff', 'Пропуски в данных — что делать?', 'Missing days — what to do?',
 'generate_series over date range and LEFT JOIN; COALESCE(dau,0).', 1),

('sql-rank-per-group', 'Разница ROW_NUMBER / RANK / DENSE_RANK.', 'ROW_NUMBER / RANK / DENSE_RANK differences.',
 'ROW_NUMBER: unique serial. RANK: gaps on ties. DENSE_RANK: no gaps on ties.', 0),
('sql-rank-per-group', 'Top N-per-group — индексы?', 'Top-N per group — indexes?',
 'Composite (category, price DESC) supports index-only scan + window.', 1),

('sql-cte-order-summary', 'Зачем нужен CTE, если можно подзапросом?', 'Why CTE over subquery?',
 'Readability; in Postgres 12+ CTE is often inlined unless materialised.', 0),
('sql-cte-order-summary', 'PERCENTILE_CONT vs PERCENTILE_DISC.', 'PERCENTILE_CONT vs PERCENTILE_DISC.',
 'CONT interpolates between values; DISC returns an existing value; for medians CONT is usually desired.', 1),

('sql-recursive-hierarchy', 'Риск бесконечной рекурсии?', 'Risk of infinite recursion?',
 'Cycles in data (manager loop). Add depth cap via WHERE depth<N or explicit visited check.', 0),
('sql-recursive-hierarchy', 'Как посчитать размер поддерева?', 'How to compute subtree size?',
 'Recursive CTE + final GROUP BY root_id COUNT.', 1),

('sql-inner-vs-left-join', 'Почему NOT IN рискован с NULL?', 'Why is NOT IN risky with NULLs?',
 'If subquery contains NULL, NOT IN returns UNKNOWN for everything → empty result. Use NOT EXISTS.', 0),
('sql-inner-vs-left-join', 'План запроса LEFT JOIN + IS NULL.', 'LEFT JOIN + IS NULL plan.',
 'Usually implemented as hash anti-join or merge anti-join; Postgres recognises the pattern.', 1),

('sql-window-moving-avg', 'Почему окно даёт ma7 даже для первого дня?', 'Why does MA7 work on day 1?',
 'The frame starts at UNBOUNDED/6 PRECEDING; when not enough rows, it just averages what exists.', 0),
('sql-window-moving-avg', 'Скользящий ряд с пропусками дней — решение.', 'With missing days?',
 'generate_series + LEFT JOIN + COALESCE; then window over continuous axis.', 1),

('sql-self-join-pairs', 'Сложность на 10M строк?', 'Complexity at 10M rows?',
 'Naive O(n^2); use interval tree in app-layer or temporal indexing (btree_gist).', 0),
('sql-self-join-pairs', 'btree_gist / range types.', 'btree_gist / range types.',
 'tsrange column + GiST index + && overlap operator = fast overlap queries.', 1),

('sql-anti-join-churn', 'EXCEPT vs LEFT JOIN vs NOT EXISTS.', 'EXCEPT vs LEFT JOIN vs NOT EXISTS.',
 'All return the same; NOT EXISTS usually has best planner support and handles NULL correctly.', 0),
('sql-anti-join-churn', 'Индекс для быстрого анти-join.', 'Index for anti-join speed.',
 'Index on orders(user_id, year) or partial index WHERE created_at >= ''2024-01-01''.', 1),

('sql-pivot-by-month', 'Динамический pivot — как?', 'Dynamic pivot?',
 'Build SQL string in app layer or use crosstab() from tablefunc extension.', 0),
('sql-pivot-by-month', 'Почему CASE, а не FILTER?', 'Why CASE vs FILTER?',
 'FILTER is cleaner: SUM(amount) FILTER (WHERE month=1); both valid in Postgres.', 1),

('sql-percentile-latency', 'PERCENTILE_CONT vs approximate (tdigest).', 'PERCENTILE_CONT vs approximate (tdigest).',
 'Exact needs sort; approximate uses O(log n) sketch — required at huge scale.', 0),
('sql-percentile-latency', 'Индекс для p99 запросов?', 'Index for p99 queries?',
 'Index on (endpoint, latency_ms) helps per-endpoint sort for PERCENTILE_CONT.', 1),

('sql-dedupe-keep-latest', 'Альтернатива ROW_NUMBER?', 'Alternative to ROW_NUMBER?',
 'DISTINCT ON in Postgres: SELECT DISTINCT ON (user_id,event_type) * ORDER BY user_id,event_type,created_at DESC.', 0),
('sql-dedupe-keep-latest', 'UPSERT на источнике.', 'UPSERT at source.',
 'INSERT ... ON CONFLICT(user_id,event_type) DO UPDATE SET created_at=EXCLUDED.created_at WHERE EXCLUDED.created_at>events.created_at.', 1),

-- go
('go-goroutine-channel-bug', 'Как возникает утечка?', 'How does the leak happen?',
 'Unbuffered send blocks until a receiver reads; if receiver quits early, senders block forever.', 0),
('go-goroutine-channel-bug', 'Когда закрывает канал writer, а когда reader?', 'Who closes the channel?',
 'Only senders close. With multiple senders, use WaitGroup to close once all done.', 1),
('go-goroutine-channel-bug', 'Buffered channel решает проблему?', 'Does buffering solve it?',
 'Only if buffer ≥ number of sends and receiver drains eventually. Not a general fix.', 2),

('go-context-cancellation', 'Чем context.Background отличается от context.TODO?', 'Background vs TODO?',
 'Semantically — Background is the root; TODO marks "didn''t know what to pass". Same runtime value.', 0),
('go-context-cancellation', 'Как прокинуть timeout к sql.DB?', 'How to wire timeout to sql.DB?',
 'Use QueryContext/ExecContext with ctx carrying deadline.', 1),

('go-mutex-vs-syncmap', 'Deadlock detection в Go — есть ли встроенный?', 'Built-in deadlock detection?',
 'Only the runtime panic "all goroutines are asleep — deadlock". Tools: go-deadlock, race detector.', 0),
('go-mutex-vs-syncmap', 'Atomic int vs mutex для счётчика.', 'Atomic int vs mutex for a counter?',
 'sync/atomic is much faster but only for single var; mutex needed for multi-field invariants.', 1),

-- system design
('sd-url-shortener', 'Как избежать коллизий при параллельной генерации?', 'Avoid ID collisions under parallelism?',
 'Use monotonic sequence, snowflake, or reserve-ranges per worker; avoid random if possible.', 0),
('sd-url-shortener', 'Как сделать хранение дешёвым при 10^12 ключей?', 'Make storage cheap at 10^12 keys?',
 'Columnar storage or KV store like DynamoDB; TTL cleanup; cold-store expired entries.', 1),
('sd-url-shortener', 'Как обеспечить защиту от abuse?', 'Abuse protection?',
 'Rate limiting on create; domain blocklist; spam ML scoring on target URLs.', 2),

('sd-rate-limiter', 'Token bucket vs sliding window — когда что?', 'Token bucket vs sliding window — when?',
 'Token bucket allows bursts up to bucket size; sliding window is smoother and prevents hot spikes at boundaries.', 0),
('sd-rate-limiter', 'Как перераспределить budget при неравномерном трафике?', 'Budget redistribution on uneven traffic?',
 'Global token pool with async sync; or hierarchical limiters per tenant/region.', 1),
('sd-rate-limiter', 'А per-IP vs per-user — что лучше?', 'Per-IP vs per-user?',
 'Combine both: per-IP for anonymous abuse; per-user (API key) for authenticated.', 2)

) AS v(slug, q_ru, q_en, hint, ord) ON t.slug = v.slug
ON CONFLICT DO NOTHING;

-- ============================================================
-- PODCASTS (12) — bible §3.9
-- Distribution: 4 system_design, 3 algorithms, 2 sql, 1 go, 2 behavioral
-- ============================================================

INSERT INTO podcasts (title_ru, title_en, description, section, duration_sec, audio_key, is_published)
SELECT v.title_ru, v.title_en, v.descr, v.section, v.dur, v.audio_key, TRUE
FROM (VALUES
  ('Погружение в consistent hashing', 'Dive into consistent hashing',
   'Как распределять ключи по шардам так, чтобы ребаланс не клал прод. Классика для system design.',
   'system_design', 2100, 'podcasts/consistent-hashing.mp3'),
  ('Разбор CAP-теоремы на пальцах', 'CAP theorem, no bullshit',
   'Что значит "выбрать любые две из трёх" на практике — с примерами из Postgres, Cassandra, MongoDB.',
   'system_design', 2400, 'podcasts/cap-theorem.mp3'),
  ('Как работает rate limiter в проде', 'Rate limiters in production',
   'Token bucket, sliding window, distributed Redis — реальные grабли и как их избежать.',
   'system_design', 1800, 'podcasts/rate-limiter.mp3'),
  ('Event sourcing vs CRUD: разбор', 'Event sourcing vs CRUD',
   'Когда event sourcing действительно стоит сложности, а когда это стрельба из пушки по воробьям.',
   'system_design', 2700, 'podcasts/event-sourcing.mp3'),
  ('Big-O интуитивно: зачем учить асимптотику', 'Big-O intuitively',
   'Объясняем O(n), O(n log n), O(n^2) через примеры с бэкендом и реальными SQL-запросами.',
   'algorithms', 1500, 'podcasts/big-o.mp3'),
  ('Динамическое программирование за 30 минут', 'DP in 30 minutes',
   'Откуда берётся DP, как увидеть его в новой задаче, примеры ступенек, рюкзака и LIS.',
   'algorithms', 1800, 'podcasts/dp-basics.mp3'),
  ('Графы в интервью: BFS vs DFS vs Dijkstra', 'Graphs in interviews: BFS / DFS / Dijkstra',
   'Когда какой алгоритм выбирать и какие паттерны чаще спрашивают в Яндексе и Авито.',
   'algorithms', 2100, 'podcasts/graph-interviews.mp3'),
  ('Как работает SELECT под капотом', 'How SELECT works under the hood',
   'Parser → planner → executor. Почему EXPLAIN — ваш лучший друг.',
   'sql', 2400, 'podcasts/select-internals.mp3'),
  ('Оконные функции: LAG, LEAD и прочая магия', 'Window functions: LAG, LEAD and friends',
   'Как писать аналитические запросы лаконично и быстро, без вложенных подзапросов.',
   'sql', 1800, 'podcasts/window-functions.mp3'),
  ('Горутины, каналы и утечки: что важно знать', 'Goroutines, channels and leaks',
   'Почему в проде горутины текут, как это ловить, и почему pprof — must-have.',
   'go', 2100, 'podcasts/go-goroutines.mp3'),
  ('STAR в русской реальности', 'STAR interview, ru edition',
   'Как рассказывать о своём опыте в формате Situation-Task-Action-Result, адаптируя под российский рынок.',
   'behavioral', 1500, 'podcasts/star-ru.mp3'),
  ('Как не провалить behavioral: честные истории', 'Don''t fail behavioral: honest stories',
   'Реальные ошибки кандидатов и паттерны ответов, которые работают в Ozon и Т-Банке.',
   'behavioral', 1800, 'podcasts/behavioral-honest.mp3')
) AS v(title_ru, title_en, descr, section, dur, audio_key)
WHERE NOT EXISTS (
  SELECT 1 FROM podcasts p WHERE p.audio_key = v.audio_key
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM follow_up_questions WHERE task_id IN (SELECT id FROM tasks WHERE slug IN (
  'two-sum-transactions','valid-brackets-log','reverse-event-chain','max-subarray-revenue',
  'climbing-rating-ladder','contains-duplicate-uid','best-time-buy-sell-token','valid-palindrome-slug',
  'merge-sorted-queues','binary-search-logs','lru-session-cache','merge-incident-intervals',
  'group-anagram-tags','top-k-hottest-queries','codeword-in-grid','change-for-coin-drop',
  'count-region-islands','longest-unique-stream','rotate-ring-buffer','product-except-self-metric',
  'jump-game-matchmaker','triple-sum-partners','unique-paths-grid-release','find-duplicate-id',
  'sort-priority-flags','trapping-rain-logs','median-two-shards','n-queens-cluster',
  'word-ladder-docs','regex-match-route',
  'sql-total-revenue-by-month','sql-top-5-users-by-spend','sql-second-highest-salary',
  'sql-running-total','sql-day-over-day-diff','sql-rank-per-group','sql-cte-order-summary',
  'sql-recursive-hierarchy','sql-inner-vs-left-join','sql-window-moving-avg','sql-self-join-pairs',
  'sql-anti-join-churn','sql-pivot-by-month','sql-percentile-latency','sql-dedupe-keep-latest',
  'go-goroutine-channel-bug','go-context-cancellation','go-mutex-vs-syncmap',
  'sd-url-shortener','sd-rate-limiter'
));

DELETE FROM task_templates WHERE task_id IN (SELECT id FROM tasks WHERE slug IN (
  'two-sum-transactions','valid-brackets-log','reverse-event-chain','max-subarray-revenue',
  'climbing-rating-ladder','contains-duplicate-uid','best-time-buy-sell-token','valid-palindrome-slug',
  'merge-sorted-queues','binary-search-logs','lru-session-cache','merge-incident-intervals',
  'group-anagram-tags','top-k-hottest-queries','codeword-in-grid','change-for-coin-drop',
  'count-region-islands','longest-unique-stream','rotate-ring-buffer','product-except-self-metric',
  'jump-game-matchmaker','triple-sum-partners','unique-paths-grid-release','find-duplicate-id',
  'sort-priority-flags','trapping-rain-logs','median-two-shards','n-queens-cluster',
  'word-ladder-docs','regex-match-route',
  'sql-total-revenue-by-month','sql-top-5-users-by-spend','sql-second-highest-salary',
  'sql-running-total','sql-day-over-day-diff','sql-rank-per-group','sql-cte-order-summary',
  'sql-recursive-hierarchy','sql-inner-vs-left-join','sql-window-moving-avg','sql-self-join-pairs',
  'sql-anti-join-churn','sql-pivot-by-month','sql-percentile-latency','sql-dedupe-keep-latest',
  'go-goroutine-channel-bug','go-context-cancellation','go-mutex-vs-syncmap',
  'sd-url-shortener','sd-rate-limiter'
));

DELETE FROM test_cases WHERE task_id IN (SELECT id FROM tasks WHERE slug IN (
  'two-sum-transactions','valid-brackets-log','reverse-event-chain','max-subarray-revenue',
  'climbing-rating-ladder','contains-duplicate-uid','best-time-buy-sell-token','valid-palindrome-slug',
  'merge-sorted-queues','binary-search-logs','lru-session-cache','merge-incident-intervals',
  'group-anagram-tags','top-k-hottest-queries','codeword-in-grid','change-for-coin-drop',
  'count-region-islands','longest-unique-stream','rotate-ring-buffer','product-except-self-metric',
  'jump-game-matchmaker','triple-sum-partners','unique-paths-grid-release','find-duplicate-id',
  'sort-priority-flags','trapping-rain-logs','median-two-shards','n-queens-cluster',
  'word-ladder-docs','regex-match-route',
  'sql-total-revenue-by-month','sql-top-5-users-by-spend','sql-second-highest-salary',
  'sql-running-total','sql-day-over-day-diff','sql-rank-per-group','sql-cte-order-summary',
  'sql-recursive-hierarchy','sql-inner-vs-left-join','sql-window-moving-avg','sql-self-join-pairs',
  'sql-anti-join-churn','sql-pivot-by-month','sql-percentile-latency','sql-dedupe-keep-latest',
  'go-goroutine-channel-bug','go-context-cancellation','go-mutex-vs-syncmap',
  'sd-url-shortener','sd-rate-limiter'
));

DELETE FROM tasks WHERE slug IN (
  'two-sum-transactions','valid-brackets-log','reverse-event-chain','max-subarray-revenue',
  'climbing-rating-ladder','contains-duplicate-uid','best-time-buy-sell-token','valid-palindrome-slug',
  'merge-sorted-queues','binary-search-logs','lru-session-cache','merge-incident-intervals',
  'group-anagram-tags','top-k-hottest-queries','codeword-in-grid','change-for-coin-drop',
  'count-region-islands','longest-unique-stream','rotate-ring-buffer','product-except-self-metric',
  'jump-game-matchmaker','triple-sum-partners','unique-paths-grid-release','find-duplicate-id',
  'sort-priority-flags','trapping-rain-logs','median-two-shards','n-queens-cluster',
  'word-ladder-docs','regex-match-route',
  'sql-total-revenue-by-month','sql-top-5-users-by-spend','sql-second-highest-salary',
  'sql-running-total','sql-day-over-day-diff','sql-rank-per-group','sql-cte-order-summary',
  'sql-recursive-hierarchy','sql-inner-vs-left-join','sql-window-moving-avg','sql-self-join-pairs',
  'sql-anti-join-churn','sql-pivot-by-month','sql-percentile-latency','sql-dedupe-keep-latest',
  'go-goroutine-channel-bug','go-context-cancellation','go-mutex-vs-syncmap',
  'sd-url-shortener','sd-rate-limiter'
);

DELETE FROM podcasts WHERE audio_key IN (
  'podcasts/consistent-hashing.mp3','podcasts/cap-theorem.mp3','podcasts/rate-limiter.mp3',
  'podcasts/event-sourcing.mp3','podcasts/big-o.mp3','podcasts/dp-basics.mp3',
  'podcasts/graph-interviews.mp3','podcasts/select-internals.mp3','podcasts/window-functions.mp3',
  'podcasts/go-goroutines.mp3','podcasts/star-ru.mp3','podcasts/behavioral-honest.mp3'
);

DELETE FROM companies WHERE slug IN ('avito','vk','t-bank','ozon','yandex');

-- +goose StatementEnd
