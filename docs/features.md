# druz9 — Features Roadmap

> Живой список планируемых и реализованных фич.
> Прод-roadmap по годам — `docs/roadmap-5y.md`.
> Bible — `druz9-bible.md`.

---

## Status legend

- ✅ **Live** — задизайнено + реализовано во фронте + (где применимо) на бэке
- 🎨 **Designed** — UI готов в Pencil + frontend-страница есть, бэкенд не реализован
- 🚧 **In progress** — текущий sprint
- 📅 **Planned** — в roadmap, не начато
- 💭 **Idea** — в багажнике, нужно валидировать

---

## Voice AI

| # | Фича | Status | Notes |
|---|---|---|---|
| 1 | **MVP voice loop** — Web Speech API STT + browser SpeechSynthesis TTS + LLM via OpenRouter free tier | 🚧 | Chrome/Edge only. $0 cost. |
| 2 | **v1 — Premium TTS** — Microsoft Edge TTS proxy на бэке, 4 voices (RU/EN × male/female) | 🚧 | Subscription gated (premium+). $0 cost для нас. |
| 3 | **v2 — Self-hosted full stack** | 📅 | Когда выйдем на 1000+ DAU и захотим privacy + unlimited. |
| 4 | **Voice-driven System Design** | 💭 | AI слушает рассуждения над диаграммой, задаёт follow-up. После MVP voice mock review. |
| 5 | **Voice in Live Mock (peer)** | 💭 | Two-way audio room (WebRTC) для peer mock interview, без AI middleman. |
| 6 | **Voice clips for Match End** | 💭 | "AI озвучивает разбор" коротко (10-20 сек) — звуковой viral hook. |

### Voice v2 — self-hosted (план для масштаба 1000+ DAU)

**Зачем:** убрать зависимость от внешних API (Edge TTS, OpenRouter), полная privacy, unlimited LLM tokens.

**Stack:**
- **STT:** Whisper.cpp (или whisper-server) self-hosted, GPU желателен. Ru-RU модель `medium` (~770MB).
- **LLM:** Ollama + Qwen2.5-7B-Instruct (для общих диалогов) или DeepSeek-Coder-V2 (для кода). Альтернатива: vLLM с Qwen2.5-32B на GPU-сервере.
- **TTS:** Piper TTS (https://github.com/rhasspy/piper) — open-source, RU voices `irina/dmitri`, латентность ~200ms.

**Инфра:**
- Один GPU-VPS (Hetzner GEX44 / Vultr A40 / etc) ~$80-200/мес.
- Или CPU-only вариант: Whisper.cpp medium + Ollama + Piper на сервере с 16+GB RAM, latency ~3-5 сек (приемлемо).
- Docker compose с тремя сервисами (whisper / ollama / piper), каждый exposes HTTP/WS.

**Triggering:**
- Включаем когда:
  - LLM costs > $300/мес (free tier OpenRouter не справляется)
  - Privacy-conscious enterprise клиенты просят "не отправляйте наш код в OpenAI"
  - 1000+ DAU и хочется sub-second latency

**Migration:**
- Существующий `LLMProvider` интерфейс уже абстрактен — просто добавляется новая реализация `OllamaProvider` рядом с `OpenRouterProvider`. Конфиг `LLMProvider=ollama|openrouter` в env.
- Frontend voice library без изменений — endpoint тот же.

---

## Other planned features (по приоритету)

### Q3 2026 (быстрые wins)

| Фича | Статус | Effort | Impact |
|---|---|---|---|
| **Real WebSocket backend** (заменить mock-симулятор в `useChannel`) | 📅 | 1 неделя | High — все live-страницы становятся настоящими |
| **Telegram-бот для daily kata** (push задачи в 9:00) | 📅 | 1 неделя | High — retention killer для streak |

### Q4 2026

| Фича | Статус | Effort | Impact |
|---|---|---|---|
| **Real-time collab editor** (Yjs / Liveblocks) для Custom Lobby | 📅 | 2 недели | High — отличает от LeetCode |
| **Tournament series** (еженедельные кубки + prize pool) | 📅 | 2 недели | High — соц-движ |
| **Mobile app** (React Native, leveraging existing components) | 📅 | 1 месяц | High — daily engagement |

### 2027 (Y2 фичи)

| Фича | Статус | Effort | Impact |
|---|---|---|---|
| **Advanced anti-cheat** (ML-based pattern detection, не только paste) | 💭 | 1 месяц | High — для prize tournaments |
| **AR Code Lens** — наведи мышь на чужой код в Spectator → визуализация | 💭 | 3 недели | Med — wow-фактор |
| **AI-симуляция конкретного интервьюера** ("стиль строгий FAANG") | 💭 | 1 месяц | High — уникально |
| **Skill Tree v2** с keystone-узлами за командные достижения | 💭 | 2 недели | Med — когортная attraction |
| **Mentor marketplace** (peer-mentoring за gems) | 💭 | 1 месяц | Med — supply-side контента |

### 2028+ (Y3 платформенные)

| Фича | Статус | Notes |
|---|---|---|
| Community task marketplace | 💭 | Юзеры заливают свои kata, авторам доход |
| Multi-track (QA / DevOps / Data / Security / ML) | 💭 | Расширение TAM |
---

## Backend infra TODO (для production-readiness)

- ✅ OpenTelemetry + Jaeger (`backend/shared/pkg/otel/`)
- ✅ Prometheus metrics + Grafana dashboards (`backend/shared/pkg/metrics/`, `infra/observability/`)
- ✅ Structured slog → Loki ready (`backend/shared/pkg/logger/`)
- ✅ Telegram alerting via Alertmanager
- 📅 ClickHouse business events sink (currently no-op, see `metrics-coverage.md`)
- 📅 Real WebSocket implementation в `arena`/`mock`/`editor` сервисах (frontend ready)
- 📅 Judge0 self-hosting + integration (sandbox для исполнения кода)
- 📅 Yjs collaborative editor backend (Liveblocks vs self-hosted Yjs server)
- 📅 OAuth2 implementations (Yandex + Telegram Login Widget)
- 📅 Boosty webhook → subscription activation
- 📅 Asynq job queue для notifications

---

## Frontend technical debt

- 📅 Replace mock WS simulator in `useChannel` with real connection (готово — переключатель `VITE_USE_MSW`)
- 📅 i18n EN для 37 оставшихся страниц
- 📅 Connect mocks для оставшихся ~19 страниц (бóльшая часть статики)
- 📅 Unit tests для 5 ядерных компонентов (Button/Card/Avatar/Tabs/AppShell)
- 📅 Visual regression tests (Chromatic / Percy)
- 📅 Accessibility audit (axe-core в CI)
- 📅 Performance budget (LCP < 2s, FID < 100ms)
- 📅 PWA + offline mode для daily kata

---
## Контакт + предложить фичу

- Issues: github.com/dobriygolang/druz9/issues
- Telegram: t.me/druz9_dev
- Email: founder@druz9.online
