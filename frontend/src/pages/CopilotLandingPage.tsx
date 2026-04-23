// CopilotLandingPage — public marketing landing for the new desktop product
// (Wave-13, design from /Users/sedorofeevd/Downloads/_export/
// "Druz9 Copilot Landing.html").
//
// Mounted at /copilot. Public route — works without auth (uses MinimalTopBar
// pattern from WelcomePage so we don't blast the AppShell admin probe at
// unauthenticated visitors).
//
// Anti-fallback: download CTAs link to a `data-download="dmg"` href that's
// currently `#` because the user hasn't shipped the .dmg URL yet. When the
// real URL lands, swap the constant DOWNLOAD_URL — single source of truth.
// NEVER fake a download (would 404 silently otherwise).
//
// Sections (all from the source HTML, ported with our design tokens where
// possible while preserving the pixel-perfect violet→cyan brand of Copilot):
//   1. Hero with macOS window mock
//   2. Download options (main .dmg + Homebrew + Intel + previous versions)
//   3. Features grid (6 reasons)
//   4. Comparison (ChatGPT-tab vs Copilot)
//   5. Pricing (Free / Pro / Team)
//   6. FAQ
//   7. Final CTA
//   8. Footer

import { Link } from 'react-router-dom'
import {
  Download,
  Check,
  Zap,
  Shield,
  KeyRound,
  Command,
  EyeOff,
  Database,
  Search,
  ArrowRight,
  MousePointer2,
  Layers,
  Sparkles,
  FileBarChart,
} from 'lucide-react'
import { cn } from '../lib/cn'

// One source of truth for the .dmg URL. When the real artifact ships,
// flip this to the GHCR-release / S3 / direct host URL. Until then it's
// honestly broken — clicking shows the user the link is "coming soon"
// rather than 404'ing a fake download.
const DOWNLOAD_URL = '#download-coming-soon'
const VERSION = '1.4.0'
const SIZE = '24 MB'

function MinimalTopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-5 border-b border-border bg-bg/85 px-6 backdrop-blur">
      <Link to="/welcome" className="flex items-center gap-2 font-display text-[15px] font-semibold text-text-primary">
        <CopilotMark size="sm" />
        druz9
      </Link>
      <nav className="ml-3 hidden gap-1 sm:flex">
        {['Sanctum', 'Arena', 'Atlas', 'Кодекс'].map((label) => (
          <Link
            key={label}
            to="/welcome"
            className="rounded-md px-3 py-1.5 text-[13.5px] text-text-muted hover:bg-surface-2 hover:text-text-primary"
          >
            {label}
          </Link>
        ))}
        <span className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-[13.5px] font-semibold text-text-primary">
          Copilot
          <span className="rounded-md bg-gradient-to-br from-accent to-cyan px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white">
            NEW
          </span>
        </span>
      </nav>
      <Link
        to="/welcome"
        className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] text-text-secondary hover:bg-surface-2"
      >
        ← к druz9.online
      </Link>
    </header>
  )
}

