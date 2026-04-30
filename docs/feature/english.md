# English-трек

## Позиционирование

**Не Duolingo.** Не учим с нуля, не делаем drill-vocabulary.

**Не Skyeng.** Не школа, не делаем lessons, не нанимаем тутров.

**druz9 — operating system между студентом и его тутором.** Тутор учит. Мы держим loop практики между занятиями: чтение → конспект → AI-фидбэк → spaced repetition → следующая сессия с тутором с pre-brief.

Этот слот пуст в РФ-рынке. Никто не занимает.

## Ключевое правило

**Пользователь приносит свой материал.** Свой контент не делаем — это бездонная яма, которая тянет нас в курсы.

- Книги (PDF / EPUB / web-articles) — пользователь сам.
- Подкасты — пользователь сам (или из druz9 podcasts на английском).
- Темы для writing — пользователь / его тутор.

## Структура продукта

### Web (druz9.online)

**English-ветвь в Atlas** — отдельный layer Skill Atlas:

```
English (root)
├── Reading
│   ├── Fiction (general vocab)
│   ├── Tech literature
│   └── News / journalism
├── Listening
│   ├── Podcasts (slow / native pace)
│   ├── Tech talks
│   └── Conversations
├── Writing
│   ├── Summaries
│   ├── Tech writing
│   └── Casual / email
└── Speaking
    ├── Self-recording
    ├── Mock interviews (HR-round)
    └── Tutor sessions (logged via tutor-app)
```

Auto-update от практики в Hone — каждая Reading/Writing/Listening сессия инкрементит соответствующий sub-skill.

**English mock-round** — расширение существующего `services/ai_mock`:
- Новая persona: AI-собеседующий ведёт HR-этап на английском.
- Rubric: clarity, accuracy, range, fluency.
- Watermark `ai_assist=true|false` работает как в обычном mock.
- Reuse 95% существующей инфры (mock pipeline + LLM chain + Insights).

**Tutor-handoff PDF** (см [tutor.md](./tutor.md) Tier 1):
- За час до тутор-сессии — генерится PDF: «Маша, неделя X. Прогресс: ... Weak spots: ... AI-coach спрашивала про Y 4 раза».
- Тутор готовится за 5 минут вместо 30.

### Hone — главное место

English-loop живёт здесь, потому что Hone — daily-companion.

#### Reading-модуль (новый, hotkey `R`)

Ключевая механика:

1. **Upload контента**: drag-drop PDF/EPUB или paste URL (через `services/documents` — уже есть extractor).
2. **Pin chapter** — Hone разбивает на 10-минутные сессии (по словам).
3. **Reading-сессия** — text full-screen, чёрный фон, моноширинная для номера страницы.
4. **Click-on-word**:
   - Незнакомое слово → перевод + контекст-фраза → в SRS-очередь.
   - Незнакомая фраза/идиома → в Notes с тегом `#vocab`.
5. **AI summary check**: после главы Hone promptит «напиши, что понял» (200-300 слов в Writing-сессии). LLM сравнивает с реальным содержанием, флагает gaps. **Это ключевая механика вместо drill-vocab** — заставляет think in English, не translate.

#### Writing-as-Focus (расширение существующего)

- Новый тип focus-сессии: «English Writing 25 min».
- Темы:
  - Auto-generated из reading-материала («summary главы 4»).
  - От тутора (push через tutor-dashboard).
  - User-defined.
- После сессии — AI-coach даёт inline-фидбэк:
  - Грамматика (diff-style правки).
  - Vocab range (suggestion: «вместо `good` → `compelling/sound/well-grounded`»).
  - Sentence variety (warning: «5 предложений подряд начинаются с "I"»).
- Сохраняется в Notes с тегом `#english/writing`.

#### Listening (расширение Podcasts)

Подкасты в Hone уже есть. Layer сверху для English-content:

- Транскрипт (Groq Whisper turbo) — синхронный с воспроизведением.
- Click-on-word в транскрипте → vocab queue.
- Speed: 0.75x / 1x / 1.25x.
- Mark replay — за 5s назад, можно пометить «не понял» — попадает в weekly review.

#### SRS — spaced-repetition queue (новый)

- 5-минутный daily review встроенный в Hone (не Anki).
- Очередь формируется из: reading-кликов + listening-кликов + tutor-introduced слов.
- Алгоритм: упрощённый SM-2 (4-tier: again / hard / good / easy).
- Не Anki-feature-rich — минимальный, под 5 минут утром.

#### Daily-loop в Today

В Today plan каждый день должен быть один English-блок:

```
Today · 2026-05-13
─────────────────────
□ DSA: Two Pointers technique             [from Atlas-weak-spot]
□ English Reading: Chapter 4 (12 min)     [from tutor: Maria]
□ English SRS: 8 cards (3 min)            [auto]
□ Focus session: refactor auth-handler    [from yourself]
```

