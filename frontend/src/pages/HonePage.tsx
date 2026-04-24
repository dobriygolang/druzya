// HonePage — public marketing landing для Hone, desktop focus cockpit.
//
// Путь /hone. Публичный роут (без auth-gate'а). Структура параллельна
// CopilotLandingPage — Hero → Features → How-it-works → Pricing → FAQ →
// Download CTA. Кнопки "Download" указывают на GitHub Release (HONE_DMG_URL
// env-override для staging).
//
// Тип: Winter-эстетика (чёрный + белый + красная точка), выдержано
// под брендовой гайд Hone — без cyan/violet Copilot-градиентов.
import { Link } from 'react-router-dom'
import {
  Download,
  Apple,
  Check,
  Sparkles,
  Compass,
  Focus as FocusIcon,
  FileText,
  Pencil,
  Flame,
  ArrowRight,
  Shield,
  Command,
} from 'lucide-react'

// ENV-override для staging; production — GitHub Release URL читается из
// publish-config electron-updater'а, но для landing-кнопки нужна прямая
// ссылка на latest DMG.
const DOWNLOAD_URL_ARM =
  (import.meta.env.VITE_HONE_DMG_ARM64 as string | undefined) ??
  'https://github.com/druz9/hone/releases/latest'
const DOWNLOAD_URL_X64 =
  (import.meta.env.VITE_HONE_DMG_X64 as string | undefined) ??
  'https://github.com/druz9/hone/releases/latest'

function HoneMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 26 : size === 'md' ? 44 : 64
  return (
    <span
      aria-hidden="true"
      className="grid place-items-center rounded-sm border border-white/20 bg-black font-mono font-bold text-white"
      style={{
        width: px,
        height: px,
        fontSize: Math.round(px * 0.5),
      }}
    >
      H
    </span>
  )
}

function MinimalTopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-5 border-b border-white/10 bg-black/85 px-6 backdrop-blur">
      <Link to="/welcome" className="flex items-center gap-2 font-display text-[15px] font-semibold text-white">
        <HoneMark size="sm" />
        druz9
      </Link>
      <nav className="ml-3 hidden gap-1 sm:flex">
        {[
          { label: 'Sanctum', to: '/welcome' },
          { label: 'Arena', to: '/welcome' },
          { label: 'Atlas', to: '/welcome' },
          { label: 'Copilot', to: '/copilot' },
        ].map(({ label, to }) => (
          <Link
            key={label}
            to={to}
            className="rounded-md px-3 py-1.5 text-[13.5px] text-white/60 hover:bg-white/5 hover:text-white"
          >
            {label}
          </Link>
        ))}
        <span className="ml-1 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[13.5px] font-semibold text-white">
          Hone
          <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-black">
            NEW
          </span>
        </span>
      </nav>
      <Link
        to="/welcome"
        className="ml-auto inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] text-white/70 hover:bg-white/10"
      >
        ← к druz9.online
      </Link>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-7 pb-12 pt-20 sm:pt-[84px]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-250px] h-[700px] w-[1100px] -translate-x-1/2"
        style={{ background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.06), transparent 60%)' }}
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
      <div className="relative mx-auto flex max-w-[960px] flex-col items-center gap-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-white/50">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          PUBLIC BETA · macOS
        </div>
        <h1 className="font-display text-[46px] font-normal leading-[1.04] tracking-[-0.025em] text-white sm:text-[64px] lg:text-[76px]">
          Sharpen your craft.
          <br />
          <span className="text-white/55">Every day. Quietly.</span>
        </h1>
        <p className="max-w-[520px] text-[15px] leading-[1.65] text-white/65 sm:text-[16px]">
          Hone — тихий focus cockpit для разработчика. AI-план дня, pomodoro со
          streak'ом, приватные заметки с автосвязями, whiteboard с AI-критиком.
          Одна подписка на всю экосистему druz9.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={DOWNLOAD_URL_ARM}
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Download for Apple Silicon
          </a>
          <a
            href={DOWNLOAD_URL_X64}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-[13.5px] font-semibold text-white hover:bg-white/5"
          >
            <Apple className="h-4 w-4" />
            Intel Mac
          </a>
        </div>
        <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
          ONE ACCOUNT · ONE SUBSCRIPTION · THREE SURFACES
        </div>
      </div>
    </section>
  )
}

