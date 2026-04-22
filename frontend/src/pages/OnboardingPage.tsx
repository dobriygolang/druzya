import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  MousePointerClick,
  Play,
  CircleCheck,
  Bot,
  Sparkles,
  Lock,
  Clock,
  MessageSquare,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { cn } from '../lib/cn'
import { useLanguages, type Language } from '../lib/api/languages'
import { useOnboardingPreviewKata } from '../lib/api/onboarding'

// Phase 2: email/password registration removed. Step 1 now offers only the
// two OAuth providers (Yandex + Telegram). The href targets are the
// backend OAuth-start endpoints; once the user finishes the redirect the
// existing /api/v1/auth/{yandex,telegram} POST handler mints tokens.
const YANDEX_LOGIN_URL = '/api/v1/auth/yandex/login'
const TELEGRAM_LOGIN_URL = '/api/v1/auth/telegram/login'

type StepNum = 1 | 2 | 3 | 4

function useStepLabels(): Record<StepNum, string> {
  const { t } = useTranslation('onboarding')
  return {
    1: t('step_labels.1'),
    2: t('step_labels.2'),
    3: t('step_labels.3'),
    4: t('step_labels.4'),
  }
}

function Logo() {
  return (
    <Link to="/welcome" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
        9
      </span>
      <span className="font-display text-lg font-bold text-text-primary">druz9</span>
    </Link>
  )
}

function StepIndicator({ current, allDone = false }: { current: StepNum; allDone?: boolean }) {
  const STEP_LABELS = useStepLabels()
  const steps: StepNum[] = [1, 2, 3, 4]
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, idx) => {
        const completed = allDone || s < current
        const isCurrent = !allDone && s === current
        return (
          <div key={s} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'grid place-items-center rounded-full text-[13px]',
                  completed
                    ? 'bg-success text-bg'
                    : isCurrent
                      ? 'bg-accent text-text-primary shadow-glow'
                      : 'border border-border-strong text-text-muted',
                )}
                style={{ width: 28, height: 28 }}
              >
                {completed ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : (
                  <span className="font-display font-bold leading-none">{s}</span>
                )}
              </div>
              <span
                className={cn(
                  'text-[12px]',
                  isCurrent ? 'font-semibold text-text-primary' : 'font-medium text-text-muted',
                )}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <span
                className={cn('block', completed ? 'bg-success' : 'bg-border-strong')}
                style={{ width: 32, height: 2 }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function OnboardingTopBar({
  current,
  allDone = false,
  showSkip = true,
}: {
  current: StepNum
  allDone?: boolean
  showSkip?: boolean
}) {
  const { t } = useTranslation('onboarding')
  return (
    <header
      className="flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20"
    >
      <Logo />
      <div className="hidden md:block">
        <StepIndicator current={current} allDone={allDone} />
      </div>
      {showSkip ? (
        <Link
          to="/onboarding/done"
          className="text-sm font-medium text-text-muted hover:text-text-secondary"
        >
          {t('skip')}
        </Link>
      ) : (
        <span style={{ width: 80 }} />
      )}
    </header>
  )
}

/* ------------------------------- STEP 1 -------------------------------- */

function Step1Register({ onNext: _onNext }: { onNext: () => void }) {
  void _onNext // OAuth flow leaves the SPA; success returns via redirect.
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()

  return (
    <div
      className="grid grid-cols-1 gap-10 px-4 py-8 sm:px-8 lg:grid-cols-2 lg:gap-[60px] lg:px-20 lg:py-[60px]"
    >
      {/* Left */}
      <div className="flex flex-col justify-center" style={{ gap: 24 }}>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover">
          {t('step1.tag')}
        </span>
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[48px]" style={{ lineHeight: 1.1 }}>
          {t('step1.title')}
        </h1>
        <p className="max-w-[460px] text-[15px] text-text-secondary">
          {t('step1.subtitle')}
        </p>

        <div className="flex flex-col gap-3">
          <a
            href={TELEGRAM_LOGIN_URL}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/15 text-[15px] font-semibold text-text-primary shadow-glow transition-colors hover:bg-cyan/25"
          >
            Войти через Telegram
            <ArrowRight className="h-5 w-5" />
          </a>
          <a
            href={YANDEX_LOGIN_URL}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-pink/40 bg-pink/15 text-[15px] font-semibold text-text-primary shadow-glow transition-colors hover:bg-pink/25"
          >
            Войти через Yandex
            <ArrowRight className="h-5 w-5" />
          </a>
        </div>

        <p className="text-[13px] text-text-muted">
          {t('step1.have_account')}{' '}
          <button type="button" onClick={() => navigate('/login')} className="font-semibold text-accent-hover hover:underline">
            {t('step1.login_arrow')}
          </button>
        </p>
      </div>

      {/* Right */}
      <div
        className="relative hidden flex-col items-center justify-center gap-6 overflow-hidden rounded-2xl p-10 lg:flex lg:p-[60px]"
        style={{
          background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
        }}
      >
        <div
          className="flex w-full max-w-[320px] flex-col items-center gap-3 rounded-xl backdrop-blur"
          style={{ background: 'rgba(0,0,0,0.6)', padding: 24 }}
        >
          <Avatar size="xl" gradient="pink-violet" initials="Д" />
          <span className="font-display text-xl font-bold text-text-primary">@dima</span>
          <div className="flex w-full justify-around">
            <MiniStat value="0" label="LP" />
            <MiniStat value="Bronze" label="ранг" />
            <MiniStat value="0 🔥" label="серия" />
          </div>
          <div className="mt-2 w-full rounded-md border border-white/10 bg-white/5 p-2 text-center text-[12px] text-text-secondary">
            {t('step1.ready_first')}
          </div>
        </div>

        <div className="flex w-full max-w-[320px] flex-col gap-2">
          <Testimonial author="@alexey" text="За месяц поднялся до Diamond II 🚀" gradient="violet-cyan" />
          <Testimonial author="@kirill_dev" text="Спарринги — лучший способ учиться" gradient="cyan-violet" />
          <Testimonial author="@nastya" text="Гильдии — как мини-команда" gradient="pink-violet" />
        </div>
      </div>
    </div>
  )
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-display text-sm font-bold text-text-primary">{value}</span>
      <span className="font-mono text-[10px] uppercase text-text-muted">{label}</span>
    </div>
  )
}

