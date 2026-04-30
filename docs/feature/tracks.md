# Расширение треков

## Стратегический контекст

Текущая ниша: middle/senior разработчики РФ, готовятся к собесу. ~500к человек.

**Расширение должно быть осмысленным.** Cluely-trap = смерть. Linear 5 лет был engineering-only. На стадии 0-3к платящих — фокус важнее TAM.

Решение: расширяемся в **adjacent senior dev tracks** + **switcher tracks** (Sysanalyst, Product analyst). English как отдельный тематический трек — см [english.md](./english.md).

## Onboarding-развилка

На onboarding'е спрашиваем «кто ты»:

```
Кем ты сейчас работаешь / на кого учишься?
○ Backend разработчик (Junior / Middle / Senior / Lead)
○ Frontend разработчик
○ Mobile разработчик (iOS / Android)
○ Системный аналитик
○ Продуктовый аналитик / Product manager
○ QA / тестировщик
○ Студент / переключаюсь в IT

Чему хочешь учиться? (можно несколько)
☐ Готовлюсь к собесу на текущую роль
☐ Расту до senior / lead
☐ Переключаюсь в другую роль (укажи)
☐ Английский (HR / tech / fluency)
☐ System Design / Architecture
☐ Тех-management (Tech Lead / EM)
```

Result: **multi-track Skill Atlas** — пользователь может держать несколько треков параллельно. Самая частая комбинация: «Senior dev + English» — двойной мотив для Pro.

## Senior-треки внутри dev (приоритет 1)

**Ты сам senior разработчик** — это самый низкий риск. Запускается за 1 месяц без экспертов.

### System Design depth

Расширение существующего mock-flow (`services/ai_mock` уже умеет System Design этап).

**Контент-источники** (публичные, можно ссылаться):
- Donne Martin's System Design Primer
- Alex Xu — «System Design Interview vol 1+2»
- Pragmatic Engineer (Gergely Orosz) — case studies
- Engineering blogs: Uber, Netflix, Stripe, Cloudflare

**15-20 кейсов в первой партии:**
- Design URL shortener
- Design rate limiter
- Design distributed cache
- Design ML-feature store
- Design event-sourcing for analytics
- Design real-time chat
- ... (ещё 10-15)

**LLM-критика** — `TaskSysDesignCritique` уже есть, используется в Hone whiteboard. Reuse.

### Tech Lead / EM prep

Behavioral mock с people-сценариями:
- 1:1 с underperformer'ом
- Conflict между двумя разработчиками
- Pushback от product manager
- Hiring decision (junior vs senior trade-off)
- Tech-debt vs feature trade-off

**Источники:**
- Camille Fournier — «The Manager's Path»
- Will Larson — «Staff Engineer»
- Resilient Management blog
- Pragmatic Engineer

**Скоуп:** ~15 STAR-сценариев, новый persona в `services/ai_mock` (`tech_lead_mock` / `em_mock`), отдельный rubric.

### Code-review-coaching

Pull requests из публичных open-source repos → пользователь делает review → AI сравнивает с консенсусом мейнтейнеров (что было замёрджено / попросили изменить).

**Реализация:**
- Курируем 50 PR'ов (публичных) с архивированными discussions.
- Пользователь читает diff, оставляет review-comments.
- LLM compares с реальными комментами мейнтейнеров — что student пропустил, что лишнего.

**Эффорт:** 2-3 недели на курирование + UI. Реально мощная фича для senior+ — никто такого не делает.

### Эффорт по senior-трекам

| Что | Эффорт | Кто |
|---|---|---|
| System Design pack (15 кейсов) | 1 нед | ты |
| Tech Lead / EM mock (15 сценариев + persona) | 1.5 нед | ты |
| Code-review-coaching MVP (10 PR) | 2 нед | ты |
| Atlas extension (System Design / People skills branches) | 1 нед | ты |
| Onboarding multi-track | 1 нед | ты |

**Итого: ~6 недель** от тебя одного. Все три фичи живут под одной flag «Senior pack».

## Sysanalyst трек (приоритет 2)

**НЕ запускай сам.** Риск фейкового контента, который спалится за неделю.

### Что включает

- BPMN / UML diagrams
- Use-case specifications
- Functional / non-functional requirements
- SQL для аналитики (поверх бизнес-кейсов)
- API design / contracts
- Integration patterns (B2B / B2C)
- Acceptance criteria writing

### Аудитория

~150-200к в РФ. Готовы платить (зарплата 100-250к), но более consciousness customers — меньше вирального loop, больше нужно качество.