AI-планер уже умеет эту структуру — добавляем English-задачи как новый тип pin'ов.

### Cue (вторичная роль, точечно)

**English mode** — Cue включает наушник на английский:

- В IDE / email / Slack / Notion — Cue видит экран, подсвечивает «more native phrasing here». Не делает за тебя — **показывает альтернативы**.
- На видео-звонке — auto-suggest pills, calibrated на «как сказать это правильно». Reuse существующего `services/copilot/app/suggest`.
- Mock-block протокол работает: если идёт strict English-mock (через `services/ai_mock` с `ai_assist=false`) — Cue блокируется.

Cue — приятная добавка, но не критичный модуль для English-loop. MVP без Cue работает.

## Что не делаем (хард-режем)

- ❌ Drill-vocab геймификация / streak «ты выучил 7 слов»
- ❌ Lesson plans / курсы / «учи с нуля»
- ❌ Speech-recognition оценка произношения (бездонная яма, оставляем тутору)
- ❌ Свой контент (тексты, упражнения, диалоги)
- ❌ Tests / quizzes — это Skyeng-режим
- ❌ Леaderboard'ы по английскому

## Tradeoff

| За | Против |
|---|---|
| Уникальная позиция в РФ-рынке | Аудитория уже, чем dev (но overlap огромный — у каждого dev'а есть тутор) |
| Reuse 80% существующей инфры (Atlas, Insights, podcasts, services/documents, ai_mock, llmchain) | Reading-модуль и SRS — новый код в Hone |
| Идеально дополняет dev-трек: «Senior dev + English» — классическая платная комбинация | Может размыть фокус «product for developers» если плохо позиционировать |
| Открывает tutor-channel (см [tutor.md](./tutor.md)) | Зависимость от tutor-availability у пользователя — не у всех есть тутор |

## Метрики

- **Weekly English-time per active English-user** (Reading + Writing + Listening + SRS, в минутах).
- **AI summary check accuracy** — правильно ли студент понял главу. Прокси для comprehension growth.
- **Vocab queue retention** — % слов выученных через 14 дней.
- **English mock score delta** между неделями.
- **Tutor-driven assignments completion rate** — % домашек, выполненных вовремя.

## Срок

| Этап | Что | Эффорт |
|---|---|---|
| MVP-1 | English mock-round (расширение `services/ai_mock`) | 2 нед | ✅ закрыто (Wave 1) |
| MVP-2 | English Atlas seed + onboarding-фичка | 1 нед | ✅ закрыто (Wave 0/1) |
| MVP-3 | Reading-модуль в Hone (hotkey R, click-on-word, SRS-queue) | 4-6 нед | ✅ MVP закрыт — backend (migration + domain + infra + 9 use cases + 7 unit-тестов + 9 RPC + REST aliases `/hone/reading/*`) + Hone frontend (`pages/Reading.tsx` + `api/reading.ts` + palette R + hotkey R; library + reader + click-on-word vocab popover + add-material form + SRS daily widget) |
| MVP-4 | Writing-as-Focus + AI feedback | 2 нед | ✅ MVP закрыт — backend (Task=`hone_writing_feedback` + `WritingGrader` port + LLM adapter с JSON-envelope sanitisation + `GradeEnglishWriting` use case, 5 unit-тестов) + Hone `pages/Writing.tsx` (palette W + hotkey W; draft surface → AI feedback panel с overall score + per-issue rows + Apply-fix one-click + Save-to-Notes). Persistence отсутствует by design |
| MVP-5 | SRS daily review | 2 нед | partial ✅ — `hone_vocab_queue` + Leitner-SRS algorithm (4h/1d/3d/7d/16d intervals, graduated at box 5); ⏳ Hone UI |
| MVP-6 | Listening transcript + click-on-word поверх существующих podcasts | 2 нед | ⏳ |
| MVP-7 | Tutor-handoff PDF (см [tutor.md](./tutor.md)) | 1 нед | ⏳ (snapshot/brief backend готов в Wave 2) |
| Long | Cue English mode | парковка, 4 нед когда тема созреет | ⏳ |

**Итого MVP-1..7: ~14-18 недель = 3.5-4.5 месяца** для одного разработчика без part-time экспертов.

## Связь с tutor-интеграцией

Tutor-flow ([tutor.md](./tutor.md)) и English-flow — **разные документы, но одна инициатива**. Tutor приводит студентов в English-loop. English-loop удерживает студентов после смены тутора.

Запускать параллельно: Tier 1 tutor-dashboard (3 нед) + English-mock + Atlas seed (3 нед) — это 6 недель работы, после которых уже есть end-to-end story для design-partners.
