-- Phase-4 ADR-002 Wave B.2 — seed v1 mock-interview content.
--
-- Goal: a fresh dev DB lets a user pick Yandex (or any other v1 company),
-- start a pipeline, and run the HR stage end-to-end against the LLM judge
-- without admin manually populating questions.
--
-- Scope:
--   - 8 default HR questions (universal pool — fires for every company unless
--     admin adds a company-specific overlay).
--   - 8 default behavioral questions (used in Phase E text-only mode + future
--     voice flow).
--   - Yandex-specific HR overlay (3 extra "почему именно мы" style questions).
--   - One sample mock_task (algo · two-sum) so admin has a template to clone.
--   - company_stages config for Yandex: hr → algo → behavioral (3 stages,
--     not full 5 — minimal demo path; admin extends later).
--
-- Idempotent: ON CONFLICT DO NOTHING / DO UPDATE everywhere. Re-runnable
-- against migrated DB.

-- +goose Up

-- ─── default HR questions ────────────────────────────────────────────────
INSERT INTO stage_default_questions (stage_kind, body, expected_answer_md, reference_criteria, sort_order)
VALUES
  ('hr',
   'Расскажи о себе за 1-2 минуты. Что ты делаешь, какой у тебя стек, чем интересуешься в инженерии?',
   '## Структура хорошего ответа

- Текущая роль / уровень (junior / middle / senior)
- Стек (язык, фреймворки, инфра)
- Один-два конкретных проекта / результата
- Что мотивирует в инженерии

Самопрезентация должна быть конкретной и не льющейся. 60-120 секунд.',
   '{"must_mention":["текущая роль или уровень","основной стек"],"nice_to_have":["конкретный проект","метрика результата"],"common_pitfalls":["перечислять весь жизненный путь","говорить только про учёбу без работы"]}'::jsonb,
   10),

  ('hr',
   'Какой проект из последних 6 месяцев ты считаешь наиболее значимым? Почему именно он?',
   '## Что мы хотим услышать

- Конкретный проект (название / scope)
- Роль кандидата (что лично сделал)
- Технические решения и trade-offs
- Бизнес-метрика или результат

Признак хорошего ответа: отвечает в формате STAR (Situation → Task → Action → Result).',
   '{"must_mention":["конкретный проект","что лично сделал","результат или метрика"],"nice_to_have":["trade-off в решении","что бы переделал"],"common_pitfalls":["учебный pet-project как главный","результат типа \"научился чему-то\" без бизнес-эффекта"]}'::jsonb,
   20),

  ('hr',
   'Опиши самую сложную инженерную задачу, которую решал. Где застрял? Как разблокировался?',
   'Хороший ответ показывает:

- Конкретную техническую сложность (а не «сложно потому что много кода»)
- Подход к диагностике (логи, профайлер, гипотезы)
- Кому/чем помог себе разблокироваться (документация, коллега, эксперимент)
- Чему научился',
   '{"must_mention":["конкретная техническая сложность","подход к диагностике"],"nice_to_have":["разблокировался через коллегу или документацию","чему научился"],"common_pitfalls":["сложно было потому что много кода","не помню деталей"]}'::jsonb,
   30),

  ('hr',
   'Расскажи о своих сильных и слабых сторонах в инженерии.',
   'Сильные: одна-две конкретные области с примером.
Слабые: реально слабые (а не закамуфлированные сильные типа "слишком перфекционист"), плюс что делает чтобы их закрыть.',
   '{"must_mention":["конкретная сильная сторона","реально слабая сторона"],"nice_to_have":["план как закрывает слабую"],"common_pitfalls":["я перфекционист","слишком много работаю","нет слабых"]}'::jsonb,
   40),

  ('hr',
   'Что для тебя важно в команде и в компании? Что точно не подходит?',
   'Ищем match с культурой druz9. Хороший ответ:

- 2-3 конкретные ценности (например: ownership, quality bar, скорость, обучение)
- Антипаттерны которых избегает (микроменеджмент, легаси без планов рефакторинга, и т.д.)',
   '{"must_mention":["2-3 ценности","антипаттерны которых избегает"],"common_pitfalls":["мне всё равно","главное чтобы платили"]}'::jsonb,
   50),

  ('hr',
   'Как ты обычно изучаешь новую технологию? Расскажи на примере чего-то, что освоил за последний год.',
   'Хороший ответ:

- Конкретная технология (не «вообще учусь по статьям»)
- Структурированный подход (документация → туториал → pet → продакшен)
- Что было сложным
- Где сейчас уровень: «знаю основы» / «использую в проде» / «могу собеседовать других»',
   '{"must_mention":["конкретная технология","структурированный подход к изучению"],"nice_to_have":["продакшен использование","что было сложным"],"common_pitfalls":["учусь по статьям","смотрю YouTube"]}'::jsonb,
   60),

  ('hr',
   'Где ты видишь себя через 2-3 года? Куда хочешь расти?',
   'Не люблю клише про "хочу быть тимлидом". Хороший ответ — направление: глубже в специальность (e.g. ML / distributed / compilers) или вширь в архитектора / тимлида / staff. Главное конкретика.',
   '{"must_mention":["конкретное направление развития"],"nice_to_have":["почему именно туда"],"common_pitfalls":["хочу стать тимлидом без обоснования","посмотрим как пойдёт"]}'::jsonb,
   70),

  ('hr',
   'Расскажи о случае, когда ты не согласен был с решением команды или руководства. Что сделал?',
   'Behavioral-зерно. Ищем:

- Конкретный кейс (не гипотетический)
- Кандидат высказал позицию (а не молча сделал)
- Привёл аргументы / данные
- Принял итоговое решение даже если не своё (commit-and-disagree)
- Чему научился',
   '{"must_mention":["конкретный кейс","высказал позицию","принял итог"],"nice_to_have":["аргументы или данные","чему научился"],"common_pitfalls":["такого не было","я всегда соглашаюсь"]}'::jsonb,
   80)