function Testimonial({
  author,
  text,
  gradient,
}: {
  author: string
  text: string
  gradient: 'violet-cyan' | 'cyan-violet' | 'pink-violet'
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-2 backdrop-blur">
      <Avatar size="sm" gradient={gradient} initials={author[1]?.toUpperCase()} />
      <span className="font-mono text-[11px] font-semibold text-text-primary">{author}</span>
      <span className="text-[12px] text-text-secondary">{text}</span>
    </div>
  )
}

/* ------------------------------- STEP 2 -------------------------------- */

// Re-export Language under the legacy `Lang` type so external callers keep
// compiling. The shape is a strict superset (the legacy type was just
// `{name, symbol, color, textColor?}`; Language adds slug + counts).
export type Lang = Language

function Step2Stack({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation('onboarding')
  const langsQ = useLanguages()
  const langs: Language[] = langsQ.data?.items ?? []
  const [selected, setSelected] = useState<string[]>(['Go', 'Python'])
  const toggle = (n: string) => {
    setSelected((cur) =>
      cur.includes(n) ? cur.filter((x) => x !== n) : cur.length >= 3 ? cur : [...cur, n],
    )
  }
  return (
    <div
      className="flex flex-col items-center gap-6 px-4 py-8 sm:px-8 lg:px-20 lg:py-10"
    >
      <h1 className="text-center font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[44px]" style={{ lineHeight: 1.1 }}>
        {t('step2.title')}
      </h1>
      <p className="max-w-[560px] text-center text-[15px] text-text-secondary">
        {t('step2.subtitle')}
      </p>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 font-mono text-[12px] font-semibold text-success">
        <Check className="h-3.5 w-3.5" /> {t('step2.selected', { count: selected.length })}
      </span>

      <div className="grid w-full max-w-[1100px] grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {langsQ.isLoading && langs.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`sk-${i}`}
                className="animate-pulse rounded-xl border border-border bg-surface-1"
                style={{ height: 160 }}
              />
            ))
          : langs.map((l) => {
              const active = selected.includes(l.name)
              return (
                <button
                  key={l.slug}
                  type="button"
                  onClick={() => toggle(l.name)}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-2 rounded-xl bg-surface-1 p-4 transition-all',
                    active
                      ? 'border-2 border-accent shadow-glow'
                      : 'border border-border hover:border-border-strong',
                  )}
                  style={{ height: 160 }}
                >
                  {active && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-text-primary shadow-glow">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                  <span
                    className="grid place-items-center rounded-lg font-display font-bold"
                    style={{
                      width: 56,
                      height: 56,
                      background: l.color,
                      color: l.text_color ?? '#FFFFFF',
                      fontSize: 18,
                    }}
                  >
                    {l.symbol}
                  </span>
                  <span className="font-sans text-[14px] font-bold text-text-primary">{l.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                    {l.players_active.toLocaleString('ru-RU')} online
                  </span>
                </button>
              )
            })}
      </div>

      <div className="mt-4 flex w-full max-w-[1100px] items-center justify-between">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} className="h-12 px-6">
          {t('step2.back')}
        </Button>
        <Button
          variant="primary"
          iconRight={<ArrowRight className="h-5 w-5" />}
          onClick={onNext}
          className="h-12 px-7 shadow-glow"
        >
          {t('step2.next')}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------- STEP 3 -------------------------------- */