// Reusable mark — accent→cyan gradient circle with white "9" inside.
// Three sizes used across the page; exposed here so embeds elsewhere
// reuse the same primitive.
function CopilotMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const px = size === 'sm' ? 26 : size === 'md' ? 44 : size === 'lg' ? 56 : 72
  return (
    <span
      aria-hidden="true"
      className="grid place-items-center rounded-full font-display font-extrabold text-white"
      style={{
        width: px,
        height: px,
        background: 'linear-gradient(135deg, rgb(124,92,255) 0%, rgb(76,139,255) 100%)',
        boxShadow: '0 0 0 0.5px rgba(255,255,255,0.2), 0 1px 0 rgba(255,255,255,0.22) inset',
        fontSize: Math.round(px * 0.5),
      }}
    >
      9
    </span>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-7 pb-12 pt-20 sm:pt-[84px]">
      {/* Background glow + grid */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-250px] h-[700px] w-[1100px] -translate-x-1/2"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(124,92,255,0.2), transparent 60%)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, black 30%, transparent 75%)',
        }}
      />

      <div className="relative mx-auto max-w-[1200px] text-center">
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-accent-hover">
          <span className="grid h-1.5 w-1.5 place-items-center rounded-full bg-success shadow-[0_0_8px_rgb(52,199,89)]" />
          Новый продукт · macOS 14+
        </span>
        <h1
          className="mx-auto mt-6 max-w-[900px] text-balance font-display font-semibold text-text-primary"
          style={{ fontSize: 'clamp(40px, 7vw, 72px)', lineHeight: 1.02, letterSpacing: '-0.0333em' }}
        >
          Невидимый AI-напарник,
          <br />
          <span
            style={{
              background: 'linear-gradient(135deg, #AF9BFF, #4C8BFF 60%, #7EB6FF)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            который исчезает на демо.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-pretty text-[19px] leading-[1.5] text-text-secondary">
          Druz9 Copilot живёт поверх всех окон, отвечает за 1.2 секунды и пропадает, когда вы шарите экран. Для разработчиков, которые хотят AI рядом — но не в кадре.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={DOWNLOAD_URL}
            data-download="dmg"
            className="inline-flex h-13 items-center gap-2.5 rounded-xl px-6 font-semibold text-white shadow-glow transition-transform hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))',
              height: 52,
            }}
          >
            <Download className="h-4 w-4" />
            Скачать для macOS
            <span className="rounded-md border border-border bg-white/[0.06] px-2 py-0.5 font-mono text-[11.5px] text-text-secondary">
              .dmg · {SIZE}
            </span>
          </a>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-6 font-semibold text-text-primary transition-transform hover:-translate-y-0.5"
            style={{ height: 52 }}
          >
            Посмотреть демо · 1:20
          </button>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-6 text-[12.5px] text-text-muted">
          <div>
            <span className="mr-1 text-success">●</span>Бесплатно · 20 запросов в день
          </div>
          <div>Apple Silicon + Intel</div>
          <div>Notarized · macOS 14+</div>
        </div>
      </div>

      {/* macOS window mock */}
      <div className="relative mx-auto mt-[72px] max-w-[1040px] px-7">
        <div
          className="relative w-full overflow-hidden rounded-2xl border border-border"
          style={{
            background: 'linear-gradient(180deg, #1A1A1C, #121214)',
            boxShadow: '0 60px 120px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.02) inset',
          }}
        >
          <div
            className="flex h-9 items-center gap-2 border-b border-border px-3.5"
            style={{ background: 'linear-gradient(180deg, #1F1F22, #17171A)' }}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: '#FF5F57' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#FEBC2E' }} />
            <span className="h-3 w-3 rounded-full" style={{ background: '#28C840' }} />
            <span className="mx-auto font-mono text-[12px] text-text-muted">druz9 · copilot</span>
            <span className="w-[42px]" />
          </div>
          <div className="grid min-h-[440px] grid-cols-1 lg:grid-cols-[220px_1fr]">
            <aside className="hidden border-r border-border bg-black/20 p-3 lg:block">
              <div className="px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-muted">
                История
              </div>
              {['useEffect зависимости', 'SQL JOIN vs subquery', 'Docker multi-stage', 'Rust lifetimes'].map((title, i) => (
                <div
                  key={title}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px]',
                    i === 0 ? 'bg-accent/15 text-text-primary' : 'text-text-secondary',
                  )}
                >
                  <span className="font-mono text-[10px] text-text-muted">▸</span>
                  {title}
                </div>
              ))}
              <div className="mt-3 px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-muted">
                Провайдеры
              </div>
              {[
                { name: 'GPT-4o', dot: 'bg-success' },
                { name: 'Claude Opus', dot: 'bg-accent-hover' },
                { name: 'Gemini 2.5', dot: 'bg-text-muted' },
              ].map((p) => (
                <div key={p.name} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-text-secondary">
                  <span className={cn('h-2 w-2 rounded-full', p.dot)} />
                  {p.name}
                </div>
              ))}
            </aside>
            <div className="flex flex-col gap-3.5 p-5 sm:p-7">
              <div
                className="ml-auto max-w-[80%] rounded-xl px-3.5 py-3 text-[13.5px] leading-relaxed text-white shadow-[0_6px_16px_rgba(124,92,255,0.3)]"
                style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
              >
                Почему useEffect в этом компоненте ререндерится в бесконечном цикле?
              </div>
              <div className="max-w-[80%] rounded-xl border border-border bg-white/[0.03] px-3.5 py-3 text-[13.5px] leading-relaxed text-text-primary">
                Массив зависимостей содержит объект{' '}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12px] text-accent-hover">
                  {'{ id }'}
                </code>
                , который создаётся заново при каждом рендере. React сравнивает его по ссылке — и триггерит эффект снова.
                <pre
                  className="mt-2 overflow-x-auto rounded-lg border border-border p-3 font-mono text-[12px] leading-[1.6] text-text-secondary"
                  style={{ background: '#0C0C0E' }}
                >
                  <span className="text-text-muted">{'// ❌ бесконечный цикл'}</span>
                  {'\n'}useEffect(<span className="text-accent-hover">() =&gt;</span> {'{ fetchData(user) }'}, [user])
                  {'\n\n'}
                  <span className="text-text-muted">{'// ✅ зависимость по примитиву'}</span>
                  {'\n'}useEffect(<span className="text-accent-hover">() =&gt;</span> {'{ fetchData(user) }'}, [user.<span className="text-cyan">id</span>])
                </pre>
              </div>
              <div className="mt-auto flex items-center gap-2 rounded-lg border border-border bg-white/[0.03] px-3 py-2.5">
                <Search className="h-3.5 w-3.5 text-text-muted" />
                <span className="flex-1 text-[13px] text-text-muted">Спроси что угодно…</span>
                <span className="rounded-md border border-border bg-white/[0.04] px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                  ⌘ ⇧ Space
                </span>
              </div>
            </div>
          </div>
        </div>
        {/* hero sparkle below window */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-10 left-1/2 h-20 w-[85%] -translate-x-1/2"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(124,92,255,0.35), transparent 70%)',
            filter: 'blur(30px)',
          }}
        />
      </div>
    </section>
  )
}

