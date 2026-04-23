# Druz9 Copilot — как собрать и запустить

Краткий ответ на два частых вопроса.

---

## 1. Как я должен собрать приложение?

### Предусловия (один раз)

```bash
# Xcode CLT — для keytar, codesign, iconutil
xcode-select --install

# Node.js 20+
node -v   # должно быть >= 20
```

### Сборка с нуля

```bash
# из корня репозитория
make gen-proto      # регенерирует Go + TS стабы из copilot.proto
make gen-sqlc       # sqlc-типизированный DB-слой
make desktop-install  # npm install в desktop/
```

### Запуск в dev-режиме

```bash
# 1. Бек (на твоей машине или на сервере — см. §2)
make start

# 2. Десктоп (в отдельном терминале)
# Если бек локально:
make desktop-dev

# Если бек на твоём сервере:
DRUZ9_API_BASE_URL=https://api.твойсервер.tld make desktop-dev
```

Откроется compact-окно в правом верхнем углу экрана. Хоткеи работают
везде: `⌘⇧S` — скриншот, `⌘⇧D` — показать/скрыть, `⌘⇧V` — голос
(нужен BYOK-ключ OpenAI).

### Сборка `.dmg` для установки

```bash
DRUZ9_API_BASE_URL=https://api.твойсервер.tld make desktop-build
```

Готовый `.dmg` — в `desktop/dist/Druz9 Copilot-0.1.0-arm64.dmg`
(и `-x64.dmg` для Intel). Двойной клик → перетащи в `/Applications`.

На первом запуске macOS скажет «app from unidentified developer». Нужно:
**правый клик по `.app` → Open → Open в диалоге**. Один раз. Gatekeeper
запомнит.

Для публичного распространения нужен Apple Developer ID и нотаризация —
см. [docs/copilot-shipping.md](../docs/copilot-shipping.md) §7.

---

## 2. Ходит ли приложение на мой бек?

**Да, на твой бек — и только на твой.** Никакого Druz9-облака как
отдельного сервиса нет, мы «облако» = твой собственный сервер.

### Что уходит на твой сервер

| Действие | Эндпоинт | Когда |
|---|---|---|
| Загрузка конфига при старте | `GET /api/v1/copilot/desktop-config` | всегда |
| Telegram OAuth | через deep-link `druz9://auth/telegram` | при входе |
| Analyze/Chat | `POST /api/v1/copilot/analyze` (стрим) | **если BYOK выключен** |
| История диалогов | `GET /api/v1/copilot/history` | открытие истории |
| Квота | `GET /api/v1/copilot/quota` | периодически |
| Feedback | `POST /api/v1/copilot/messages/{id}/rate` | клик на оценку |

### Что НЕ уходит на твой сервер

Когда пользователь добавил свой OpenAI/Anthropic-ключ в **Настройки →
AI провайдеры**, и выбрал модель этого провайдера, то для такой
операции:

| | Куда идёт запрос |
|---|---|
| Скриншот + промпт | напрямую в `api.openai.com` / `api.anthropic.com` |
| Ответ модели | напрямую от провайдера к десктопу |
| Ключ | **никогда не покидает Keychain на маке пользователя** |
| **На твой бек** | **ничего** |

**Плата за инференс в BYOK-режиме идёт провайдеру, не тебе.** Это
закреплено как product promise, зафиксировано в архитектуре
(`docs/copilot-architecture.md` §6a).

### Схема

```
              ┌────────────────────────────────┐
              │  Пользовательский Mac          │
              │  ┌──────────────────────────┐  │
              │  │ Druz9 Copilot (Electron) │  │
              │  │                          │  │
              │  │  main process:           │  │
              │  │   ├─ Keychain (ключи)    │  │
              │  │   ├─ OpenAIProvider      │  │  BYOK: напрямую
              │  │   ├─ AnthropicProvider   │──┼──────────────┐
              │  │   └─ CopilotClient ──────┼──┼─ твой сервер │
              │  └──────────────────────────┘  │      │       │
              └────────────────────────────────┘      │       │
                                                      │       │
                                                      ▼       ▼
                                                 ┌──────┐ ┌──────────┐
                                                 │ Твой │ │ OpenAI / │
                                                 │ бек  │ │Anthropic │
                                                 └──────┘ └──────────┘
```

### Где задаётся URL твоего сервера

- **В dev:** через env var `DRUZ9_API_BASE_URL`.
  Пример: `DRUZ9_API_BASE_URL=https://api.druzya.tech npm run dev`
- **В prod-билде (`.dmg`):** тот же env var во время `make desktop-build`.
  Значение вшивается в бандл. Для смены URL надо пересобрать `.dmg`.
- **По умолчанию** (если env не задан): `http://localhost:8080` в dev,
  `https://api.druzya.tech` в prod (поменяй дефолт в
  [src/main/config/bootstrap.ts](src/main/config/bootstrap.ts) под свой домен).

### Если ты хочешь полностью без своего бека

Технически возможно — но тогда:
- Нужен **собственный JWT-эндпоинт** для Telegram OAuth (бек уже делает).
- `DesktopConfig` подставлять с клиента — потеряешь централизованное
  управление моделями/хоткеями. Альтернатива: держать на беке
  минимальный `/api/v1/copilot/desktop-config` без БД.
- История диалогов — только in-memory в ренденере (теряется на рестарте),
  или допилить локальный SQLite.

Для MVP **рекомендую оставить как есть:** твой бек для auth + config +
серверных моделей, BYOK для «не платить за инференс».

---

## Быстрая проверка что бек отвечает

```bash
# без токена — вернёт 401 (это нормально)
curl -I https://api.твойсервер.tld/api/v1/copilot/desktop-config

# с токеном (если уже залогинился через фронт)
curl https://api.твойсервер.tld/api/v1/copilot/desktop-config \
  -H "Authorization: Bearer $TOKEN" | jq '.rev, .defaultModelId'
# Ожидаемо: rev: 2, defaultModelId: "openai/gpt-4o-mini"
```

Если видишь `rev: 2` — бек собран с последней миграцией и config-ревизией.

---

## Где рулить настройками

| Хочу | Куда идти |
|---|---|
| Сменить URL бека | env `DRUZ9_API_BASE_URL`, пересобрать |
| Добавить модель в каталог | `backend/services/copilot/infra/config.go` → `DefaultDesktopConfig()`, поднять `Rev` |
| Включить/выключить BYOK UI | тот же файл, `Flags: [{Key: "byo_api_key", Enabled: …}]` |
| Изменить дефолтные хоткеи | `DefaultHotkeys` в том же файле |
| Поменять иконку приложения | `desktop/resources/icon.icns` (см. `resources/README.md`) |
| Поменять имя в Dock на лету | Settings → Общее → Маскировка (пользователь сам) |
| Поменять имя в Activity Monitor | нужен альтернативный `.app` билд (Phase 6+) |