function Step3Kata({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation('onboarding')
  const previewQ = useOnboardingPreviewKata()
  const kata = previewQ.data
  const testsLabel = kata
    ? `${kata.tests_passed}/${kata.tests_total} tests passed`
    : '—/— tests passed'
  return (
    <div
      className="grid grid-cols-1 gap-8 px-4 pb-8 pt-8 sm:px-8 lg:grid-cols-[480px_1fr] lg:px-20 lg:pb-7 lg:pt-10"
    >
      {/* Left */}
      <div className="flex flex-col justify-center gap-5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
          {t('step3.tag')}
        </span>
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl lg:text-[40px]" style={{ lineHeight: 1.15 }}>
          {t('step3.title')}
        </h1>
        <p className="text-[15px] text-text-secondary">
          {t('step3.subtitle')}
        </p>

        <div className="flex flex-col gap-3 pt-2">
          <FeatureRow
            icon={<MousePointerClick className="h-4 w-4 text-cyan" />}
            iconBg="bg-cyan/15"
            title={t('step3.f1_title')}
            sub={t('step3.f1_sub')}
          />
          <FeatureRow
            icon={<Play className="h-4 w-4 text-accent-hover" />}
            iconBg="bg-accent/15"
            title={t('step3.f2_title')}
            sub={t('step3.f2_sub')}
          />
          <FeatureRow
            icon={<CircleCheck className="h-4 w-4 text-success" />}
            iconBg="bg-success/15"
            title={t('step3.f3_title')}
            sub={t('step3.f3_sub')}
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} className="h-12 px-6">
            {t('step3.back')}
          </Button>
          <Button
            variant="primary"
            iconRight={<ArrowRight className="h-5 w-5" />}
            onClick={onNext}
            className="h-12 px-7 shadow-glow"
          >
            {t('step3.go')}
          </Button>
        </div>
      </div>

      {/* Right — mock Daily Kata preview */}
      <div className="relative overflow-hidden rounded-2xl bg-surface-2">
        <div
          className="flex flex-col gap-2 px-6 py-5"
          style={{
            height: 120,
            background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
          }}
        >
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
            DAILY · TUTORIAL
          </span>
          <h3 className="font-display text-2xl font-bold text-text-primary">{kata?.title ?? 'Two Sum'}</h3>
          <div className="flex gap-2">
            <Tag>Easy</Tag>
            <Tag>Hash Map</Tag>
            <Tag>Array</Tag>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 bg-surface-1 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t('step3.task')}
            </span>
            <p className="text-[12px] leading-relaxed text-text-secondary">
              {t('step3.task_text')}
            </p>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed">
            <CodeLine n={1} text="func twoSum(nums []int, t int) []int {" />
            <CodeLine n={2} text="  m := map[int]int{}" />
            <CodeLine n={3} text="  for i, v := range nums {" highlight />
            <CodeLine n={4} text="    if j, ok := m[t-v]; ok {" />
            <CodeLine n={5} text="      return []int{j, i}" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface-2 px-6 py-3">
          <span className="font-mono text-[11px] text-text-muted">{testsLabel}</span>
          <div className="flex items-center gap-2">
            <button className="rounded-md border border-border bg-bg px-3 py-1.5 text-[12px] font-semibold text-text-secondary">
              Run
            </button>
            <button
              id="mock-submit-btn"
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-text-primary shadow-glow"
            >
              Submit
            </button>
          </div>
        </div>

        {/* Floating tooltip */}
        <div
          className="absolute flex flex-col gap-1 rounded-lg border border-accent bg-accent/95 px-4 py-3 shadow-glow"
          style={{ bottom: 70, right: 24, maxWidth: 220 }}
        >
          <span className="font-display text-[13px] font-bold text-text-primary">
            {t('step3.tooltip_title')}
          </span>
          <span className="text-[11px] text-white/85">{t('step3.tooltip_sub')}</span>
          <span
            className="absolute h-3 w-3 rotate-45 bg-accent"
            style={{ bottom: -6, right: 32 }}
          />
        </div>
      </div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/30 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
      {children}
    </span>
  )
}

