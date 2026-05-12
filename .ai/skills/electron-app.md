---
name: electron-app
description: Build, sign, notarize, and ship Hone or Cue Electron app DMGs. Covers Apple Developer setup, GitHub Actions release workflow, electron-updater feed, and stealth-specific gotchas for Cue. Use when cutting a release or troubleshooting a build.
---

# Релиз Electron-приложения (Hone / Cue)

Hone и Cue имеют почти идентичный pipeline (DMG + electron-updater), но **отдельные** сертификаты и feed'ы. Разделение нужно: если сертификат Hone скомпрометирован, Cue не отзывают вместе с ним.

## Когда применять

- Релиз новой версии Hone или Cue в beta / stable.
- Первая настройка release pipeline на новой машине.
- Дебаг падения подписи / нотарификации.

## Не применять

- Локальная разработка (`npm run dev`) — не нужно ничего из этого.
- Web-релиз — это `infra/scripts/deploy.sh`, см [docs/tech/deployment.md](../../docs/tech/deployment.md).

## Pre-flight (один раз для каждого приложения)

### Apple

- Apple Developer Program ($99/год) — `developer.apple.com/programs`.
- Создать **Developer ID Application** certificate. Скачать `.p12` + пароль.
- Зафиксировать `TEAM_ID` (10 символов, виден в Membership).
- Создать **app-specific password** для notarytool: `appleid.apple.com → Sign-In and Security → App-Specific Passwords`. Назвать `notarytool-hone` или `notarytool-cue`.

### Domain & infra

- Домен или поддомен под update-feed (например, `hone-updates.druzya.tech`, `cue-updates.druzya.tech`). DNS A-record на CDN/S3.
- S3-bucket с публичным read-доступом. Write — только из CI.
- Sentry проект — `hone-desktop` или `cue-desktop`. Скопировать DSN.

### OAuth

- Yandex / Telegram OAuth apps должны иметь redirect URI вида `druz9://auth?token=...`.

## GitHub Secrets (per-app)

Зарегистрируй в `Settings → Secrets and variables → Actions`:

| Секрет | Значение |
|---|---|
| `APPLE_ID` | Email Apple ID |
| `APPLE_APP_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-символьный |
| `CSC_LINK` | `base64 < cert.p12` |
| `CSC_KEY_PASSWORD` | Пароль к p12 |
| `GH_TOKEN` | personal access token с `public_repo` scope |
| `HONE_SENTRY_DSN` или `CUE_SENTRY_DSN` | Sentry DSN |

Префикс `HONE_*` vs `CUE_*` помогает не перепутать.

## Релизный процесс

### 1. Bump version

```bash
cd hone   # или cue
npm version patch   # или minor / major
```

Это поднимет `package.json#version` и сделает git tag (`v0.1.1`).

### 2. CHANGELOG (опционально)

Если ведёшь — добавь раздел перед тегом. Если нет — описание делает сам Release.

### 3. Push tag

```bash
git push origin main
git push origin hone-v0.1.1   # для Hone
# или
git push origin cue-v0.1.1    # для Cue
```

CI workflow `.github/workflows/hone-release.yml` (или `cue-release.yml`) запустится.

### 4. Что делает CI

```
1. Checkout
2. setup-node 20+
3. (Cue-only) Build native Swift binary через ./native/audio-mac/build.sh
4. npm ci
5. electron-builder --mac (arm64 + x64)
   - подписывает через CSC_LINK
   - afterSign hook: notarytool submit + wait
   - вытаскивает stapler
6. Создаёт GitHub Release
   - заливает .dmg, .zip, latest-mac.yml, blockmap
7. (опционально) выгружает в S3 для CDN-feed
```

### 5. Проверка после релиза

```bash
# Скачать DMG из Release
curl -L -O https://github.com/.../releases/download/hone-v0.1.1/Hone-0.1.1-arm64.dmg

# Проверить подпись
codesign -dv --verbose=4 /Volumes/Hone/Hone.app

# Проверить нотарификацию
spctl -a -vv -t install /Volumes/Hone/Hone.app
# Ожидается: "accepted, source=Notarized Developer ID"
```

