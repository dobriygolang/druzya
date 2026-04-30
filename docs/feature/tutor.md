# Tutor-интеграция

## Главная мысль

**Тутор — не платёжеспособный сегмент. Тутор — distribution channel.**

Приводит платёжеспособных студентов в экосистему. Удерживает их там через инструмент. После смены тутора студенты остаются, новые тутры приходят за этими студентами.

Это **двусторонний рынок** с network effect — самый мощный моат, какой можно построить. Copy-cat не страшен, потому что нет critical mass пользователей у конкурента.

## Конкурентный контекст

Сейчас индивидуальный тутор:
- Ищет студентов через Skyeng / Profi.ru / Buki — отдают **30-50%** выручки.
- Ведёт прогресс в Excel / Notion / памяти.
- Шлёт домашки в WhatsApp.
- Биллинг — СБП-перевод вручную.
- Group-classes — Zoom + Notion + Telegram-чат.

druz9 даёт тулзы за **10-15%** (или free, Tier 1). Тутор уходит из Skyeng со своими студентами.

## Что делаем для English тутров (первая версия)

**Только для English-тутров в первой версии.** Не для dev-mentoring, не для математики, не для всего сразу. Когда English-flow заработает — те же механики копипастятся на Maths-tutor, Python-tutor, IELTS-coach. Это горизонтальный expand без переписывания продукта.

## 5 tier'ов интеграции

### Tier 1 — Free (acquisition magnet)

**Tutor-dashboard на druz9.online/tutor:**

- **Список студентов** (приходят через invite-ссылку: `druz9.online/invite/<code>`).
- **Per-student snapshot:**
  - Heatmap «что делал эту неделю» (минуты Reading / Writing / Listening / SRS).
  - Vocab queue размер (сколько новых слов в SRS).
  - Weak spots из Skill Atlas (auto-update от практики).
  - Recent struggles — что AI-coach спрашивал часто (приватно — не «Маша спросила про X», а «вокруг conditionals было 4 вопроса»).
- **Pre-session brief** — за час до занятия Hone/web/TG генерит 1-страничный summary:
  > «Маша, неделя 12. Прогресс: 4 главы прочитано, +18 слов в SRS, 2 writing-сессии. Weak spots: present perfect (3 ошибки в writing), vocab вокруг finance. Вопросы к AI: conditionals × 4. Suggest: revisit conditionals в начале занятия».

Тутор готовится за 5 минут вместо 30. Этого одного достаточно, чтобы тутор привёл 5 студентов.

**Эффорт:** 3 недели.

#### Текущий статус (2026-04-30)

✅ **Foundation готов** (Wave 2.1–2.4a в [plan.md](./plan.md)):