interface FeatureTile {
  icon: React.ReactNode
  title: string
  desc: string
}

const FEATURES: FeatureTile[] = [
  {
    icon: <Compass className="h-5 w-5" />,
    title: 'Today',
    desc: 'AI-план из Skill Atlas — 3–5 пунктов с мотивирующим объяснением «это закрывает твой gap в X».',
  },
  {
    icon: <FocusIcon className="h-5 w-5" />,
    title: 'Focus',
    desc: 'Pomodoro с pinned task + streak. После сессии — одна строка «что сделал», сохраняется как заметка.',
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: 'Notes',
    desc: 'Приватный markdown. ⌘J — AI-подборка связанных заметок через embeddings. Никогда не шарится.',
  },
  {
    icon: <Pencil className="h-5 w-5" />,
    title: 'Whiteboard',
    desc: 'tldraw-canvas + ⌘E запускает AI-критика (как senior-архитектор). Сохраняй выводы как заметку.',
  },
  {
    icon: <Flame className="h-5 w-5" />,
    title: 'Streak',
    desc: 'Тихий heatmap 182 дня. Никаких push-нотификаций, никаких vanity-метрик. Только focused hours.',
  },
  {
    icon: <Command className="h-5 w-5" />,
    title: '⌘K',
    desc: 'Keyboard-first. Все действия через палетку. T/F/N/D/S — прямые шорткаты. Esc возвращает в пустоту.',
  },
]

