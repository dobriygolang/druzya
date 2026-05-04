# Hone — тихий кокпит разработчика

Минималистичное desktop-приложение, в которое разработчик возвращается каждый день. Часть экосистемы druz9.

> **One-liner:** «Sharpen your craft daily. Quietly.»

## Что это

Один чёрный экран. План на день, помодоро-таймер, приватные заметки, whiteboard, статистика, AI-coach. Всё вызывается с клавиатуры через ⌘K. Никаких меню, никаких уведомлений, никакого шума.

## Какую проблему решает

Разработчик собирает свой день по 5 приложениям: Notion для заметок, Todoist для задач, LeetCode/druz9 для практики, Cal для встреч, ChatGPT для вопросов. Каждое требует внимания, каждое уводит в свою экосистему.

Hone — **одна поверхность** для ежедневного ритуала: «AI рассказал что сегодня важно → работаю над этим → отметил, что сделал → reflection в memory». Без переключения контекста.

## Палитра (Phase 11a, Sergey 2026-05-04)

⌘K палитра содержит **только Hone-native** pages — 7 items:

| Action | Хоткей | Что делает |
|---|---|---|
| **Today** | `T` | AI-план дня (3-5 пунктов с rationale) + Focus pomodoro |
| **Coach** | `C` | AI-coach hero: next-action + 5-axis radar + fork-snapshot (explore mode) |
| **Stats** | `S` | Focus heatmap, streak, 7-дневные бары, top topics |
| **Notes** | `N` | Markdown + AI-link suggestions (cosine + LLM rerank с reason) |
| **TaskBoard** | `B` | Notion-style kanban с AI auto-categorise (CategoriseTask LLM) |
| **English** | `E` | Hub: Reading + Writing + Listening + Vocab (Leitner SRS) |
| **Settings** | `,` | Preferences + onboarding recovery + Developer tools |

**Удалено из palette** (Sergey rule «Hone consumes, Web produces»):
- ❌ Tutor / Boards · Code rooms / Group events / Podcasts / Stats-dashboard duplicate

Web pages по-прежнему доступны через **контекстные deeplinks** на конкретных Hone surfaces:
- Coach hero «start mock» → web `/mock`
- Today AI-plan step CTA «practice» → external URL
- TaskBoard tutor-card → web `/tutor/student/{id}`
- Notes resource-link → external URL
- Atlas chip → web `/atlas/track/{slug}`

## Power-user features

### Settings → Developer tools (Phase 7 §7a, Path C low-key)

Collapsed-by-default section. Manual entry-point для standalone collab rooms (Phase 9a):
- **+ create code room** / **+ create whiteboard** → free-tier 3 active · 24h TTL · 3 ppl max
- Active rooms list (open / share / extend / delete) + Past rooms (30d restore window)
- NO palette / nav entry — discovery только через Settings или tutor/mock/club workflows

### Settings → My learning resources (Phase 5 §5a-c)

Collapsed-by-default section. Manual add-resource flow + override view:
- **+ add resource** → URL paste → backend best-effort fetch (HTML/PDF/YouTube/GitHub) → AI extract → user confirm fields → save in `user_resource_overrides`
- ResourceCard hover actions: hide for me / mark unhelpful / replace with own
- Reflection grade auto-feeds promotion_signals (Phase 3.5d adaptive AI loop)

## ДНК продукта

- **Тёмный, тихий.** Один чёрный canvas, везде Esc возвращает в пустоту. B/W only — `#FF3B30` accent **только** точкой-индикатором / 1.5px stripe / single SVG stroke.
- **Keyboard-first.** Никаких меню, никаких toolbar'ов.
- **AI плавно.** Не задрачивает «давай я тебе помогу». Появляется только когда есть смысл (план дня, AI-link заметок, AI-критика whiteboard, AI auto-categorise tasks).
- **Приватность.** Notes и Whiteboard живут локально (Vault encryption) и не расшариваются по умолчанию.
- **Offline-first.** «Hone должен работать в самолёте» — write-actions через outbox (IndexedDB queue) + auto-drain on `online` event. 12 op-kinds: editor/whiteboard rooms · resource (add/hide/unhelpful/replace) · reflection.submit · external_activity.log.
- **Responsive.** Все surfaces flex на любое разрешение — flex-wrap + minWidth:0 + auto-fit grid.
- **Радикальный минимализм.** Если на экране больше двух визуальных групп — переверстать.

## Что Hone НЕ делает

- ❌ Не решает задачи (deep-link на druz9.online)
- ❌ Нет арены, mock, рейтингов (это веб)
- ❌ Нет stealth / global hotkey / hidden window — это подпись Cue
- ❌ Не создаёт atlas-узлы / mock pools / codex articles (web производит)

Если фича вызывает «зачем мне Hone, если есть druz9.online» — она не Hone, она веба.

## Как используется в экосистеме

- **Daily hook.** Хоум-страница ежедневного использования, главный driver retention.
- **Focus → Stats → Coach memory.** Focus-сессии + reflection события feeding обратно в coach 4-layer memory (snapshot/facts/summary/episodes) — drives next-action.
- **Atlas reader.** Atlas tree живёт на вебе, Hone читает для AI-плана и AI-link заметок.

## Дифференциация

- **Winter / Linear / Things 3 эстетика + AI с памятью.** На РФ-рынке нет десктоп-приложения с такой эстетикой и встроенным AI-coach с 4-layer памятью под рост разработчика. Cursor — IDE. Raycast — лаунчер. Notion — wiki. Hone — единственный продукт под «ежедневный ритуал senior разработчика».
- **Free-tier приучает.** Pomodoro + Notes без AI-link + Stats бесплатны и достаточны как daily-companion. Pro доплачивается за AI-планер, AI-link заметок, AI-критика, AI auto-categorise.
- **Часть экосистемы.** Hone один не имел бы Insights / coach memory / atlas. Связка с druz9.online — самостоятельный моат.

## Статус (2026-05-05)

Production beta на macOS (arm64 + x64) с notarized DMG, electron-updater, Sentry.

Технически: Electron + Vite + React 18, Connect-RPC к Go-монолиту, AI через `llmchain` cascade — Groq → Cerebras → Google AI → Cloudflare Workers AI → Z.ai → Mistral → OpenRouter (free-tier only) → Ollama (self-host floor).

**Архитектурные milestone'ы:**
- Phase 5 (DB v64): Notes AI-link suggestions (SuggestNoteLinks RPC + reflection note auto-create + embed)
- Phase 6 (2026-05-05): OnboardingModal v2 — 3-step wizard (stack / mode / shortcuts)
- Phase 9a (DB v66): standalone collab rooms low-key
- Phase 10: TaskBoard AI auto-place (CategoriseTask UC fire-and-forget после CreateTask + AICursor SSE event publish)
- Phase 11a: palette cleanup → 7 native-only items
- Phase 11b polish: stagger animations / shimmer / View Transitions / RequiresOnline wrapper / OfflineBanner extended

## Метрики

- DAU / D7 retention (главное: вернулся ли через неделю).
- Weekly focus-hours per active user — северная звезда.
- ⌘K → action conversion в воронке.
- Free → Pro conversion (триггер — попытка открыть AI-план / AI-link / AI-critique).