- Backend `services/tutor/` end-to-end: invite create/list/revoke + accept (атомарно, через FOR UPDATE и partial unique idx) + list students + end relationship.
- 7 RPC endpoints под `/api/v1/tutor/*` через Connect-RPC + REST transcoder. PeekInvite публичный (для landing'а до student auth).
- DB: `tutor_invites` + `tutor_students` с TTL 30 дней на инвайт и multi-tutor support по schema (one student → many tutors over time).
- Authorization: tutor ID берётся из bearer-токена; нет отдельной `users.role='tutor'` — любой пользователь может создать invite, статус «тутор» — функция, не роль.
- Code generator: 8-char alphabet без 0/O/1/I/L (читается с экрана), entropy ~40 бит.

⏳ **Осталось до полного Tier 1:**

- 2.4b — Per-student snapshot aggregator. ✅ **Закрыто** — 4 SQL агрегации (focus / English HR mocks / Atlas weak-spots / notes), auth-gate `EnsureRelationship` БЕФОР snapshot fetch (cross-user leak protection), proto + RPC `GetStudentSnapshot`.
- 2.5 — `TaskTutorPreSessionBrief`. ✅ **Закрыто end-to-end** — LLM task + model map + use case + **wirer в `cmd/monolith/services/tutor/briefer.go`**: Russian markdown ≤250 слов, anti-hallucination prompt (numbers-only, no PII, no smileys), graceful chain-nil / chain-failure handling. Бутстрап подключает через `tutorServices.NewBriefer(deps.LLMChain, ...)`.
- 2.7 — Invite landing `/invite/{code}`. ✅ **Закрыто** — public PeekInvite-driven page, status-aware CTA (login → accept), redirect в `/onboarding/tracks?source=invite` после accept.
- 2.6 — Frontend `/tutor` dashboard (4 дня) — единственное оставшееся в Tier 1.

### Tier 2 — Pro (assignments push в Hone)

**Tutor пушит домашку прямо в Hone Today:**

- Из dashboard'а: «Маша, на завтра: глава 4 из Atomic Habits + 200-словный summary + 12-min подкаст».
- У студента в Hone Today появляются пункты с тегом `📖 from tutor: Maria`.
- AI-coach в Hone помогает выполнять (Reading-сессия / Writing-сессия / Listening из [english.md](./english.md)).
- Тутор в реальном времени видит прогресс — статус каждой задачи.

Это превращает Hone из «студент сам себе» в **«студент + тутор используют один тул»**. Студент не уйдёт с druz9, потому что уйдёт от тутора. Тутор не уйдёт, потому что инструмент удобный.

**Эффорт:** 3 недели после Tier 1.

### Tier 3 — Group-classes через circles

Reuse существующего `services/circles` + `services/events`.

- **Tutor-led circle** — приватный circle с capacity 5-10. Тутор = owner.
- **Расписание занятий** = events внутри circle (уже есть в Hone hotkey `V`).
- **На занятии:**
  - Editor rooms (Yjs, есть) — совместный код / упражнения.
  - Shared whiteboard (Yjs, есть) — объяснения тутора.
- **После занятия** — group-homework через Tier 2 flow с broadcast.
- **Group-stats для тутора** + анонимизированный класс-leaderboard для студентов (опц.).

Один тутор → 3 группы × 8 студентов = 24 студента в одном инструменте без Zoom/Notion/WhatsApp.

**Эффорт:** 4 недели после Tier 2.

### Tier 4 — TG-bot для тутора

`services/tg_coach` уже есть. Расширяем для тутора:

```
/students        — список с краткими статусами
/today           — кто сегодня запинговал «застрял»
/prepare @user   — pre-session brief в чат
/assign @user "..." — пуш задачи в Hone Today
/circle @group  — broadcast в group circle
/checkin @user  — спросить «как дела» (студент получает в TG личку)
```

Тутор хочет минимум контекст-свитчей. Если 80% операций можно делать из TG — он остаётся.

**Эффорт:** 2 недели, можно делать **параллельно** с Tier 1-2.

### Tier 5 — Marketplace + биллинг (Year 2)

**Не делать сейчас.** Финальный layer:

- Публичный профиль тутора в каталоге druz9.
- Бронь через `services/slot/` (уже есть для mock-интервьюеров — **переиспользуем**).
- Биллинг через ЮKassa: druz9 берёт **10-15%** vs 30-50% Skyeng.
- Тутор приводит свою аудиторию → она остаётся в экосистеме при смене тутора → новый тутор находит её через маркетплейс.

**Эффорт:** ~3 месяца. Year 2.

## Монетизация (со стороны тутора)

| Tier | Кому | Что включено | Цена |
|---|---|---|---|
| Free | Тутор-новичок | Dashboard + 3 студента | 0 ₽ |
| Pro Tutor | Активный тутор | Dashboard + 10 студентов + assignments + TG-bot | 990 ₽/мес (тот же druz9 Pro в «teach» ветке) |
| Pro Tutor+ | Серьёзный тутор | + group classes до 30 студентов + marketplace + биллинг | 2-3к ₽/мес ИЛИ 10-15% от транзакций |

Free-tier важен — без него тутор не попробует. CAC через тутора ≈ 0.

## Студенческая сторона

Каждый студент тутора получает:
- Free Hone (focus / notes / stats без AI).
- **AI-планер unlock'нут**, потому что студент тутора. Это free-perk через invite-link — мощный мотив принять приглашение.
- Месяц free-Pro full-access. После месяца — 990₽/мес самостоятельно (это уже зарабатывает druz9).

## Privacy / data ownership

Студент должен ясно видеть:
- Какие данные шарятся с тутором (heatmap, weak spots, vocab queue).
- Какие НЕ шарятся (Notes content, full Atlas, Mock-сессии без английского).
- Возможность отключить sharing в любой момент.

Тутор не имеет доступа к:
- Содержимому Notes (только метаданные — кол-во, теги).
- Mock-сессиям не-English треков.
- Личным focus-сессиям без English-тега.

## Sequencing (важно)

**Не делать Tier 3-5 раньше Tier 1-2.** Сначала proof что dashboard и assignments работают и реально нужны 5-10 design-partner тутрам. Без этого Tier 3+ — overengineering.

## Tradeoff

| За | Против |
|---|---|
| CAC ≈ 0 (тутор приводит студентов) | Усложнение продукта, ещё одна персона |
| Retention бетонный (студент уйдёт с тутором, но останется в инструменте) | Нужен build-out tutor-side UX |
| Network effect / двусторонний рынок | Может размыть фокус если делать параллельно с senior треком |
| Новый revenue стрим (transaction fee, Year 2) | Ответственность за биллинг |
| Reuse 70% инфры (circles, events, slot, editor rooms, tg_coach) | — |

## Метрики

- **Active tutors** (≥3 студента, ≥1 assignment в неделю).
- **Students per tutor** (распределение).
- **Assignment completion rate** (% выполненных в срок).
- **Tutor-driven student retention** vs self-acquired student retention.
- **Tutor → Pro conversion** (когда упирается в free-tier лимиты).
- **Marketplace revenue** (Year 2).

## Pre-condition: design partners

**Перед началом Tier 1 нужно подтвердить что 5+ тутров готовы быть design-partners.**

Без этого Tier 1 — продукт без пользователей. Можно делать Hone-side English-loop без них (студенты сами зальют контент), но Tier 1 без тутров = пустой dashboard.

**Действие** (тебе руками):
1. Найти 5-10 знакомых English-тутров.
2. 30-минутное интервью каждый: реально ли болят описанные проблемы, готовы ли тестить, какой их workflow сейчас.
3. Если ≥5 готовы — стартуем Tier 1. Если <3 — паркуем до пилота с одним тутором.

## Срок суммарно

| Что | Эффорт | Когда |
|---|---|---|
| Design partner интервью | 1-2 нед | до начала разработки |
| Tier 1 — dashboard + invite-flow + pre-session brief | 3 нед | после интервью |
| Tier 4 — TG-bot tutor commands | 2 нед | параллельно с Tier 1 |
| Tier 2 — assignments push | 3 нед | после Tier 1 |
| Tier 3 — group circles | 4 нед | после Tier 2 |
| Tier 5 — marketplace | ~3 мес | Year 2 |

**Итого Tier 1-4: ~10 недель** = 2.5 месяца параллельно с English-Hone-loop.