function Features() {
  return (
    <section className="px-7 py-20">
      <div className="mx-auto max-w-[1100px]">
        <h2 className="text-center font-display text-[34px] font-normal tracking-[-0.02em] text-white sm:text-[44px]">
          Одна поверхность, четыре модуля.
        </h2>
        <p className="mx-auto mt-4 max-w-[560px] text-center text-[14px] text-white/60">
          Winter-эстетика × druz9 AI. Приватные заметки живут у тебя, фокус
          синхронизируется с web-стата́ми, статистика обновляется тихо.
        </p>
        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col gap-3 bg-black p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-white/80">
                {f.icon}
              </div>
              <div className="font-display text-[18px] font-medium text-white">{f.title}</div>
              <p className="text-[13.5px] leading-[1.55] text-white/60">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const beats = [
    { t: '07:00', title: 'Open Hone.', sub: 'AI builds your plan.' },
    { t: '09:30', title: 'Focus session.', sub: 'Solve on druz9.ru.' },
    { t: '13:00', title: 'Capture a note.', sub: '⌘N, one paragraph.' },
    { t: '18:00', title: 'Close the day.', sub: 'Streak ticks. Quietly.' },
  ]
  return (
    <section className="border-t border-white/5 bg-black px-7 py-20">
      <div className="mx-auto max-w-[1100px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
          THE RITUAL
        </div>
        <h2 className="mt-3 font-display text-[32px] font-normal tracking-[-0.02em] text-white sm:text-[44px]">
          One day in the life.
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {beats.map((b) => (
            <div key={b.t} className="border-t border-white/10 pt-4">
              <div className="font-mono text-[10px] tracking-[0.2em] text-white/40">{b.t}</div>
              <div className="mt-3 text-[18px] tracking-[-0.01em] text-white">{b.title}</div>
              <div className="mt-1 text-[13.5px] text-white/60">{b.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  const bullets = [
    'AI-план дня (Skill Atlas)',
    'AI-критика Whiteboard',
    'Приватные заметки + ⌘J connections (embeddings)',
    'Daily standup',
    'Reflection-заметки после pomodoro',
    'Cue stealth copilot',
    'Arena Pro, mock interviews',
  ]
  return (
    <section id="pricing" className="px-7 py-20">
      <div className="mx-auto max-w-[720px] text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
          ONE PRICE, EVERYTHING INCLUDED
        </div>
        <h2 className="mt-3 font-display text-[34px] font-normal tracking-[-0.02em] text-white sm:text-[44px]">
          druz9 Pro — 790 ₽ / месяц.
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[14px] leading-[1.6] text-white/60">
          Одна подписка открывает AI во всей экосистеме: Hone, Cue, Arena Pro.
          Free — оболочка Hone без AI, базовый druz9.ru. Без email-паролей.
        </p>
        <div className="mx-auto mt-10 max-w-[480px] rounded-xl border border-white/10 bg-white/5 p-7 text-left">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[40px] font-medium text-white">790 ₽</span>
            <span className="text-[13px] text-white/50">/ месяц</span>
          </div>
          <ul className="mt-5 space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-[13.5px] text-white/80">
                <Check className="h-4 w-4 text-white/80" />
                {b}
              </li>
            ))}
          </ul>
          <Link
            to="/welcome?next=/pricing"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            Start free, upgrade later
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}

function FAQ() {
  const qs = [
    {
      q: 'Hone работает без интернета?',
      a: 'Pomodoro, заметки, whiteboard — да. AI-фичи (план, критика, connections) требуют сети. Когда сеть недоступна — деградируем корректно (503), не выдумываем fake-результат.',
    },
    {
      q: 'Приватность заметок.',
      a: 'Заметки и whiteboard-состояние хранятся в БД druz9 под твоим аккаунтом, encrypted at rest. Никогда не попадают в Arena / рейтинг / leaderboard\u2019ы. Embeddings для ⌘J считаются серверно (bge-small) — сам текст не пересылается третьим сторонам.',
    },
    {
      q: 'Windows / Linux?',
      a: 'macOS (Apple Silicon + Intel) — в first release. Windows — Q3 2026. Linux — follow-up после Windows.',
    },
    {
      q: 'Можно без аккаунта?',
      a: 'Нет. Hone — клиент экосистемы druz9; без аккаунта нет плана и не куда логировать focus-сессии. Создаётся автоматически через Yandex ID или Telegram, без email-паролей.',
    },
    {
      q: 'Cue — это Hone?',
      a: 'Нет. Cue — stealth AI-copilot в трее для собесов (⌘⇧Space). Hone — тихий focus для ежедневной работы. Одна подписка покрывает обоих.',
    },
  ]
  return (
    <section className="border-t border-white/5 px-7 py-20">
      <div className="mx-auto max-w-[780px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">FAQ</div>
        <div className="mt-8 space-y-6">
          {qs.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-lg border border-white/10 bg-white/5 px-5 py-4 open:bg-white/10"
            >
              <summary className="cursor-pointer list-none text-[15px] font-medium text-white">
                {q}
              </summary>
              <p className="mt-3 text-[13.5px] leading-[1.65] text-white/65">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCTA() {
  return (
    <section className="border-t border-white/5 px-7 py-24">
      <div className="mx-auto flex max-w-[860px] flex-col items-center gap-6 text-center">
        <Sparkles className="h-8 w-8 text-white/80" />
        <h2 className="font-display text-[36px] font-normal tracking-[-0.025em] text-white sm:text-[52px]">
          Quiet cockpit,
          <br />
          daily ritual.
        </h2>
        <p className="max-w-[460px] text-[14px] text-white/60">
          Скачай, подпиши один раз через druz9.ru, и забудь. Streak будет тикать.
        </p>
        <a
          href={DOWNLOAD_URL_ARM}
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-black hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          Download Hone for macOS
        </a>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
          <Shield className="h-3.5 w-3.5" />
          Signed & notarized. Auto-update built-in.
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-7 py-8">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 text-[12.5px] text-white/50">
        <div className="flex items-center gap-3">
          <HoneMark size="sm" />
          <span>druz9 — ecosystem for growth</span>
        </div>
        <nav className="flex flex-wrap gap-5">
          <Link to="/legal/terms" className="hover:text-white">
            Terms
          </Link>
          <Link to="/legal/privacy" className="hover:text-white">
            Privacy
          </Link>
          <Link to="/copilot" className="hover:text-white">
            Cue
          </Link>
          <a
            href="https://github.com/druz9/hone"
            className="hover:text-white"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  )
}

export default function HonePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <MinimalTopBar />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  )
}