**Главный источник свитчеров:** разработчики (особенно frontend/backend middle), которые чувствуют что архитектура не их, но деньги нужны. Им проще объяснить «это ты + бизнес», чем «учись с нуля».

### Strategy

**Phase 1 (1 неделя):** найм part-time эксперта.
- Найти через TG/Хабр-вакансии: senior sysanalyst, 5-10 ч/нед, ~50к₽/мес.
- Главный critery: умеет писать rubrics, не «методолог-теоретик».

**Phase 2 (3 недели):** content bootstrap.
- LLM генерит черновик: 30 кейсов + Skill Atlas + rubrics из 10 публичных источников (ВШЭ-программы, Habr-статьи, Сысоев-блог).
- Эксперт валидирует за неделю — оставляем 70%, переписываем 30%.
- Ты делаешь технический wiring (mock persona, Atlas branches, Insights).

**Phase 3 (open-ended):** community feedback.
- Юзеры оставляют feedback на «задача мусор» / «годится».
- Топ-5 feedback'ов в неделю → эксперт правит.

### Эффорт

| Что | Эффорт | Кто |
|---|---|---|
| Найм эксперта | 1 нед (search + interview) | ты |
| Phase 2 content bootstrap | 3 нед параллельно | ты + эксперт |
| Atlas + mock persona + rubrics | 1 нед wiring | ты |
| Sysanalyst-pack launch | — | flag-on |

**Итого: ~5 недель + найм** при правильном эксперте.

## Product analyst трек (приоритет 3)

Аналогично Sysanalyst. **НЕ делай сам.**

### Что включает

- Product metrics (DAU/WAU/Funnel/Cohort/Retention)
- SQL для product analytics (over real schemas)
- A/B-тесты (proper hypothesis testing, sample size, power)
- Dashboard design (Looker / Amplitude / Tableau)
- North Star metric design
- Feature impact estimation

### Конкуренты

GoPractice Симулятор (~35к₽). Мы дешевле (Pro подписка) и интегрированнее (Insights, Skill Atlas, mock-сессии с product-задачами).

### Аудитория

~80-120к в РФ. Высокая платёжеспособность (зарплата 150-300к), но overlap с product manager — некоторые из них уже наши потенциальные клиенты.

### Strategy

Тот же flow что Sysanalyst. Эксперт другой (senior product analyst), персона в mock другая, контент другой.

**Эффорт: ~5 недель + найм.** Запускать после Sysanalyst — учимся на ошибках первого найма.

## Что не делаем

- ❌ **QA / тестировщик трек** — пока. Аудитория ~200к, но overlap с dev меньше, чем у sysanalyst. Парковка до Year 1 H2.
- ❌ **DevOps / SRE** — overlap с senior dev есть, но контент специфичен (Terraform, Kubernetes, observability). Парковка до Year 2.
- ❌ **Data engineer / ML engineer** — слишком узко, маленькая аудитория в РФ. Year 2+.
- ❌ **Designer / UX** — не наш рынок, нет инфры под визуальные задачи.

## Tradeoff

| За | Против |
|---|---|
| Senior-трек: zero-cost expand для тебя одного | Можешь застрять в content creation вместо product engineering |
| Sysanalyst/Product — большой TAM | Зависимость от part-time эксперта (риск качества) |
| Multi-track Atlas — Pro-конверсия (двойной мотив) | Усложнение onboarding'а |
| Reuse 80% инфры (mock, Atlas, Insights, llmchain) | Каждый трек требует своего content bootstrap |

## Метрики

- **Track diversity per active user** — сколько треков держит активный юзер. Higher = better retention.
- **Track conversion** — % free → Pro по трекам (ожидание: senior > sysanalyst > product analyst > dev).
- **Per-track NPS** — каждый трек оценивается отдельно, плохой контент видно сразу.
- **Cross-track stickiness** — % users с 2+ треками, которые держат ≥4 недели.

## Срок суммарно

| Когда | Что |
|---|---|
| Месяц 1 | Senior-pack: System Design + Tech Lead + multi-track onboarding |
| Месяц 2 | Code-review-coaching + senior content расширение |
| Месяц 3-4 | Sysanalyst: найм эксперта + content bootstrap + launch |
| Месяц 5-6 | Product analyst: найм эксперта + content bootstrap + launch |

**Итого 6 месяцев** для всех трёх треков с правильной приоритизацией. Без overlap'а — один трек запускается, потом следующий.