function FeatureRow({
  icon,
  iconBg,
  title,
  sub,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  sub: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn('mt-0.5 grid h-9 w-9 place-items-center rounded-full', iconBg)}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[14px] font-semibold text-text-primary">{title}</span>
        <span className="text-[12px] text-text-muted">{sub}</span>
      </div>
    </div>
  )
}

function CodeLine({ n, text, highlight }: { n: number; text: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded px-1',
        highlight ? 'bg-accent/20 text-text-primary' : 'text-text-secondary',
      )}
    >
      <span className="text-text-muted">{n}</span>
      <span>{text}</span>
    </div>
  )
}

/* ------------------------------- STEP 4 -------------------------------- */

function Step4AISpar(_props: { onNext: () => void; onBack: () => void }) {
  void _props
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <div
        className="flex flex-col items-start justify-between gap-6 px-4 py-8 sm:px-8 lg:h-[360px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
        style={{
          background: 'linear-gradient(135deg, #2D1B4D 0%, #F472B6 100%)',
        }}
      >
        <div className="flex flex-col gap-4 lg:w-[540px]">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
            {t('step4.tag')}
          </span>
          <h1 className="font-display text-2xl font-extrabold text-text-primary sm:text-3xl lg:text-[36px]" style={{ lineHeight: 1.1 }}>
            {t('step4.title')}
          </h1>
          <p className="text-[14px] leading-relaxed text-white/85">
            {t('step4.subtitle')}
          </p>
          <div className="flex flex-col gap-2 pt-1">
            <CheckFeat text={t('step4.f1')} />
            <CheckFeat text={t('step4.f2')} />
            <CheckFeat text={t('step4.f3')} />
          </div>
        </div>

        <div
          className="flex w-full flex-col items-center gap-[18px] rounded-2xl p-[22px] backdrop-blur lg:w-[380px]"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div className="flex items-center gap-4">
            <div
              className="grid place-items-center text-text-primary"
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                background: 'linear-gradient(135deg, #F472B6 0%, #582CFF 100%)',
              }}
            >
              <span className="font-display text-2xl font-bold">Д</span>
            </div>
            <span className="font-display text-2xl font-extrabold text-text-primary">VS</span>
            <div
              className="grid place-items-center text-text-primary"
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
              }}
            >
              <Bot className="h-8 w-8" />
            </div>
          </div>
          <span className="font-mono text-[12px] text-text-secondary">
            Two Sum · Hash Map · Easy
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        className="flex flex-col items-center gap-5 px-4 py-8 sm:px-8 lg:px-20"
      >
        <h2 className="text-center font-display text-2xl font-bold text-text-primary">
          {t('step4.ready')}
        </h2>
        <p className="max-w-[560px] text-center text-[14px] text-text-secondary">
          {t('step4.ready_sub')}
        </p>

        <div className="grid w-full max-w-[900px] grid-cols-1 gap-4 sm:grid-cols-3">
          <BenefitCard
            icon={<Sparkles className="h-5 w-5 text-accent-hover" />}
            title={t('step4.b1_title')}
            sub={t('step4.b1_sub')}
          />
          <BenefitCard
            icon={<Sparkles className="h-5 w-5 text-cyan" />}
            title={t('step4.b2_title')}
            sub={t('step4.b2_sub')}
          />
          <BenefitCard
            icon={<Lock className="h-5 w-5 text-warn" />}
            title={t('step4.b3_title')}
            sub={t('step4.b3_sub')}
          />
        </div>

        <div className="flex w-full flex-col items-stretch gap-3 pt-2 sm:w-auto sm:flex-row sm:items-center">
          <Button
            variant="ghost"
            icon={<Play className="h-4 w-4" />}
            onClick={() => navigate('/welcome/demo')}
            className="h-12 px-6"
          >
            {t('step4.watch_video')}
          </Button>
          <Button
            variant="primary"
            iconRight={<ArrowRight className="h-5 w-5" />}
            onClick={() => navigate('/arena')}
            className="h-14 px-8 text-[15px] shadow-glow"
          >
            {t('step4.begin_spar')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CheckFeat({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-success/25">
        <Check className="h-3 w-3 text-success" strokeWidth={3} />
      </span>
      <span className="text-[13px] text-text-primary">{text}</span>
    </div>
  )
}

function BenefitCard({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode
  title: string
  sub: string
}) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-xl border border-border bg-surface-1 p-5">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2">{icon}</span>
      <span className="font-display text-base font-bold text-text-primary">{title}</span>
      <span className="text-[12px] text-text-muted">{sub}</span>
    </div>
  )
}

/* ------------------------------- PAGE ---------------------------------- */

// re-export icon for unused suppression
void Clock
void MessageSquare

export default function OnboardingPage() {
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const stepParam = parseInt(params.get('step') ?? '1', 10)
  const step = useMemo<StepNum>(
    () => ((stepParam >= 1 && stepParam <= 4 ? stepParam : 1) as StepNum),
    [stepParam],
  )

  const setStep = (s: StepNum) => {
    const next = new URLSearchParams(params)
    next.set('step', String(s))
    setParams(next, { replace: false })
  }

  const goNext = () => {
    if (step < 4) setStep(((step + 1) as StepNum))
    else navigate('/onboarding/done')
  }
  const goBack = () => {
    if (step > 1) setStep(((step - 1) as StepNum))
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <OnboardingTopBar current={step} />
      <main>
        {step === 1 && <Step1Register onNext={goNext} />}
        {step === 2 && <Step2Stack onNext={goNext} onBack={goBack} />}
        {step === 3 && <Step3Kata onNext={goNext} onBack={goBack} />}
        {step === 4 && <Step4AISpar onNext={goNext} onBack={goBack} />}
      </main>
    </div>
  )
}