### 6. Smoke-test перед публичной публикацией

- Открыть .app, login flow работает.
- (Cue-only) Stealth тест: открыть Zoom, Share screen, Cue окно не видно.
- (Hone) Daily plan загружается, Focus сессия пишется в backend, Stats показывает данные.
- electron-updater: открыть старую версию, новый релиз должен подхватиться через 4 часа (или вручную через `Check for updates` в menu).

## Cue-специфика

### Native Swift binary

```bash
cd cue/native/audio-mac
./build.sh
# Проверить:
file ../../resources/native/AudioCaptureMac
# Должно быть: Mach-O universal binary with 2 architectures (arm64, x86_64)
codesign -dv ../../resources/native/AudioCaptureMac
```

В CI это происходит **до** electron-builder. Если бинарь не подписан реальным Developer ID (а ad-hoc), Gatekeeper отвергнет DMG целиком — даже если Electron-приложение нотарицировано правильно.

`afterSign` hook (`build/notarize.js` или подобный) обязан включать native binary в notarize-bundle.

### Stealth матрица

Перед каждым stable-релизом — ручное прохождение:

| OS | Zoom | Meet | Teams | OBS | QuickTime |
|---|---|---|---|---|---|
| macOS 13 | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS 14 | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS 15 | ✓ | ✓ | ✓ | ✓ | ✓ |
| macOS 26 | ✓ | ✓ | ✓ | ✓ | ✓ |

Если в одной клетке окно Cue видно — релиз отменяется, ищем причину (обычно — обновление macOS закрыло hole в `setContentProtection`).

### Mock-block

Перед stable-релизом проверь, что `copilot.CheckBlock` действительно блокирует:

```bash
# 1. Создай mock-сессию на druz9.online с ai_assist=false
# 2. Открой Cue, попробуй ⌘⇧Space
# 3. Должна быть заглушка «Сессия запрещает помощь»
# 4. После окончания mock-сессии — Cue снова работает
```

## Auto-update

`hone/electron-updater` polls `latest-mac.yml` каждые 4 часа. Можно triggernуть ручную проверку через menu.

Если нужно срочно откатить релиз:

```bash
# Удалить из GitHub Release
gh release delete hone-v0.1.1 --yes

# Перезалить старую latest-mac.yml на CDN
aws s3 cp old-latest-mac.yml s3://hone-updates.druzya.tech/latest-mac.yml
```

## Anti-patterns

- ❌ **Один сертификат на оба приложения.** Compromise одного → отзыв обоих.
- ❌ **Ad-hoc подписать native binary.** DMG нотарицирован, native — нет → Gatekeeper rejects.
- ❌ **Релиз stable без stealth-матрицы (Cue).** Один пропущенный экран = негативный отзыв в первый день.
- ❌ **Hardcoded DSN в коде.** Из env / secrets.
- ❌ **Auto-update feed на одном бакете для двух приложений.** Channels должны быть независимыми.
- ❌ **Skip notarization** (`--no-notarize`) для production-релиза.
- ❌ **Релиз во время действующего killswitch на бэкенде.** Сначала разбираемся с инцидентом.

## Troubleshooting

| Симптом | Причина | Фикс |
|---|---|---|
| `code object is not signed at all` | CSC_LINK base64 битый / пароль не тот | Перегенерировать base64, проверить CSC_KEY_PASSWORD |
| `notarytool... Invalid` | Bundle ID не совпадает с registered в Apple | Проверить `appId` в `electron-builder.yml` |
| Cue окно видно в Zoom | macOS обновилось, hole закрыта | Срочно — issue в trackers, см cue plan B (capture-blocker via accessibility) |
| `latest-mac.yml not found` | S3 публикация пала | Перезалить руками + триггернуть updater |
| Native binary не запускается | Не подписан / TCC не grant'ed | Подписать в afterSign + onboarding flow с TCC prompts |

## Related

- [docs/tech/deployment.md#hone-cue-релизы](../../docs/tech/deployment.md#hone--cue-релизы)
- [docs/for_investment/cue.md](../../docs/for_investment/cue.md) — про stealth и mock-block