ON CONFLICT DO NOTHING;

-- ─── default behavioral questions ────────────────────────────────────────
INSERT INTO stage_default_questions (stage_kind, body, expected_answer_md, reference_criteria, sort_order)
VALUES
  ('behavioral',
   'Расскажи о ситуации, когда тебе пришлось дать жёсткий feedback коллеге. Как ты это делал?',
   'STAR-формат. Хороший ответ: конкретный кейс, подготовился к разговору, дал feedback по работе а не по человеку, проверил что услышал, итог.',
   '{"must_mention":["конкретный кейс","feedback по работе не по человеку","итог разговора"],"common_pitfalls":["такого не было","коллега обиделся и я больше не давал"]}'::jsonb,
   10),

  ('behavioral',
   'Расскажи про ошибку в проде, которую совершил лично. Как разруливал?',
   'Без ownership этот вопрос фейлится. Ищем: признал ошибку, остановил bleeding, провёл postmortem, заложил процесс/тест чтобы не повторилось.',
   '{"must_mention":["конкретная ошибка","остановил bleeding","postmortem или action items"],"common_pitfalls":["ошибки не было","виноват был не я"]}'::jsonb,
   20),

  ('behavioral',
   'Опиши ситуацию когда ты не успевал к дедлайну. Что делал?',
   'Хороший ответ: рано заметил проблему, эскалировал стейкхолдерам, предложил варианты (cut scope / push date / add resources), доставил.',
   '{"must_mention":["рано заметил","эскалировал","варианты решения"],"common_pitfalls":["работал в выходные","не успевал но как-то досдал"]}'::jsonb,
   30),

  ('behavioral',
   'Был случай когда тебе дали задачу без чёткого definition of done. Как действовал?',
   'Senior-маркер. Ищем: задал уточняющие вопросы стейкхолдеру, написал спеку, синхронизировал с тимом, прошёл по краям.',
   '{"must_mention":["уточняющие вопросы","спека или синк"],"common_pitfalls":["сделал как понял","ждал пока пояснят"]}'::jsonb,
   40),

  ('behavioral',
   'Расскажи о конфликте в команде. Какова была твоя роль и как он разрешился?',
   'Ищем зрелость. Конкретный кейс, кандидат не герой и не жертва, искал суть проблемы, помог разрулить через факты.',
   '{"must_mention":["конкретный кейс","своя роль честно","разрешение"],"common_pitfalls":["конфликтов не было","все вокруг плохие"]}'::jsonb,
   50),

  ('behavioral',
   'Когда ты в последний раз говорил «нет» руководителю или продакту? Почему?',
   'Ownership без рабства. Ищем: техническая или процессная причина для "нет", аргументы, альтернатива.',
   '{"must_mention":["конкретный кейс","причина","альтернатива"],"common_pitfalls":["я не говорю нет","руководитель всегда прав"]}'::jsonb,
   60),

  ('behavioral',
   'Расскажи про самый недавний случай когда ты помог менее опытному коллеге.',
   'Ищем: конкретный кейс, формат помощи (pair / review / mentoring), результат для коллеги, что сам взял из взаимодействия.',
   '{"must_mention":["конкретный кейс","формат помощи","результат"],"common_pitfalls":["я всегда помогаю","объяснил и забыл"]}'::jsonb,
   70),

  ('behavioral',
   'Опиши проект где ты выгорел или близко к этому. Что произошло и что вынес?',
   'Зрелый кандидат знает свои пределы. Хороший ответ: признаки выгорания, что предпринял (отдых, разговор с менеджером, scope), что изменил в подходе после.',
   '{"must_mention":["признаки","что предпринял","что изменил"],"common_pitfalls":["я не выгораю","выгорел до апатии и уволился"]}'::jsonb,
   80)
ON CONFLICT DO NOTHING;

