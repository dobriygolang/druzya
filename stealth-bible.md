# Stealth Copilot — Subsystem Bible

> Невидимый AI-наушник поверх ОС. Подсистема внутри Hone (Electron), не отдельный продукт в смысле UX.
> Версия 1.0 · apr 2026 (существует и работает)

---

## 1. Что это

Stealth Copilot — tray-overlay режим приложения Hone. Вызывается `⌘⇧Space` из любой точки macOS, **невидим для screen-share** (Zoom / Google Meet / Chrome `getDisplayMedia`), видит текущий экран, отдаёт AI-ответ за ~1-2 сек.

---

## 2. Зачем это моат

- Единственная защитимая **техническая** фишка экосистемы.
- Конкуренты (Cluely, Interview Coder) — stealth-for-interview-only, без экосистемы.
- Пользователь, у которого `⌘⇧Space` в muscle memory — не уйдёт ни в Cursor, ни в Raycast.
- Порог входа для копирования: macOS-only hacks, каждое обновление Apple/Chromium может сломать → нужна постоянная поддержка.

---

## 3. Как это работает (уже реализовано)

### Native side (`desktop/native/CursorHelper/`)

- `CGWindowLevel` выше `kCGMaximumWindowLevel - captureAllowed` → невидим для `desktopCapturer` и `getDisplayMedia`
- `NSWindow.sharingType = .none`
- Content protection flag через `NSWindowCollectionBehavior`
- Global hotkey регистрируется через существующий `src/main/hotkeys/`

### Electron main (`desktop/src/main/`)

| Файл | Что |
|---|---|
| `windows/stealth.ts` (condition.) | окно с `contentProtection: true`, always-on-top, frameless |
| `capture/screenshot.ts` | снимок активного монитора через `desktopCapturer` |
| `ipc/streaming.ts` | SSE мост от renderer к `llmchain` |
| `masquerade.ts` | маскирует window title от AX API (для macOS Accessibility) |
| `hotkeys/` | регистрирует `⌘⇧Space`, `⌘⇧S` (screenshot again), `esc` (dismiss) |

### Renderer (`desktop/src/renderer/screens/`)

- `compact/` — полоска-оверлей с input'ом («что спросить»)
- `expanded/` — разворачивается автоматически при длинном ответе
- Оба hash-routed в одном `index.html` — один renderer процесс

---

## 4. Смоук-тест (существующий)

Протокол в [`desktop/scripts/smoke-stealth.md`](./desktop/scripts/smoke-stealth.md) — матрица 7 кейсов:

- Zoom / Google Meet / Chrome demo × типы screen-share × 7 действий
- Viewer must NOT see stealth window в любом из случаев
- **Запускать перед каждым релизом** и после крупного macOS / Chromium update

Это launch-blocking регресс — stealth и есть моат, сломанный stealth = мёртвый продукт.

---

## 5. Роль в экосистеме Hone

- Stealth — **подсистема Hone**, не отдельное приложение.
- Один Electron процесс, одна инсталляция, одна иконка в трее.
- Hone main window = кокпит; Stealth = tray + hotkey-поведение.
- Общие: auth, `druz9Client`, настройки, LLM chain.

```
Hone.app
├── Main window       (canvas + panels — когда открыт)
└── Tray              (всегда есть)
    ├── Menu          (quit / settings / toggle stealth)
    └── Stealth hotkey → compact window
```

---

## 6. Не путать

- **Не Interview Coder.** Работает в любом контексте: IDE, Jira, созвон, документация, офис.
- **Не заменяет Hone main window.** Stealth — «быстро помоги сейчас», main window — «спланировать день».
- **Не имеет своей монетизации.** Включён в `druz9 Pro`.
- **Не web-feature.** Вызов `⌘⇧Space` работает только с установленным Hone.

---

## 7. Env

```
DRUZ9_API_BASE_URL=http://localhost:8080      # Connect-RPC host
DRUZ9_UPDATE_FEED_URL=                        # electron-updater (prod)
```

Auth — через `keytar` в Keychain, deep-link `druz9://auth?token=...` после OAuth на web.

---

## 8. Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| Apple закроет content-protection hole | средняя | план B: AX API fallback, мониторить betas |
| Chromium меняет `getDisplayMedia` поведение | средняя | регрессионный смоук-тест каждый релиз |
| Работодатель обязывает не ставить stealth | низкая | Hone main window работает и без stealth включённого |
| Windows-порт дорогой | — | `SetWindowDisplayAffinity` + DWM hooks, +3 нед работы, парковка v2 |

---

## 9. Что НЕ делает stealth

- ❌ Не запоминает предыдущие вопросы между вызовами (каждый hotkey-вызов — новая сессия)
- ❌ Не записывает звук / speech-to-text (в MVP)
- ❌ Не persist'ит скриншоты — captured → LLM → discarded
- ❌ Не виден в alt-tab / mission control / dock

---

## 10. Будущее (v2)

- Contextual memory — привязка к current task из Hone Today
- Voice-in mode (для созвонов — «стенографист»)
- Windows-порт
- Linux-порт (на X11/Wayland — отдельная дыра в безопасности, сложно)
