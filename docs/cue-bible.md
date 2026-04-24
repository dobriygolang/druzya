# Cue — Project Bible

> Stealth AI-наушник поверх ОС. **Отдельное приложение** в экосистеме druz9 (Hone — кокпит, Cue — наушник).
> Версия 3.0 · apr 2026 · бренд Druz9 Copilot → Cue, выход из "subsystem of Hone" в standalone product
>
> См [ecosystem.md](./ecosystem.md) для позиционирования vs Hone и druz9.ru.
>
> Имя файла (`stealth-bible.md`) сохранено чтобы не ломать git-историю и существующие ссылки. Директория `desktop/` тоже пока так называется (см ecosystem §6).

---

## 1. Что это сейчас

Cue — standalone Electron-приложение, живёт только в трее; compact + expanded окна поднимаются глобальным хоткеем и **невидимы при screen-share** (Zoom / Meet / Teams — через `setContentProtection(true)` → `NSWindowSharingNone` на macOS, `WDA_EXCLUDEFROMCAPTURE` на Windows в Electron 30+).

**Не путать с Hone.** Cue не имеет dock-иконки (трей only), не имеет главного окна-кокпита, не ведёт заметки и статистику. Весь UX — "ответь на вопрос сейчас, исчезни". Hone — противоположность: спокойный главный экран без stealth-трюков.

Каналы ввода:
- **Screenshot** — ⌘⇧S / ⌘⇧A, live screenshot в prompt
- **Voice (mic)** — MediaRecorder → /transcription → Whisper Turbo
- **System audio (macOS)** — ScreenCaptureKit native binary → VAD → WAV chunks → /transcription
- **Docs** — CV/JD/URL → RAG → auto-inject в system prompt copilot'а

Каналы вывода:
- **Chat stream** — Connect-RPC SSE
- **Auto-suggest pill** — ephemeral /copilot/suggestion при end-of-question в транскрипте

---

## 2. Что сделано (реальный код)

### Native layer

| Файл | Что | Статус |
|---|---|---|
| [`desktop/native/audio-mac/AudioCapture.swift`](../desktop/native/audio-mac/AudioCapture.swift) | ScreenCaptureKit system-audio → PCM16 16kHz mono + VAD + BOUNDARY events на stderr | ✅ prod |
| [`desktop/native/audio-mac/build.sh`](../desktop/native/audio-mac/build.sh) | swiftc universal arm64+x86_64 + ad-hoc sign | ✅ |
| `desktop/native/audio-win/` | WASAPI C++ addon | ❌ не начат, парковка |

**Note на пути:** файлы живут в `desktop/`, а не `cue/` — директория не переименована несмотря на рebrand `productName: Druz9 Copilot → Cue` в [`desktop/package.json`](../desktop/package.json). См [ecosystem.md §6](./ecosystem.md) о причинах.

### Electron main

| Путь | Что |
|---|---|
| `main/capture/audio-mac.ts` | spawn Swift binary, boundary-aware chunking (1-3s), WAV wrap, POST /transcription |
| `main/capture/screenshot.ts` | `desktopCapturer` область / полный экран |
| `main/coach/trigger-policy.ts` | rolling 60s transcript window + question-end detect + 15s cooldown → POST /copilot/suggestion |
| `main/api/{client,transcription,suggestion,documents}.ts` | REST-клиенты (Connect-RPC для copilot) |
| `main/windows/window-manager.ts` | `setContentProtection`, always-on-top, hidden-from-capture |
| `main/ipc/{handlers,schemas,validated}.ts` | IPC с zod-валидацией renderer-input |
| `main/masquerade.ts` | swap Dock icon / window titles на runtime |

### Renderer

- `screens/compact/` — 460×92 полоска с моделью/персоной/вводом
- `screens/expanded/` — чат + live-transcript + auto-suggest pill + mic + meeting record
- `screens/picker/` — floating persona/model picker
- `screens/settings/` — вкладка «Документы» (drag-drop PDF/DOCX/URL + attach к session)
- `screens/area-overlay/` — screenshot area-selector
- `screens/toast/` — floating error/info
- `stores/{audio-capture,coach,session,conversation,persona,documents}.ts` — zustand

### Backend (Go monolith)

