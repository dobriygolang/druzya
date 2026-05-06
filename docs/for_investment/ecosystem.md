# Экосистема druz9

Три продукта, один аккаунт, одна подписка. Каждый закрывает свой сценарий и не каннибализирует соседей.

```
┌──────────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│  druz9.online (web)      │   │   Hone (desktop)     │   │   Cue (desktop)      │
│  «AI-coach + AI-mock»    │   │   «Тихий кокпит»     │   │   «Наушник тренера»  │
│                          │   │                      │   │                      │
│  • AI mock-собеседования │   │  • План дня от AI    │   │  • Невидим при       │
│  • 5-axis radar /        │   │  • Pomodoro + focus  │   │    screen-share      │
│    rubric per track      │   │  • Заметки с AI-link │   │  • Live-транскрипт   │
│  • Skill Atlas + tracks  │   │  • Whiteboard + AI   │   │    встреч            │
│  • Codex opinion-pieces  │   │  • TaskBoard         │   │  • RAG по CV/JD      │
│  • AI-tutor 4-layer mem  │   │  • English hub (R/W/L)│   │  • Подсказки 3-4с    │
└────────────┬─────────────┘   └──────────┬───────────┘   └──────────┬───────────┘
             │                            │                          │
             └────────────────────────────┼──────────────────────────┘
                                          │
                              ┌───────────▼────────────┐
                              │  Один druz9 Pro        │
                              │  ~990 ₽/мес            │
                              │  Открывает AI везде    │
                              └────────────────────────┘
```

## Аудитория

Middle / senior разработчик в РФ. Готовится к собесу OR растёт по треку (Go senior / ML engineering / English B2+). Устал собирать продуктивность из Notion + Todoist + LeetCode + Obsidian.

## Ценностное предложение

Один продукт под каждое из трёх состояний разработчика:

| Состояние | Когда | Чем закрываем |
|---|---|---|
| **«Хочу подготовиться / расти»** | вечер, выходной | druz9.online — AI-coach + mock + atlas |
| **«Хочу спокойно поработать»** | утро / день | Hone — план + фокус + заметки |
| **«Я застрял здесь и сейчас»** | в IDE, на звонке | Cue — невидимый AI поверх ОС |

Разные триггеры → не конкурируют, дополняют. Пользователь не выбирает между ними — он всегда в одном из трёх.

## Как они связаны

- **Один аккаунт** (Yandex / Telegram OAuth) и одна подписка `druz9 Pro` открывают AI-фичи везде.
- **Skill Atlas** живёт на сайте — Hone читает для AI-плана и AI-link заметок, Cue читает для контекста подсказок.
- **Coach memory** (4-layer: snapshot / facts / summary / episodes) — общая для AI-mock и AI-tutor; Hone reflection events feeding обратно.
- **Mock-block протокол** — во время strict mock-сессии Cue автоматически блокируется. Watermark «честно vs с AI» — объективная метрика готовности.
- **Curation = ranking-proxy.** druz9 не создаёт content — линкует на Strang / mlcourse / DDIA / Kaggle / NeetCode через `external_resources` jsonb. Unique слой: AI-mock + Codex + AI-tutor + Hone + Intelligence.

## Правило несаморазмывания

Разделение ответственностей жёсткое — иначе три продукта схлопываются в один:

- **Web производит контент** (создаёт mock-сессии, atlas-узлы, codex-articles, аналитику).
- **Hone потребляет** + добавляет focus-слой и приватные артефакты (заметки, доски, taskboard). Не делает stealth.
- **Cue ситуативный** — не хранит state основного продукта, не имеет dock-иконки.

Если в одном появляется фича другого — режем.

## 3 трека (Sergey identity 2026-05-04)

druz9 — AI-coach с памятью + free tutor-toolkit + Hone для подготовки senior IT-разрабов. **3 трека:** Go senior · ML engineering · English (opt-in toggle). НЕ LeetCode / НЕ Skyeng / НЕ paid marketplace.

## Двусторонний рынок без денежного шага

Тутор приходит бесплатно с AI-toolkit (assignment push, shared atlas, tutor-rail в TaskBoard) → приводит студентов через invite-код → студенты apply на free Hone → ApAI-coach сужает gap до собеса. Нет marketplace fees — выручка с Pro-подписок студентов.

## Монетизация

Одна подписка `druz9 Pro` (~990 ₽/мес) открывает Pro-фичи во всех трёх продуктах:

| Поверхность | Free | Pro |
|---|---|---|
| druz9.online | Общий Atlas, AI-mock 1/нед, Codex public articles | Безлимитный AI-mock, расширенный Atlas, AI-tutor с памятью, Insights |
| Hone | Canvas, Pomodoro, Notes без AI-link, базовый Stats | AI-планер, AI-link заметок, AI-критика досок, AI auto-categorise TaskBoard |
| Cue | — (требует Pro) | Все фичи включены |

**Free Hone — привычка до оплаты.** **Cue — главный платящий хук:** без Pro он не запускается. Web — воронка через AI-mock и Atlas.

**Дополнительно (Phase 9a, Sergey 2026-05-04 Path C low-key):** standalone collab rooms (code/whiteboard) — discovery только через Settings → Developer tools / tutor / mock / club. NO top-level surface. Free 3 active · 24h TTL · 3 ppl max.

Будущие SKU: Teams (~3 000 ₽/мес/место) и Enterprise (договорные, on-prem) — Year 2+.

## Почему сейчас

- **РФ-рынок без стратегического конкурента.** LeetCode без AI, Cluely без интеграций под РФ-собес, Notion / Linear не учат расти как разработчик.
- **AI-стек дешёвый.** Free-tier у Groq / Cerebras / Google / Cloudflare / Z.ai / Mistral / OpenRouter покрывает 90% задач без копейки на инференс. Маржинальность изначально позитивная.
- **Stealth-моат закрывается.** Apple может прикрыть `setContentProtection` через 1-2 релиза macOS — у нас окно 12-18 месяцев на захват ниши.
- **Шаблон «AI-coach + кокпит + наушник» нигде не реализован.** В этом дифференциация.

## Целевые показатели Year 1

| Метрика | Цель к концу Year 1 |
|---|---|
| MAU экосистемы | 15 000 |
| Платящих | 3 000 |
| MRR | 2.5M ₽ |
| Retention D30 (Hone) | ≥ 12% |
| Северная звезда | weekly focus-hours per active user |

## Подробнее по продуктам

- [druz9.md](./druz9.md) — веб-продукт (AI-coach + AI-mock + atlas + tutor toolkit).
- [hone.md](./hone.md) — desktop-кокпит для ежедневного ритуала.
- [cue.md](./cue.md) — невидимый AI-помощник для звонков и работы.