function DownloadSection() {
  return (
    <section className="border-t border-border px-7 py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10">
          <h2 className="text-balance font-display text-[40px] font-semibold leading-tight text-text-primary" style={{ letterSpacing: '-0.025em' }}>
            Скачать для macOS
          </h2>
          <p className="mt-2 max-w-[580px] text-[16px] leading-[1.55] text-text-secondary">
            Один .dmg для Apple Silicon и Intel. Подписан Developer ID, нотаризован Apple. Автообновления из самого приложения.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div
            className="relative overflow-hidden rounded-2xl border border-accent/25 p-9"
            style={{
              background:
                'linear-gradient(135deg, rgba(124,92,255,0.12), rgba(76,139,255,0.08))',
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -top-24 h-[400px] w-[400px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(124,92,255,0.3), transparent 60%)' }}
            />
            <div className="relative">
              <div className="mb-4 inline-flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.08em] text-accent-hover">
                <svg width="15" height="18" viewBox="0 0 170 200" fill="currentColor">
                  <path d="M130 105c0-25 20-37 21-38-12-17-30-19-36-19-15-2-30 9-38 9-8 0-20-9-33-9-17 0-32 10-41 26-18 31-4 77 13 102 9 12 19 26 33 25 13 0 18-8 34-8 15 0 20 8 34 8 14 0 23-13 32-25 10-14 14-27 15-28-1 0-29-11-29-43zM105 35c7-9 12-21 10-33-11 0-23 7-30 16-7 8-13 20-11 31 12 1 24-6 31-14z" />
                </svg>
                macOS 14 Sonoma+ · Universal
              </div>
              <div className="font-display text-[28px] font-semibold tracking-tight text-text-primary">
                Druz9 Copilot {VERSION}
              </div>
              <p className="mt-2 max-w-[400px] text-[14px] leading-[1.55] text-text-secondary">
                Полная версия. Запускается на Apple Silicon (M1/M2/M3/M4) и Intel. Автоматическое обновление через Sparkle.
              </p>
              <div className="mt-7">
                <a
                  href={DOWNLOAD_URL}
                  data-download="dmg"
                  className="inline-flex items-center gap-2 rounded-xl px-6 py-3.5 font-semibold text-white shadow-glow transition-transform hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
                >
                  <Download className="h-4 w-4" />
                  Скачать Druz9-Copilot-{VERSION}.dmg
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-6 font-mono text-[12px] text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  {SIZE}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="h-3 w-3" />
                  SHA256 verified
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-3 w-3" />
                  Notarized
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {[
              {
                title: 'Homebrew',
                desc: 'brew install --cask druz9-copilot',
                icon: Shield,
              },
              {
                title: 'Intel build',
                desc: 'x86_64 · 26 MB',
                icon: Database,
              },
              {
                title: 'Предыдущие версии',
                desc: 'Changelog + архив билдов',
                icon: Download,
              },
            ].map((row) => {
              const Icon = row.icon
              return (
                <a
                  key={row.title}
                  href="#"
                  className="flex items-center gap-4 rounded-xl border border-border bg-white/[0.02] p-5 hover:bg-white/[0.04]"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-white/[0.04] text-text-secondary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-text-primary">{row.title}</div>
                    <div className="mt-0.5 truncate font-mono text-[11.5px] tracking-wide text-text-muted">{row.desc}</div>
                  </div>
                  <span className="text-text-muted">→</span>
                </a>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function FeaturesGrid() {
  // Wave-13 feature roster — expanded per user request to highlight the
  // five distinguishing capabilities the team wants on the landing page.
  // Keep the four original differentiators that don't overlap with the
  // new ones (speed, BYOK, hotkey, local history) so the grid stays
  // honest — anti-fallback, no marketing fluff.
  const features = [
    {
      icon: EyeOff,
      title: 'Защита от записи',
      desc:
        'Приложение невидимо при демонстрации экрана, не мешает взаимодействию с приложениями под ним и управляется горячими клавишами.',
    },
    {
      icon: Sparkles,
      title: 'Все ИИ-провайдеры',
      desc:
        'Используете те модели, которые нравятся лично вам — OpenAI, Claude, Gemini, Grok и другие.',
    },
    {
      icon: MousePointer2,
      title: 'Виртуальный курсор',
      desc:
        'Пока вы взаимодействуете с Druz9 Copilot или делаете скриншот области — собеседник видит замороженный курсор. Включается по Ctrl/Cmd+Shift+V или автоматически.',
    },
    {
      icon: Layers,
      title: 'Полная мимикрия и скрытность',
      desc:
        'Настройте приложение так, чтобы оно выглядело как любое другое — мессенджер, заметки или IDE. Даже в диспетчере задач отображается под выбранным именем.',
    },
    {
      icon: FileBarChart,
      title: 'Пост-анализ собеседования',
      desc:
        'После каждого собеседования генерируем детальный разбор: слабые зоны, ошибки в ответах и конкретные рекомендации по улучшению.',
    },
    {
      icon: Zap,
      title: 'Ответ за 1.2 с',
      desc: 'Стриминг от первого токена. Запрос идёт прямо к провайдеру, без транзита через наш сервер.',
    },
    {
      icon: KeyRound,
      title: 'Ключи в Keychain',
      desc:
        'BYOK — свой OpenAI / Anthropic ключ шифруется локально. На наш сервер ничего не уходит. Можно вообще не платить нам.',
    },
    {
      icon: Command,
      title: 'Горячая клавиша',
      desc:
        '⌘⇧Space — окно рядом с курсором. Поверх IDE, Slack, браузера. ⌘⇧S — скриншот области с вопросом.',
    },
    {
      icon: Database,
      title: 'Вся история локально',
      desc:
        'Все диалоги — в SQLite на диске. Поиск, экспорт в Markdown, fuzzy-match. Никакой синхронизации, пока сами не попросите.',
    },
  ]
  return (
    <section className="border-t border-border px-7 py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10">
          <h2 className="text-balance font-display text-[40px] font-semibold text-text-primary" style={{ letterSpacing: '-0.025em' }}>
            Девять причин поставить
          </h2>
          <p className="mt-2 max-w-[580px] text-[16px] leading-[1.55] text-text-secondary">
            Сделан под workflow разработчика и собеса: невидим на демо, любой провайдер ИИ, виртуальный курсор и пост-анализ.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="rounded-2xl border border-border bg-white/[0.02] p-7">
                <span className="mb-3.5 grid h-10 w-10 place-items-center rounded-lg border border-accent/25 bg-accent/15 text-accent-hover">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="font-display text-[16px] font-semibold tracking-tight text-text-primary">{f.title}</div>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-text-secondary">{f.desc}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function Comparison() {
  return (
    <section className="border-t border-border px-7 py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10">
          <h2 className="text-balance font-display text-[40px] font-semibold text-text-primary" style={{ letterSpacing: '-0.025em' }}>
            Чем отличается от ChatGPT-вкладки
          </h2>
          <p className="mt-2 max-w-[580px] text-[16px] leading-[1.55] text-text-secondary">
            Браузер — это место работы. А Copilot — это место, где спрашиваешь, не уходя с рабочего места.
          </p>
        </div>
        <div className="grid gap-3.5 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-white/[0.02] p-7">
            <div className="mb-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
              Обычный чат в браузере
            </div>
            <h3 className="mb-4 font-display text-[22px] font-semibold tracking-tight text-text-primary">ChatGPT в новой вкладке</h3>
            <ul className="flex flex-col gap-3">
              {[
                'Нужно переключать окно, терять фокус',
                'Видно всем на демо экрана',
                'История — на чужом сервере',
                'Ключ уходит через их OAuth',
                'Одна модель на аккаунт',
              ].map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-[1.45] text-text-muted">
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[11px] font-bold text-text-muted">
                    ×
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div
            className="rounded-2xl border border-accent/30 p-7"
            style={{
              background: 'linear-gradient(135deg, rgba(124,92,255,0.14), rgba(76,139,255,0.08))',
            }}
          >
            <div className="mb-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-accent-hover">
              Druz9 Copilot · {VERSION}
            </div>
            <h3 className="mb-4 font-display text-[22px] font-semibold tracking-tight text-text-primary">Нативный Mac-компаньон</h3>
            <ul className="flex flex-col gap-3">
              {[
                'Защита от записи: невидим в Zoom/Meet/QuickTime',
                'Виртуальный курсор: собеседник видит «замороженный»',
                'Полная мимикрия: маскируется под мессенджер / IDE / заметки',
                'Любой провайдер: OpenAI, Claude, Gemini, Grok — ваш выбор',
                'Пост-анализ собеса: разбор слабых зон + рекомендации',
                'Ключ в Keychain, BYOK · история локально в SQLite',
              ].map((line) => (
                <li key={line} className="flex gap-2.5 text-[14px] leading-[1.45] text-text-primary">
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
                  >
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: '0 ₽',
      period: '/мес',
      desc: 'Для тех, кто пробует. И остаётся надолго.',
      features: ['20 запросов в день', 'GPT-4o mini, Claude Haiku', 'Stealth, маскировка, хоткеи', 'История локально', 'BYOK — свой ключ без лимитов'],
      cta: 'Скачать',
      featured: false,
    },
    {
      name: 'Pro',
      price: '690 ₽',
      period: '/мес',
      desc: 'Все топовые модели. Без лимитов. Одна подписка.',
      features: ['Безлимит на всех моделях', 'GPT-4o, Claude Opus, o1, Gemini 2.5', 'Приоритетный RPS', 'iCloud-sync между Mac', 'Приоритетная поддержка'],
      cta: 'Попробовать 7 дней',
      featured: true,
    },
    {
      name: 'Team',
      price: '1 890 ₽',
      period: '/место',
      desc: 'Для команд, которым нужен общий биллинг.',
      features: ['Всё из Pro', 'SSO · Google, Yandex, SAML', 'Общий биллинг и расход', 'Админ-консоль', 'Отдельный SLA'],
      cta: 'Связаться',
      featured: false,
    },
  ]
  return (
    <section className="border-t border-border px-7 py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10">
          <h2 className="text-balance font-display text-[40px] font-semibold text-text-primary" style={{ letterSpacing: '-0.025em' }}>
            Тарифы
          </h2>
          <p className="mt-2 max-w-[580px] text-[16px] leading-[1.55] text-text-secondary">
            Бесплатно — всё ядро. Pro — снятые лимиты и премиум-модели. Team — SSO и общий биллинг.
          </p>
        </div>
        <div className="grid gap-3.5 md:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className={cn(
                'relative flex flex-col rounded-2xl border p-7',
                p.featured ? 'border-accent/30' : 'border-border bg-white/[0.02]',
              )}
              style={
                p.featured
                  ? { background: 'linear-gradient(135deg, rgba(124,92,255,0.16), rgba(76,139,255,0.1))' }
                  : undefined
              }
            >
              {p.featured && (
                <span
                  className="absolute -top-2.5 right-5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-white"
                  style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
                >
                  Популярный
                </span>
              )}
              <div className="font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-text-secondary">
                {p.name}
              </div>
              <div className="mt-3 font-display text-[42px] font-semibold tracking-[-0.0286em] text-text-primary">
                {p.price}
                <span className="ml-1 text-[15px] font-normal text-text-muted">{p.period}</span>
              </div>
              <p className="mt-2 text-[13px] leading-[1.5] text-text-secondary">{p.desc}</p>
              <ul className="mt-5 mb-6 flex flex-1 flex-col gap-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2 text-[13px] leading-[1.45] text-text-primary">
                    <span className="mt-0.5 text-accent-hover">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold transition-transform hover:-translate-y-0.5',
                  p.featured ? 'text-white shadow-glow' : 'border border-border bg-surface-1 text-text-primary',
                )}
                style={
                  p.featured
                    ? { background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }
                    : undefined
                }
              >
                {p.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const items = [
    { q: 'Почему только macOS?', a: 'Stealth-режим завязан на приватные API WindowServer. Версии для Windows и Linux — в работе, ждём по почте.' },
    { q: 'Данные уходят на ваш сервер?', a: 'Нет. При BYOK всё идёт напрямую к провайдеру модели. Телеметрии нет. Отключается в настройках вообще вся аналитика.' },
    { q: 'Как установить?', a: 'Скачайте .dmg, перетащите в Applications, подтвердите «Открыть» в Gatekeeper. macOS может попросить разрешения Accessibility и Screen Recording — это нужно для скриншот-вопросов и stealth.' },
    { q: 'Работает офлайн?', a: 'Через Ollama — да. Подключаете локальную Llama-3 / Qwen / DeepSeek и задаёте вопросы без интернета. История всегда локальна.' },
    { q: 'Можно вернуть деньги?', a: 'Да, в течение 14 дней без вопросов. Напишите support@druz9.online — вернём в тот же день.' },
    { q: 'Что с остальными продуктами druz9?', a: 'Sanctum, Arena, Kata и Codex продолжают работать как раньше. Copilot — отдельный десктоп, ссылка на него появится и в основном приложении.' },
  ]
  return (
    <section className="border-t border-border px-7 py-24">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-10">
          <h2 className="text-balance font-display text-[40px] font-semibold text-text-primary" style={{ letterSpacing: '-0.025em' }}>
            Частые вопросы
          </h2>
          <p className="mt-2 max-w-[580px] text-[16px] leading-[1.55] text-text-secondary">
            Если что-то не нашлось — напишите в Telegram, отвечаем в течение часа.
          </p>
        </div>
        <div className="grid gap-3.5 md:grid-cols-2">
          {items.map((qa) => (
            <div key={qa.q} className="rounded-xl border border-border bg-white/[0.02] px-6 py-5">
              <div className="font-display text-[15px] font-semibold tracking-tight text-text-primary">{qa.q}</div>
              <p className="mt-2 text-[13.5px] leading-[1.55] text-text-secondary">{qa.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-border px-7 pt-24 pb-16">
      <div className="mx-auto max-w-[1200px]">
        <div
          className="relative overflow-hidden rounded-3xl border border-accent/30 px-8 py-16 text-center sm:px-16"
          style={{
            background: 'linear-gradient(135deg, rgba(124,92,255,0.2), rgba(76,139,255,0.14))',
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at 50% 0%, rgba(124,92,255,0.3), transparent 60%)',
            }}
          />
          <div className="relative">
            <h2 className="text-balance font-display text-[44px] font-semibold leading-tight text-text-primary" style={{ letterSpacing: '-0.0227em' }}>
              Попробуй за первый вопрос.
            </h2>
            <p className="mx-auto mt-4 max-w-[560px] text-[16px] text-text-secondary">
              Без регистрации. 20 бесплатных запросов в день — больше, чем нужно, чтобы понять, стоит ли это вашего внимания.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href={DOWNLOAD_URL}
                data-download="dmg"
                className="inline-flex items-center gap-2 rounded-xl px-6 py-3 font-semibold text-white shadow-glow transition-transform hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg, rgb(124,92,255), rgb(76,139,255))' }}
              >
                <Download className="h-4 w-4" />
                Скачать для macOS · {SIZE}
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-6 py-3 font-semibold text-text-primary"
              >
                Посмотреть changelog
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CopilotFooter() {
  return (
    <footer className="border-t border-border px-7 py-10 text-[12px] text-text-muted">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4">
        <div>© 2026 druz9 · Copilot {VERSION}</div>
        <nav className="flex flex-wrap gap-5">
          <a href="#">Политика</a>
          <a href="#">Оферта</a>
          <a href="#">Связь</a>
          <a href="#">Changelog</a>
        </nav>
      </div>
    </footer>
  )
}

export default function CopilotLandingPage() {
  return (
    <div className="min-h-screen bg-bg text-text-primary" style={{ fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <MinimalTopBar />
      <Hero />
      <DownloadSection />
      <FeaturesGrid />
      <Comparison />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <CopilotFooter />
    </div>
  )
}

// Mark export — re-used by CopilotPromoBanner if it ever needs the same
// primitive (kept un-exported for now since the banner has its own embedded
// gradient mark sized for the strip).
export { CopilotMark, ArrowRight as _ArrowRight }