| Сервис | Endpoints | Назначение |
|---|---|---|
| `services/copilot/` | Connect-RPC `analyze/chat/sessions/history` + REST `/copilot/suggestion`, `/copilot/sessions/{id}/documents` | LLM + sessions + RAG inject + ephemeral auto-suggest |
| `services/documents/` | REST `/documents/*` (upload, from-url, search, list, delete) | RAG-store: extract (txt/md/html/pdf/docx), chunk, embed (Ollama bge-small), pgvector-lite (real[] + in-Go cosine) |
| `services/transcription/` | REST `/transcription` | Groq whisper-large-v3-turbo batch STT |
| `shared/pkg/{killswitch,quota,ratelimit}` | Redis-based | cross-service security primitives |

---

## 3. Ключевые потоки

### Interview flow (этап 5 + 1 + 3 end-to-end)

```
1. Pre-meeting
   User: Settings → Документы → drop CV.pdf + paste JD URL
       ↓
   POST /documents        extract → chunk → embed → insert
   POST /documents/from-url  fetch → readability → text → embed

2. Start session
   User: Start interview session
       ↓
   POST /copilot/sessions (Connect)
   User: Settings → Документы → «Прикрепить» × 2
       ↓
   POST /copilot/sessions/{id}/documents/{docId} × 2

3. Start meeting record
   User: expanded header → «Запись встречи» (macOS только)
       ↓
   spawn AudioCaptureMac (TCC prompt first time)
       ↓
   ScreenCaptureKit → Float32 PCM → RMS VAD
   (speech? write to stdout : skip) + BOUNDARY on silence
       ↓
   Electron main: buffer → on BOUNDARY or 3s max → WAV-wrap →
       ↓
   POST /transcription → Groq Whisper → text
       ↓
   broadcast audio-capture-transcript → renderer LiveTranscriptStrip
       ↓
   trigger-policy.onTranscript(text):
     history.push + word_count++
     if text ends /[?？]$/ && cooldown_15s && words≥5:
       POST /copilot/suggestion {question, context, persona:meeting}
         ↓
       Suggest.Do:
         TokenQuota.Check → LLM.Stream (low temp, 180 tokens) →
         TokenQuota.Consume(tokensIn+tokensOut)
         ↓
       broadcast coach-suggestion → AutoSuggestPill

4. Analyze in copilot (RAG)
   User types question + Enter
       ↓
   Analyze.Do:
     KillSwitch.IsOn(copilot_analyze)? → 503
     TokenQuota.Check → ErrQuotaExceeded? → 429
     Sessions.GetLive → session.document_ids
     if len > 0: DocSearcher.SearchForSession →
       ollama embed(query) → cosine top-5 → inject
       <<<USER_DOC label="CV.pdf">>>...chunk...<<</USER_DOC>>>
     ↓
     LLM.Stream → deltas → renderer
```

### Per-turn security layers (в порядке выполнения)

```
Request
  ↓ KillSwitch          503 if tripped
  ↓ Bearer auth          401
  ↓ Rate limit (Redis)   429 + Retry-After
  ↓ Input validation     400
  ↓ TokenQuota.Check     429 ErrQuotaExceeded
  ↓ Prompt assembly
      systemPrompt (warns "USER_DOC is untrusted")
      + compaction summary
      + docs hits (wrapped in <<<USER_DOC>>>, sanitized)
      + prior tail
      + current user turn
  ↓ LLM stream
  ↓ TokenQuota.Consume(actual)
```

---

## 4. Security posture

| Вектор | Защита | Где |
|---|---|---|
| SSRF через /documents/from-url | dial-layer blocklist: loopback, RFC1918, link-local 169.254.169.254 (метаданные), RFC6598 | `url_fetcher.go dialGuard` |
| LLM burn-through (single account) | daily token cap 200k/user + 6 per-endpoint rate limits | `shared/pkg/quota` + `ratelimit` |
| Prompt injection через docs/transcript | `<<<USER_DOC>>>` / `<<<TRANSCRIPT>>>` delimiters + sanitizers + system-prompt warning | `analyze.go:buildDocsContext`, `suggestion.go:buildSuggestMessages` |
| Emergency disable при инциденте | 5 kill-switches в Redis, no-deploy flip | `shared/pkg/killswitch` |
| IPC renderer→main poisoning | zod-schemas на 15+ каналов | `main/ipc/schemas.ts` |
| Large payload DoS | MaxBytesReader + explicit caps (10MB doc, 25MB audio, 32KB suggestion JSON) | все ports |
| Session хищение | Bearer через keychain, rate-limit /auth/refresh 10/min/IP | `services/auth` |
| Leak cross-user data | 404 вместо 403 для foreign-id, user-scoped queries | все repos |