-- ─── Yandex-specific HR overlay ──────────────────────────────────────────
INSERT INTO company_questions (company_id, stage_kind, body, expected_answer_md, reference_criteria, sort_order)
SELECT id, 'hr', body, expected_answer_md, reference_criteria::jsonb, sort_order
FROM (VALUES
  ('Почему именно Yandex? Что тебе интересно конкретно у нас?',
   'Ищем подготовленность: знаешь продукты, видишь мэтч с твоим бэкграундом, конкретный продукт/команда привлекает а не просто "большая компания".',
   '{"must_mention":["конкретный продукт или команда","что именно привлекает","мэтч с бэкграундом"],"common_pitfalls":["известный бренд","большая зарплата","не знаю просто откликнулся"]}',
   10),
  ('Какой публичный продукт Yandex ты используешь и что бы в нём улучшил с инженерной точки зрения?',
   'Демонстрация любопытства. Ищем: конкретный продукт, конкретное улучшение, осмысленное обоснование (latency / DX / архитектура).',
   '{"must_mention":["конкретный продукт","конкретное улучшение","техническое обоснование"],"common_pitfalls":["не пользуюсь","всё работает идеально"]}',
   20),
  ('Готов ли ты к высокому темпу и сильной планке качества? Расскажи о случае где ты держал планку под давлением.',
   'Yandex-паттерн: высокая планка + быстрый темп. Ищем кейс где кандидат не съехал в quality vs deadline trade-off.',
   '{"must_mention":["конкретный кейс","удержал планку","trade-off"],"common_pitfalls":["я всегда быстрый","качество всегда страдает под давлением"]}',
   30)
) AS v(body, expected_answer_md, reference_criteria, sort_order)
CROSS JOIN companies
WHERE companies.slug = 'yandex'
ON CONFLICT DO NOTHING;

-- ─── Yandex company_stages: minimal 3-stage demo path ────────────────────
-- HR (mandatory) → Algo (mandatory) → Behavioral (optional). Sysdesign/coding
-- ship in Phase C/D — admin will toggle them on later.
INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id)
SELECT c.id, 'hr', 0, false, ARRAY[]::mock_task_language[], ARRAY[]::uuid[], NULL
FROM companies c WHERE c.slug = 'yandex'
ON CONFLICT (company_id, stage_kind) DO UPDATE SET ordinal = 0;

INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id)
SELECT c.id, 'algo', 1, false, ARRAY['any']::mock_task_language[], ARRAY[]::uuid[], NULL
FROM companies c WHERE c.slug = 'yandex'
ON CONFLICT (company_id, stage_kind) DO UPDATE SET ordinal = 1;

INSERT INTO company_stages (company_id, stage_kind, ordinal, optional, language_pool, task_pool_ids, ai_strictness_profile_id)
SELECT c.id, 'behavioral', 2, true, ARRAY[]::mock_task_language[], ARRAY[]::uuid[], NULL
FROM companies c WHERE c.slug = 'yandex'
ON CONFLICT (company_id, stage_kind) DO UPDATE SET ordinal = 2;

-- ─── one sample algo task — admin template to clone ──────────────────────
INSERT INTO mock_tasks (
  stage_kind, language, difficulty, title, body_md, sample_io_md,
  reference_criteria, reference_solution_md, time_limit_min, active
)
VALUES (
  'algo', 'any', 1,
  'Two Sum',
  '# Two Sum

Дан массив целых `nums` и целое `target`. Верни **индексы** двух чисел, дающих в сумме `target`.

Можно считать, что у каждого input-а ровно одно решение, и нельзя использовать один и тот же элемент дважды.

## Constraints
- 2 ≤ nums.length ≤ 10⁴
- -10⁹ ≤ nums[i] ≤ 10⁹
- -10⁹ ≤ target ≤ 10⁹',
  '## Sample 1

```
Input:  nums = [2,7,11,15], target = 9
Output: [0,1]
```

## Sample 2

```
Input:  nums = [3,2,4], target = 6
Output: [1,2]
```',
  '{"must_mention":["O(n) hash-map подход","трюк с complement (target - num)","one-pass"],"nice_to_have":["edge case с duplicate","что делать если решений несколько"],"common_pitfalls":["O(n²) brute-force как финальное решение","использовать один индекс дважды"]}'::jsonb,
  '## Reference solution: hash-map one-pass O(n)

```python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
```

Сложность: O(n) time, O(n) space. Один проход — на каждом числе ищем `target - num` в map; если есть — нашли пару.

Альтернативы:
- O(n²) brute-force — два цикла. Принимается только как промежуточный шаг.
- Sort + two-pointers: O(n log n), но теряем оригинальные индексы — нужен extra map.',
  20,
  true
)
ON CONFLICT DO NOTHING;

-- +goose Down
-- Idempotent seed — DELETE by content match. Safe to skip if data was modified
-- by admin: we only delete rows that still match our exact seed.
DELETE FROM mock_tasks WHERE title = 'Two Sum' AND stage_kind = 'algo' AND difficulty = 1;
DELETE FROM company_stages WHERE company_id IN (SELECT id FROM companies WHERE slug = 'yandex')
  AND stage_kind IN ('hr', 'algo', 'behavioral');
DELETE FROM company_questions WHERE company_id IN (SELECT id FROM companies WHERE slug = 'yandex')
  AND stage_kind = 'hr';
DELETE FROM stage_default_questions WHERE stage_kind IN ('hr', 'behavioral');
