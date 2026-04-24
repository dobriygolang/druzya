# Hone — Production Release Runbook

> Concrete steps от «MVP скелет» до подписанного DMG на сайте с auto-update.
> Сценарий: macOS-first (arm64 + x64), Windows парковка до Year 1 Q3.
>
> Читается вместе с [hone-bible.md](./hone-bible.md) (roadmap) и [DEPLOYMENT.md](./DEPLOYMENT.md) (backend deploy, не трогаем здесь).

---

## 0. Pre-flight checklist (что купить / завести до кода)

**Делается руками, до любого CI-изменения. Блокирует релиз.**

- [ ] **Apple Developer Program** — $99/год, [developer.apple.com/programs](https://developer.apple.com/programs)
  - Заказать Developer ID Application certificate → скачать `.p12` + пароль
  - Зафиксировать `TEAM_ID` (10-символьный, виден в Account → Membership)
- [ ] **App-specific password** для notarytool
  - [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords → `notarytool-hone`
- [ ] **Домен** — `hone.dev` / `gethone.com` / `hone.app` (проверить свободен, купить)
  - DNS A/AAAA на хост где будет лежать update-feed
- [ ] **Sentry project** — создать `hone-desktop` проект в существующей организации, скопировать DSN
- [ ] **CDN / host для update-feed** — вариант минимальный: отдельный S3-bucket `hone-updates.druzya.tech` с publish-доступом только из CI
- [ ] **OAuth redirect URIs** для `druz9://` в Yandex + Telegram OAuth apps (см [§6](#6-auth-и-deep-links))

---

## 1. Entitlements + icons

Hone'у не нужен audio/camera (это Cue), но minimum entitlements для hardened runtime + JIT Electron'а всё равно нужны.

### 1.1 Создать `hone/resources/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

Отличие от Cue: **нет** `device.audio-input` / `disable-library-validation` / `device.camera`. Hone — тихий фокус-тул, не трогает AV.

### 1.2 Icon → `.icns`

`hone/resources/icon.svg` → `icon.icns` (1024x1024 с 9 размерами).

```bash
# Один раз локально (требует librsvg + iconutil на macOS)
mkdir -p /tmp/hone.iconset
for size in 16 32 64 128 256 512 1024; do
  rsvg-convert -w $size -h $size hone/resources/icon.svg \
    > /tmp/hone.iconset/icon_${size}x${size}.png
done
# @2x варианты (доп. требование iconutil для ретина)
cp /tmp/hone.iconset/icon_32x32.png   /tmp/hone.iconset/icon_16x16@2x.png
cp /tmp/hone.iconset/icon_64x64.png   /tmp/hone.iconset/icon_32x32@2x.png
cp /tmp/hone.iconset/icon_256x256.png /tmp/hone.iconset/icon_128x128@2x.png
cp /tmp/hone.iconset/icon_512x512.png /tmp/hone.iconset/icon_256x256@2x.png
cp /tmp/hone.iconset/icon_1024x1024.png /tmp/hone.iconset/icon_512x512@2x.png
iconutil -c icns /tmp/hone.iconset -o hone/resources/icon.icns
```

### 1.3 Обновить `hone/electron-builder.yml`

Добавить entitlements + icon + notarize + publish feed:

```yaml
mac:
  category: public.app-category.productivity
  icon: resources/icon.icns
  target:
    - target: dmg
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
  notarize: true   # electron-builder ≥26 вызывает notarytool сам
  extendInfo:
    CFBundleURLTypes:
      - CFBundleURLName: Hone
        CFBundleURLSchemes: [druz9]

publish:
  - provider: generic
    url: https://hone-updates.druzya.tech/${channel}
    channel: stable
```

---

## 2. Secrets в GitHub

Settings → Environments → `production-hone` → Add secret.

| Secret | Откуда взять | Формат |
|---|---|---|
| `HONE_CSC_LINK` | `base64 -i Developer_ID_hone.p12` → строка | строка |
| `HONE_CSC_KEY_PASSWORD` | пароль от `.p12` (тот что задавался при экспорте) | строка |
| `HONE_APPLE_ID` | твой Apple ID email | email |
| `HONE_APPLE_APP_SPECIFIC_PASSWORD` | сгенерированный `notarytool-hone` | `xxxx-xxxx-xxxx-xxxx` |
| `HONE_APPLE_TEAM_ID` | 10-символьный TEAM_ID | строка |
| `HONE_UPDATES_S3_BUCKET` | имя bucket для auto-update (напр `hone-updates`) | строка |
| `HONE_UPDATES_S3_REGION` | AWS region | напр `eu-north-1` |
| `HONE_UPDATES_AWS_ACCESS_KEY_ID` | IAM user, только `s3:PutObject` на bucket | строка |
| `HONE_UPDATES_AWS_SECRET_ACCESS_KEY` | тот же IAM | строка |
| `HONE_SENTRY_DSN` | из Sentry project settings | URL |
| `VITE_DRUZ9_API_BASE_PROD` | prod backend URL | напр `https://api.druzya.tech` |

**Важно:** `VITE_DRUZ9_DEV_TOKEN` **НЕ** должен быть в prod secrets. Есть явный guard — см [§4](#4-prod-guard-build).

---

## 3. GitHub Actions workflow — `release-hone.yml`

Создать `.github/workflows/release-hone.yml`. Триггерится вручную или по тэгу `hone-v*`.

```yaml
name: Release Hone

on:
  push:
    tags: ['hone-v*']
  workflow_dispatch:
    inputs:
      channel:
        description: 'Release channel'
        required: true
        default: 'beta'
        type: choice
        options: [beta, stable]

jobs:
  build:
    runs-on: macos-14   # arm64 runner — собирает универсальный бинарь
    environment: production-hone
    defaults:
      run:
        working-directory: hone
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: hone/package-lock.json

      # Полный кодоген — hone зависит от frontend/src/api/generated
      - name: Regenerate proto stubs
        working-directory: .
        run: make gen-proto

      - name: Install
        run: npm ci

      - name: Prod build guard
        run: |
          if [ -z "$VITE_DRUZ9_API_BASE" ] || [ -n "$VITE_DRUZ9_DEV_TOKEN" ]; then
            echo "::error::VITE_DRUZ9_API_BASE must be set, VITE_DRUZ9_DEV_TOKEN must be empty" && exit 1
          fi
        env:
          VITE_DRUZ9_API_BASE: ${{ secrets.VITE_DRUZ9_API_BASE_PROD }}
          VITE_DRUZ9_DEV_TOKEN: ''

      - name: Build + sign + notarize
        run: npm run build:mac
        env:
          VITE_DRUZ9_API_BASE: ${{ secrets.VITE_DRUZ9_API_BASE_PROD }}
          VITE_SENTRY_DSN: ${{ secrets.HONE_SENTRY_DSN }}
          CSC_LINK: ${{ secrets.HONE_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.HONE_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.HONE_APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.HONE_APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.HONE_APPLE_TEAM_ID }}

      - name: Publish to S3
        run: |
          CHANNEL="${{ inputs.channel || 'stable' }}"
          aws s3 sync dist/ s3://${{ secrets.HONE_UPDATES_S3_BUCKET }}/$CHANNEL/ \
            --exclude '*' \
            --include '*.dmg' --include '*.blockmap' \
            --include 'latest-mac.yml' --include 'latest-mac-*.yml'
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.HONE_UPDATES_AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.HONE_UPDATES_AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ secrets.HONE_UPDATES_S3_REGION }}

      - uses: actions/upload-artifact@v4
        with:
          name: hone-dmg
          path: hone/dist/*.dmg
          retention-days: 30
```

---

## 4. Prod guard build

В [hone/src/renderer/src/api/config.ts](../hone/src/renderer/src/api/config.ts) добавить runtime-assert в prod-build:

```ts
// Prod safety: dev-token hatch must never leak into a signed build.
if (import.meta.env.PROD && DEV_BEARER_TOKEN !== null) {
  throw new Error('hone: VITE_DRUZ9_DEV_TOKEN leaked into production build');
}
```

Это crash-на-старте если env-var забыт в CI pipeline. Предпочтительно тихой compromise'у.

---

## 5. Backend prep (до релиза)

```bash
# 1. На prod сервере:
ssh deploy@druz9.online
cd /opt/druz9

# 2. Прокатить hone миграции:
docker compose -f infra/docker-compose.prod.yml exec api \
  /app/migrate -path /app/migrations -database "$POSTGRES_DSN" up

# Ожидается: "goose: successfully migrated database to version: 15"

# 3. Проверить что hone endpoints живы:
curl -fsS https://api.druzya.tech/api/v1/hone/stats \
  -H "Authorization: Bearer <свой_токен>" | jq .
# Должно: {"currentStreakDays":0, "longestStreakDays":0, ... heatmap:[]}

# 4. Включить llmchain keys в .env если hone-AI фичи должны работать в prod:
# GROQ_API_KEY, CEREBRAS_API_KEY, OLLAMA_HOST — уже есть для других сервисов
# docker compose restart api
```

Без этого шага Hone будет 503'ить на plan-generate и whiteboard/critique даже у Pro-пользователей.

---

## 6. Auth и deep-links

### 6.1 Yandex OAuth

[oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new) — для существующего druz9-app:

- Добавить redirect URI `druz9://auth/yandex`
- Scope не трогать (уже настроен для web)

### 6.2 Telegram Login

[core.telegram.org/widgets/login](https://core.telegram.org/widgets/login) — настроить бота через BotFather:

```
/setdomain @druz9_bot → druzya.tech (web-redirect)
/newauthuri @druz9_bot → druz9://auth/telegram (desktop-redirect)
```

### 6.3 Runtime handling в Hone

В [hone/src/main/index.ts](../hone/src/main/index.ts) уже есть `routeDeepLink` — он forwarder'ит URL в renderer через `eventChannels.deepLink`. На этапе 5b надо добавить:

- Парсинг `druz9://auth?token=...&refresh=...&expires=...`
- Сохранение в keychain через `keytar` (отдельный handler)
- Переключение на Home / Today после успешного login

---

## 7. Download page + лендинг

На `druz9.ru/download` (в `frontend/`) должно появиться:

```tsx
// frontend/src/pages/Download.tsx (упрощённо)
const macDMG = 'https://hone-updates.druzya.tech/stable/Hone.dmg';
// detect arch → universal DMG auto-routes
<a href={macDMG} download>Download for macOS</a>
```

Не забыть:
- Кнопка должна быть disabled на не-macOS → `/download` redirect на waitlist
- SEO: og:image → `design/hone/landing/brand/og-hone.png`
- Privacy / ToS ссылки (см [§9](#9-legal))

---

## 8. Monitoring

### Sentry

DSN из `HONE_SENTRY_DSN` прокидывается в build через `VITE_SENTRY_DSN`. В `main.tsx` инициализация:

```ts
import * as Sentry from '@sentry/electron/renderer';
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
}
```

(нужно добавить зависимость `@sentry/electron` в `hone/package.json` — Phase 5b)

### Grafana

Добавить dashboard `hone-metrics`:

- `druz9_llm_latency_seconds{task="daily_plan_synthesis"}` p95
- `druz9_llm_latency_seconds{task="sys_design_critique"}` p95
- Cumulative `hone_focus_sessions` created/day (exponential rollup)
- Error-rate на `/api/v1/hone/*` endpoints через existing Prometheus

Dashboard JSON — копировать существующий `copilot-metrics` в `infra/monitoring/grafana/dashboards/`, поменять job labels.

---

## 9. Legal

До публичного запуска:

- [ ] **Terms of Service** — отдельный `.md` в `frontend/src/pages/legal/` + обязательный checkbox при первом запуске Hone
- [ ] **Privacy Policy** — 152-ФЗ clause: «данные хранятся на сервере в РФ, не передаются третьим лицам»
- [ ] **Упоминание что данные Notes/Whiteboard приватны** — их не видит никто кроме пользователя, даже support
- [ ] **Cookie policy** — для лендинга druz9.ru (если ещё нет)
- [ ] **ИП / ООО** — если ещё не оформлен, платежи через Yookassa требуют юр.лицо

---

## 10. Pre-release smoke (за день до запуска)

Собрать `hone-v0.0.1-beta` → прогнать руками:

1. ✅ DMG открывается, drag-to-Applications работает
2. ✅ Первый запуск: Gatekeeper пропускает (не «App is damaged»)
3. ✅ Sparkle `electron-updater` видит feed (`dist/latest-mac.yml` доступен по HTTPS)
4. ✅ Auth flow: login через Yandex → `druz9://auth?token=…` → Hone принимает → Today показывает реальные данные
5. ✅ ⌘K работает, все 5 страниц открываются, `esc` возвращает
6. ✅ Focus session — stop/resume, streak инкрементируется
7. ✅ Stats показывает реальный heatmap из backend (не error)
8. ✅ Outgoing requests идут только на `api.druzya.tech` (проверить через Little Snitch / Proxyman)
9. ✅ Sentry получает тестовую ошибку при force-throw в DevTools
10. ✅ Second install на другой Mac — auto-update триггерит от `0.0.1` → `0.0.2` когда опубликуешь fake-upgrade

---

## 11. День релиза

```bash
# 1. Финальный tag:
git tag hone-v0.1.0
git push origin hone-v0.1.0

# 2. GitHub Actions → Release Hone → Run workflow → channel=stable
# Ждёшь ~8 минут (build + sign + notarize + S3 upload)

# 3. Проверь что на S3 появились:
# - Hone-0.1.0-arm64.dmg, Hone-0.1.0-x64.dmg
# - latest-mac.yml, latest-mac-arm64.yml

# 4. Обнови druz9.ru/download ссылку:
# (frontend deploy pipeline — см DEPLOYMENT.md)

# 5. Мониторь Sentry первые 24 часа — любая новая error-группа → hot-fix tag 0.1.1
```

---

## 12. Rollback

Если релиз сломан и уже у юзеров:

```bash
# Вариант 1: откатить latest-mac.yml на предыдущий SHA
aws s3 cp s3://hone-updates/stable/latest-mac.yml.v0.0.9 \
          s3://hone-updates/stable/latest-mac.yml

# Это заставит existing installs на 0.1.0 ИГНОРИРОВАТЬ feed
# (их версия уже выше чем 0.0.9), и новые скачивания получат 0.0.9.

# Вариант 2 (если версия 0.1.0 активно крашит): опубликовать 0.1.1 hotfix
# с тем же кодом что 0.0.9 но версией 0.1.1 → auto-update подтянет.
```

**Anti-pattern:** удалять `.dmg` файлы с S3. Existing installs могут их запросить через auto-update feed и получить 404 → white screen.

---

## 13. Post-release (неделя 1)

- Day 1: Sentry sweep — 0 critical errors
- Day 2: installation funnel analytics — conversion landing → install → first-day-active
- Day 3-7: D1 / D3 / D7 retention cohort для beta users
- Day 7: решение «остаёмся на `beta` канале ещё на 2 недели» vs «открываем `stable`»

Если D7 < 20% — hot-fix UX перед открытием stable. Если > 25% — открываем stable через workflow_dispatch с `channel=stable`.

---

## 14. Parking (Year 1 Q3+)

- **Windows build** — `electron-builder --win --nsis`, EV code-sign cert ($300-600/год), отдельный workflow `release-hone-win.yml`, отдельный update-feed для `.exe`
- **Linux `.AppImage`** — best-effort, не приоритет
- **Mac App Store submission** — отдельный `appStoreConnect` target в electron-builder (не нужен если DMG-путь через свой CDN работает)