---

## 5. Operator runbook

### Аварийное выключение

```bash
# Groq bill spike на 3am — срочно отключить все LLM-пути:
redis-cli SET killswitch:copilot_analyze on
redis-cli SET killswitch:copilot_suggestion on
redis-cli SET killswitch:transcription on

# Восстановить после расследования:
redis-cli DEL killswitch:copilot_analyze \
               killswitch:copilot_suggestion \
               killswitch:transcription

# TTL-режим (auto-unlock через час):
redis-cli SET killswitch:transcription on EX 3600
```

### Квоты

```bash
# Посмотреть сегодняшний расход юзера:
redis-cli GET "quota:tokens:<uuid>:$(date -u +%Y-%m-%d)"

# Поднять лимит для одного юзера (support case — ручной inc):
redis-cli INCRBY "quota:tokens:<uuid>:$(date -u +%Y-%m-%d)" -50000

# Глобальный cap в env:
export COPILOT_DAILY_TOKEN_CAP=500000  # по умолчанию 200000
```

### Диагностика native audio (macOS)

```bash
# Проверить что бинарь собран и подписан:
file desktop/resources/native/AudioCaptureMac
codesign -dv desktop/resources/native/AudioCaptureMac

# Ручной запуск (увидишь READY: + BOUNDARY/ERROR lines на stderr):
desktop/resources/native/AudioCaptureMac

# Проверить TCC grant:
sqlite3 "$HOME/Library/Application Support/com.apple.TCC/TCC.db" \
  "SELECT service, client, auth_value FROM access WHERE client LIKE '%AudioCaptureMac%';"
```

---

## 6. Что работает гарантированно

- **Stealth при screen-share** на macOS 13+: Zoom 5.x, Google Meet, Teams new, Discord screen-share, QuickTime recording — все **не видят** compact/expanded окна.
- **macOS system audio capture**: тестировано на macOS 26 (Tahoe) с Zoom/Meet/Teams audio — Whisper распознаёт собеседника за ~1s после 600ms тишины.
- **Mic voice input** на macOS + Windows: MediaRecorder работает кросс-платформенно, Groq принимает webm/opus.
- **RAG**: text/md/html/pdf/docx/URL → embed через Ollama sidecar (self-host) → context в copilot.
- **Auto-trigger** в meeting-mode: из транскрипта собеседника выдёргивает end-of-question, показывает подсказку за 3-4s end-to-end.

## 7. Что НЕ работает / known limits

- **Windows system audio** — не реализовано (этап 1 часть 2, парковка). Desktop-капчур звонка на Win = только mic.
- **Streaming STT** — сейчас batch (Groq не поддерживает chunked). True streaming потребует swap на Deepgram / AssemblyAI (отдельная работа + платный tier).
- **Scanned PDF без OCR** → `ErrEmptyContent`. Решение: Tesseract layer (отложено).
- **Linux** — не в scope. X11/Wayland дают плохие stealth-гарантии.
- **Session transcript persistence** — сейчас клиентский (zustand в renderer). Закрыл app → 30 мин митинга потерялись. Надо добавить `session_transcripts` table.
- **Windows `setContentProtection` тест** — код работает с Electron 30+, **но** не тестировано на реальном Teams 2.0 / OBS с GDI capture на Win — нужна матрица.

---

## 8. Test coverage

Backend: **62 unit-теста** (все race-clean)
- `services/copilot/app` — 4 (prompt injection sanitizers + suggest wrapping + existing StartSession)
- `services/documents/infra` — 28 (chunker, search, url_fetcher + SSRF)
- `services/documents/infra/extractor` — 14 (text/html/docx)
- `services/transcription/infra` — 8 (Groq provider httptest)
- `shared/pkg/quota|killswitch|ratelimit` — unit-coverage через integration в services

Desktop: typecheck + electron-vite build, **нет runtime-тестов** (технический долг — Playwright когда надо).

