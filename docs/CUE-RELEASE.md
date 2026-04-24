# Cue — Production Release Runbook

> Concrete steps от «текущий desktop/ с рабочим stealth» до подписанного DMG на сайте с auto-update.
> Cue сложнее Hone из-за stealth-моата, native audio-capture binary и compliance-граничных случаев.
>
> Читается вместе с [cue-bible.md](./cue-bible.md) и [HONE-RELEASE.md](./HONE-RELEASE.md) — многие шаги идентичны, дублировать не буду, указываю delta.

---

## 0. Pre-flight checklist (что специфично для Cue)

Большая часть совпадает с [HONE-RELEASE §0](./HONE-RELEASE.md#0-pre-flight-checklist-что-купить--завести-до-кода). Специфичное для Cue:

- [ ] **Отдельный Apple Developer ID certificate** — НЕ тот же что у Hone
  - Причина: если Hone-cert скомпрометирован, Cue не отзовут вместе
  - TEAM_ID тот же (один аккаунт), cert разный
- [ ] **App-specific password** `notarytool-cue` — отдельный, та же причина
- [ ] **Sentry project** — `cue-desktop` (не путать с `hone-desktop`)
- [ ] **Отдельный CDN / S3-bucket** — `cue-updates.druzya.tech`. НЕ переиспользуем hone's — channels независимые
- [ ] **Домен**: переходим на `getcue.app` / `usecue.com` / `cue.dev` — см [стратегическое решение по бренду](./ecosystem.md) в §6

### Юридические pre-check (специфично для Cue)

- [ ] **Юрист-консультация по stealth-feature** в контексте РФ
  - Ключевой вопрос: что меняется если пользователь использует Cue на корпоративном Mac без согласия работодателя
  - Вывод должен быть задокументирован до launch — например «продукт предоставляется как есть, пользователь несёт ответственность за соответствие политикам работодателя»
- [ ] **ToS для Cue** отдельный — шире чем Hone (должен упоминать записи встреч, audio-transcription, data retention policy)

---

## 1. Native audio binary — release mode

Specific to Cue, Hone'у не нужно.

### 1.1 Проверить текущее состояние

```bash
cd desktop
./native/audio-mac/build.sh
file resources/native/AudioCaptureMac
# Ожидается: Mach-O universal binary with 2 architectures: [arm64 x86_64]
codesign -dv resources/native/AudioCaptureMac
# В dev: ad-hoc подпись. В prod нужна Developer ID.
```

### 1.2 Prod-sign Swift binary

```bash
# Перед electron-builder вызовом:
codesign --force --deep --options=runtime \
  --entitlements desktop/resources/entitlements.mac.plist \
  --sign "Developer ID Application: <Name> (<TEAM_ID>)" \
  desktop/resources/native/AudioCaptureMac
```

Без этого шага notarization падает на внутренней подписи.

### 1.3 `afterSign` hook в electron-builder

Notarytool notarize'ит ВЕСЬ .app bundle включая вложенные binaries. Swift helper должен быть в `Contents/Resources/native/AudioCaptureMac` к моменту notarize — это обеспечивает `extraResources:` конфиг, уже настроенный.

---

## 2. Entitlements — уже существуют

[desktop/resources/entitlements.mac.plist](../desktop/resources/entitlements.mac.plist) уже содержит:

```xml
com.apple.security.cs.allow-jit                     true
com.apple.security.cs.allow-unsigned-executable-memory  true
com.apple.security.cs.disable-library-validation    true
com.apple.security.device.audio-input               true
com.apple.security.device.camera                    false
com.apple.security.network.client                   true
```

**Проверить перед релизом:** `disable-library-validation = true` нужен только если Swift binary linked against unsigned libs. После шага 1.2 можно попробовать **снять** — это best-practice.

---

## 3. Secrets в GitHub

Те же что у Hone, но с префиксом `CUE_`:

| Secret | Отличие от Hone |
|---|---|
| `CUE_CSC_LINK` | отдельный .p12 |
| `CUE_CSC_KEY_PASSWORD` | — |
| `CUE_APPLE_APP_SPECIFIC_PASSWORD` | отдельный |
| `CUE_APPLE_TEAM_ID` | тот же что у Hone |
| `CUE_UPDATES_S3_BUCKET` | `cue-updates` |
| `CUE_SENTRY_DSN` | другой проект |
| `VITE_DRUZ9_API_BASE_PROD` | **переиспользуется** — один backend |

---

## 4. GitHub Actions workflow — `release-cue.yml`

Скелет идентичен [HONE-RELEASE §3](./HONE-RELEASE.md#3-github-actions-workflow--release-honeyml), key deltas:

```yaml
on:
  push:
    tags: ['cue-v*']     # отдельный namespace тэгов

jobs:
  build:
    runs-on: macos-14
    defaults:
      run:
        working-directory: desktop     # пока директория называется desktop

    steps:
      # Те же что у Hone, плюс:

      - name: Build native audio binary
        run: |
          ./native/audio-mac/build.sh
          # Подписать до electron-builder — иначе notarize сломается
          codesign --force --deep --options=runtime \
            --entitlements resources/entitlements.mac.plist \
            --sign "Developer ID Application: $APPLE_DEVELOPER_NAME ($APPLE_TEAM_ID)" \
            resources/native/AudioCaptureMac
        env:
          APPLE_TEAM_ID: ${{ secrets.CUE_APPLE_TEAM_ID }}
          APPLE_DEVELOPER_NAME: ${{ secrets.CUE_APPLE_DEVELOPER_NAME }}

      # Затем — npm run build:mac, notarize через electron-builder
```

### Stealth smoke-test в CI

Cue — единственный продукт экосистемы со smoke-test'ом, который **обязан** пройти до публичного релиза:

- Каждый pre-release: запустить matrix из [cue-bible §8](./cue-bible.md#8-test-coverage)
- macOS 13/14/15/26 × {Zoom, Meet, Teams, OBS, QuickTime} = 20 клеток
- Provisional решение: делать вручную перед каждым release-cue тэгом, результат commit'ить как `.github/CUE_SMOKE_<version>.md`

Автоматизация matrix'а — отдельный проект (требует 4 Mac'а с разными macOS-ами + VM'и), не в Phase 6.

---

## 5. Backend prep

**Cue переиспользует существующие сервисы** `copilot` / `documents` / `transcription` — они уже в проде. Новых миграций не добавляется.

**Проверить** что ключи для Groq Whisper + Ollama embedder (для documents RAG) присутствуют в prod `.env` — см [cue-bible §11](./cue-bible.md#11-env-полный-перечень--2026-04).

---

## 6. Auth и deep-links

- `druz9://` scheme — тот же что у Hone (см HONE-RELEASE §6). macOS роутит в **последний зарегистрированный** bundle
- Для Cue это **приемлемо** только в сценарии установлен-и-Hone-и-Cue. Если установлен только Cue — он получает все `druz9://` links, включая те что должен ловить Hone. Это OK (Cue просто скажет «для этого action'а нужен Hone, установить»)

---

## 7. Download page

На `druz9.ru/download` секция Cue:

- Отдельный tab/section, не mix с Hone
- **Обязательный disclaimer** на странице: «Cue работает в стандарте "не видим для screen share". Использование на корпоративном оборудовании — на твою ответственность (см ToS §X)»
- Link на ToS-Cue выше scroll-fold

---

## 8. Monitoring — специфика Cue

Grafana dashboard `cue-metrics` (отдельный от hone):

- `druz9_llm_latency_seconds{task="copilot_stream"}` p50/p95
- `druz9_copilot_suggestion_trigger_rate_per_hour`
- `druz9_documents_embedding_latency_seconds` — RAG health
- Killswitch state: `druz9_killswitch_active{name="copilot_analyze"}` → gauge 0/1

**Специфично для Cue:** alert'ить когда `copilot_stream` p95 > 5s → stealth UX ломается на ожидании

---

## 9. Pre-release smoke — дополнительно к Hone-матрице

Выполнить в добавок к §10 HONE-RELEASE:

1. ✅ **Stealth matrix** — 20 клеток (macOS × screen-share app), 0 viewing-events
2. ✅ **Audio capture** — 5-мин Zoom-звонок, live-transcript в expanded пишется
3. ✅ **RAG** — upload CV.pdf → attach к session → вопрос на CV → ответ цитирует документ
4. ✅ **Auto-trigger** — встреча с вопросом «расскажи про...?» → pill показан ≤ 4s
5. ✅ **Global hotkey** не конфликтует с установленным Hone (оба installed одновременно)
6. ✅ **Tray-only lifecycle** — закрыть окно, Cue остаётся в трее; right-click → Quit работает
7. ✅ **Deep-link roundtrip** — `open druz9://task/dsa/p-102` в Terminal → routed в Hone не в Cue (если Hone зарегистрирован последним)

---

## 10. День релиза

Последовательность:

```bash
# 1. Финальный тэг:
git tag cue-v0.2.0    # Cue стартует с 0.2 — наследник Druz9 Copilot 0.1.x
git push origin cue-v0.2.0

# 2. GitHub Actions → Release Cue → channel=beta (первый публичный — beta)
# Ждёшь ~10 минут (+ native audio sign + notarize = больше чем Hone)

# 3. Проверь S3: cue-updates/beta/Cue-0.2.0-*.dmg + latest-mac.yml

# 4. Обнови druz9.ru/download — Cue section пусть будет в beta первые 2-3 недели

# 5. Особое внимание Sentry первые 72 часа:
#    - stealth-regression (окна видны в screen-share после какого-то апдейта macOS) = критично
#    - audio-capture crash = high
#    - RAG failures = medium
```

---

## 11. Rollback — специфика Cue

Два extra-сценария vs Hone:

### Apple закрыл stealth API

```bash
# 1. Немедленно — killswitch'нуть coiplot на backend:
redis-cli SET killswitch:copilot_analyze on
redis-cli SET killswitch:copilot_suggestion on
# Это делает Cue неработоспособным (errors в UI), но невозможно случайно
# раскрыть что-то чувствительное.

# 2. Обновить страницу `druz9.ru/download` — replace download button на
# "Cue временно недоступен на вашей версии macOS. Работаем над фиксом."

# 3. Тем временем — патч на accessibility-API fallback (см cue-bible §10),
#    публикация hotfix c новым stealth механизмом.
```

### Notarization revoked (Apple отозвал cert)

```bash
# Existing installs продолжают работать (уже notarized).
# Новые скачивания → Gatekeeper blocks.
# Решение: request новый Developer ID, rebuild всю историю версий,
# update S3 → clients через auto-update получат re-signed .dmg.
```

---

## 12. Post-release — еженедельный ritual (год 1)

- **Каждый вторник:** запустить stealth-matrix (автоматизированную когда будет, сейчас manual)
- **После каждого macOS minor release** (например 15.4 → 15.5): повторить matrix, тэг `cue-v<N>-macos-<version>-smoke`
- **После каждого Chromium / Electron major update** (31 → 32 → 33): тот же smoke

**Missed smoke = ship freeze.** Stealth — единственный моат, регрессия там = мёртвый продукт.

---

## 13. Parking (Year 2+)

- **Windows WASAPI** — C++ addon + `setContentProtection` proof на Win. ~2-3 недели работы. Критично для раскрытия B2B-рынка (70% корп-Mac'ов нет).
- **EV code-sign cert Windows** — $300-600/год. Без него Windows SmartScreen даёт «unknown publisher».
- **Mac App Store submission** — вероятно НЕ подадим: App Store sandbox запрещает `NSWindowSharingNone` tricks.

---

## 14. Связь с Hone

На публике: позиционирование отдельных продуктов. Внутри monorepo:

- **Один make target** `make release-desktop` в будущем может запустить оба `release-hone` и `release-cue` workflow (dispatch через `gh workflow run`), если оба готовы одновременно. Пока делаем раздельно.
- **Shared electron-core** (Year 1 Q4 — см [hone-bible §10](./hone-bible.md#10-year-1--scale--cross-platform-месяцы-3-12)) — вынести auth/keytar/update-checker в общий npm workspace пакет. До этого — OK что код дублирован.
- **Sentry проекты разные** — чтобы видеть regression'ы изолированно. Но retention выровнен (same 30 days).