Smoke matrix (ручной, перед каждым релизом):
- Stealth: macOS 13/14/15/26 × {Zoom, Meet, Teams, OBS, QuickTime} = 20 клеток
- Audio capture: 5-минутная встреча на Zoom с речью → транскрипт в live-strip
- RAG: upload CV + JD → attach к сессии → вопрос → AI учитывает документы в ответе
- Auto-trigger: meeting audio с «расскажи про...?» → pill появляется ≤4s

---

## 9. Roadmap — план развития

### Сейчас (≤2 недели) — критичное для публичного релиза

| Задача | Effort | Почему сейчас |
|---|---|---|
| Windows `setContentProtection` ручная матрица (Teams 2.0 + OBS + Discord) | 1 день | 50% рынка — если там дыра, релиз отменять |
| Session transcript persistence (table + POST из main) | 2 дня | юзер теряет 30-минутный митинг при закрытии app |
| Native Swift Developer ID sign (notarization afterSign hook) | 1 день | Gatekeeper на DMG не пустит ad-hoc подписанный AudioCaptureMac |
| Goose migration runbook + smoke для 00011 + 00012 в staging | 1 день | Prod-тест миграций до публичного релиза |
| Monitor: Grafana дашборд с Groq-burn + daily-quota heatmap | 1 день | Иначе увидим «бомбёжку» через сутки, а не через час |

### Near-term (2-6 недель) — догнать Cluely

| Задача | Effort | Impact |
|---|---|---|
| **Windows WASAPI native module** (C++ addon + node-gyp) | 2 недели | Второй рынок. Без этого этап 3 (live coach) на Win невозможен |
| **Streaming STT**: переезд на Deepgram live-endpoint | 1 неделя | Latency 0.8s → 0.3s, auto-suggest на Cluely-уровне |
| **PDF OCR fallback** (Tesseract-wasm в renderer или отдельный backend-service) | 4 дня | 30% резюме — сканы; сейчас они отклоняются |
| **Session report includes transcript** (analyzer видит речь встречи) | 3 дня | Качественно усиливает post-session report |
| **Interview-coach persona** (специальная вкладка, STAR-шаблон, Confidence-score) | 1 неделя | Дифференциация vs Cluely |

### Mid-term (1.5-3 месяца) — продуктовый moat

| Задача | Почему |
|---|---|
| **pgvector migration** (когда >10k chunks/user) | Real[] + in-Go cosine ломается на масштабе |
| **Per-plan daily cap**: Free=50k, Pro=1M, Team=∞ | Монетизация |
| **Voice diarization**: separate mic vs system audio streams | Сейчас они обе в одном потоке — auto-trigger не умеет отличить «я сказал» от «собеседник сказал» |
| **In-app kill-switch dashboard** (admin UI) | Сейчас только redis-cli — нужна кнопка support-инженеру |
| **Observability**: OTEL + Prometheus metrics на документы/транскрипт/suggestion latency | Slo-ключевая диагностика |
| **Linux support** (best-effort) | X11 `_NET_WM_WINDOW_TYPE_SPLASH` + Wayland — неполный stealth, но mic + RAG + copilot работают |

### Long-term (3-6 месяцев) — экосистема

- **Memory**: RAG-хранилище **всех прошлых сессий** (не только attached docs) — "помни что я говорил на прошлом интервью с X"
- **Multi-device sync**: один аккаунт, данные RAG и sessions синк'аются между macOS/Win/web
- **Plugin SDK**: пусть третьи-партии пишут свои data-ingestion (CRM, GitHub, Linear) → RAG это автоматически учитывает
- **On-device mini-LLM** (Qwen 3B через Ollama) для privacy-mode — всё в offline, без облака
- **Mobile companion app** (read-only, просмотр sessions + document library)

### Анти-фичи (что точно НЕ делаем)

- ❌ Browser extension — уводит фокус от flagship app, фрагментирует auth/UX
- ❌ "Чат-бот-лидогенерация" на web-сайте — мы product-led, а не sales-led
- ❌ SaaS B2B dashboards для HR — это совершенно другой продукт, не наш рынок
- ❌ Свой LLM — compute-расходы запретят существовать стартапу
- ❌ Замена IDE — Cursor уже есть, мы не конкурируем за IDE-слот

---

## 10. Риски и митигация

| Риск | Вероятность | Импакт | Митигация |
|---|---|---|---|
| Apple закроет NSWindowSharingNone hole | средняя | критический — stealth = moat | Beta-channel monitoring. Plan B: capture-blocker через accessibility API (хуже, но работает) |
| Groq free-tier закрывается | средняя | высокий | llmchain уже поддерживает Cerebras/Mistral/OpenRouter — переключение 1 env change |
| Whisper-large-turbo deprecation | низкая | средний | llmcache + fallback на AssemblyAI/OpenAI Whisper по task-based routing |
| macOS TCC prompts раздражают юзера | средняя | средний | Onboarding шаг с чёткой инструкцией + deep-link в Settings → Privacy |
| Ollama sidecar падает в prod | низкая | высокий | `/documents` disabled (нет embedder'а) — но уже есть graceful fallback на NoopCache в llmchain; добавить monitor + auto-restart compose |
| Судебный запрос на user data | низкая | критический | Не храним скриншоты / audio raw — только derived embeddings + transcripts. Session-level delete уже работает через cascade. |

---

## 11. Env (полный перечень — 2026-04)

```bash
# Core
DRUZ9_API_BASE_URL=http://localhost:8080
DRUZ9_UPDATE_FEED_URL=                         # electron-updater (prod)

# LLM providers (llmchain picks first non-empty)
GROQ_API_KEY=gsk_...                           # primary — also powers Whisper
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=                            # :free lane fallback
OLLAMA_HOST=http://ollama:11434                # self-host embedder — REQUIRED for documents

# Security & quotas
COPILOT_DAILY_TOKEN_CAP=200000                 # per-user/day
ENCRYPTION_KEY=...                             # 32-byte hex, auth module

# Observability (optional)
OTEL_EXPORTER_OTLP_ENDPOINT=
SENTRY_DSN=
```

---

## 12. Не путать

- **Не Interview Coder.** Работает в любом контексте: IDE, Jira, звонок, документация.
- **Не заменяет polished IDE-интеграцию.** Cursor и Continue это другой рынок.
- **Не имеет своей монетизации.** Включён в `druz9 Pro`, вместе с Hone и арендой druz9.ru.
- **Не подсистема Hone.** Отдельное приложение с собственным релизным циклом, package.json, update-feed. Единственная общая вещь — backend endpoints и `druz9 Pro` entitlement.
- **Не web-feature.** Stealth-слой работает **только с установленным desktop-приложением**.

---

## 13. Относительно Hone

| Вопрос | Ответ |
|---|---|
| Общий код Electron main/preload? | Сейчас дублирован. План: вынести в `shared/electron-core` (см [hone-bible §8](./hone-bible.md)) — auth, RPC-клиент, deep-link handler, updater. Target Phase 6. |
| Общий Connect-RPC transport? | Да, типы генерятся в `frontend/src/api/generated/` через `make gen-proto`, оба апа алиасят как `@generated/*`. |
| Общий `druz9 Pro` subscription? | Да, keychain-хранимый токен валидируется против одного backend endpoint'а. |
| Одна установка? | Нет — два независимых DMG. План единого «druz9 Suite» инсталлера в Year 1 Q4 (см [hone-bible §10](./hone-bible.md)). |
| Можно ли Cue без Hone? | Да. Cue — standalone продукт, существует без Hone. Pro-юзер может установить только Cue. |
| Общие хоткеи? | Нет конфликтов. Hone реагирует только в фокусе (`⌘K`, `T`/`F`/`S`/…). Cue — global (`⌘⇧Space`, `⌘⇧S`, `⌘⇧A`). |

---

## 14. Changelog

- **3.0** (apr 2026) — Cue выделен из «subsystem of Hone» в standalone продукт. Brand rename Druz9 Copilot → Cue в package.json. Обновлены §1, §12, добавлен §13 о связях с Hone. Технические секции (audio/security/runbook) остались без изменений — код не менялся.
- **2.0** (apr 2026) — расширение под этапы 1/3/5: audio capture macOS, VAD, auto-triggers, documents RAG, security hardening (SSRF + killswitch + quota + prompt injection)
- **1.0** (apr 2026) — initial stealth-only
