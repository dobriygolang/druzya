// TutorOnboardingModal — 4-step explainer для тутора при первом /tutor visit.
//
// State persisted в localStorage (key: 'tutor:onboarded'). Re-open
// возможен из dashboard'а через explicit «Tutorial» кнопку (не сделано в
// этой волне — добавим если попросят).

import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

import { Button } from './Button'
import { Modal } from './primitives/Modal'
import { useCreateInviteMutation } from '../lib/queries/tutor'
import { motion as motionTokens } from '../lib/design-tokens'

const LS_KEY = 'tutor:onboarded'

export function isTutorOnboarded(): boolean {
  try {
    return window.localStorage.getItem(LS_KEY) === '1'
  } catch {
    return true // private mode → не приставай
  }
}

function markOnboarded() {
  try {
    window.localStorage.setItem(LS_KEY, '1')
  } catch {
    /* ignore */
  }
}

interface Props {
  onClose: () => void
}

export function TutorOnboardingModal({ onClose }: Props) {
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const create = useCreateInviteMutation()

  // Smooth exit: flip open=false → Modal plays exit anim → parent unmounts.
  const close = () => {
    markOnboarded()
    setOpen(false)
    window.setTimeout(onClose, motionTokens.dur.medium)
  }

  const next = () => setStep((s) => (Math.min(3, s + 1) as 0 | 1 | 2 | 3))
  const prev = () => setStep((s) => (Math.max(0, s - 1) as 0 | 1 | 2 | 3))

  const generate = async () => {
    if (create.isPending || inviteUrl) return
    try {
      const r = await create.mutateAsync('Onboarding invite')
      const url = `${window.location.origin}/invite/${r.code}`
      setInviteUrl(url)
    } catch {
      /* surfaced via create.isError */
    }
  }

  const copy = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <Modal open={open} onClose={close} size="md">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          paddingBottom: 14,
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-60)',
          }}
        >
          Онбординг тутора · {step + 1}/4
        </span>
        <button
          type="button"
          onClick={close}
          className="focus-ring"
          aria-label="Закрыть"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--ink-60)',
            border: 0,
            cursor: 'pointer',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            e.currentTarget.style.color = 'rgb(var(--ink))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-60)'
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div style={{ minHeight: 220 }}>
        {step === 0 && <Step0 />}
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && (
          <Step3
            inviteUrl={inviteUrl}
            busy={create.isPending}
            error={create.isError}
            copied={copied}
            onGenerate={generate}
            onCopy={copy}
          />
        )}
      </div>

      <footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid var(--hair)',
        }}
      >
        <button
          type="button"
          onClick={prev}
          disabled={step === 0}
          className="focus-ring"
          style={{
            background: 'transparent',
            border: 0,
            cursor: step === 0 ? 'default' : 'pointer',
            opacity: step === 0 ? 0.3 : 1,
            color: 'var(--ink-60)',
            fontSize: 13,
            padding: '6px 4px',
            transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            if (step !== 0) e.currentTarget.style.color = 'rgb(var(--ink))'
          }}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
        >
          Назад
        </button>
        {step < 3 ? (
          <Button size="sm" onClick={next}>
            Далее
          </Button>
        ) : (
          <Button size="sm" onClick={close}>
            Готово
          </Button>
        )}
      </footer>
    </Modal>
  )
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        marginBottom: 12,
        fontSize: 'var(--type-h3-size)',
        lineHeight: 'var(--type-h3-lh)',
        letterSpacing: 'var(--type-h3-ls)',
        fontWeight: 'var(--type-h3-weight)',
        color: 'rgb(var(--ink))',
      }}
    >
      {children}
    </h2>
  )
}

function BodyText({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p
      style={{
        margin: 0,
        marginBottom: 12,
        fontSize: 'var(--type-body-size)',
        lineHeight: 'var(--type-body-lh)',
        color: muted ? 'var(--ink-60)' : 'rgb(var(--ink))',
      }}
    >
      {children}
    </p>
  )
}

function Step0() {
  return (
    <div>
      <StepHeading>druz9 — твой бесплатный тулкит</StepHeading>
      <BodyText>
        Тут нет marketplace и нет денежного шага. druz9 — это инструменты для тебя как тутора:
        очередь assignments, snapshot ученика, AI pre-session brief, общий календарь и shared
        reading library. Платформа amplify-ит твою работу, не подменяет её.
      </BodyText>
    </div>
  )
}

function Step1() {
  return (
    <div>
      <StepHeading>Invite-коды — основа всего</StepHeading>
      <BodyText>
        Ты создаёшь invite — даёшь код / ссылку ученику. Он переходит, регистрируется (или
        логинится) и попадает к тебе в список «Мои студенты». До этого момента ничего у вас
        не связано — только после accept'а.
      </BodyText>
      <BodyText muted>
        Invite одноразовый. Можно держать несколько активных одновременно, например по одному
        на каждого приходящего ученика.
      </BodyText>
    </div>
  )
}

function Step2() {
  return (
    <div>
      <StepHeading>Что ты делаешь между сессиями</StepHeading>
      <ul
        style={{
          margin: 0,
          padding: 0,
          paddingLeft: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--gap-row)',
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-lh)',
          color: 'rgb(var(--ink))',
        }}
      >
        <li>
          <b>Push assignment</b> — задаёшь домашку с дедлайном; она автоматически появится у
          ученика в Hone TaskBoard. За 24 часа до deadline ему придёт нотификация.
        </li>
        <li>
          <b>Snapshot ученика</b> — что он делал на неделе: focus seconds, mocks, weak spots,
          external activity (LeetCode/Coursera).
        </li>
        <li>
          <b>AI brief перед сессией</b> — суммируется в 1-параграф «о чём говорить сегодня».
        </li>
        <li>
          <b>AI-coach между вашими сессиями</b> — ученик может спрашивать coach'а 24/7.
          AI ассистивен, не дублирует твои assignment'ы.
        </li>
      </ul>
    </div>
  )
}

function Step3({
  inviteUrl,
  busy,
  error,
  copied,
  onGenerate,
  onCopy,
}: {
  inviteUrl: string | null
  busy: boolean
  error: boolean
  copied: boolean
  onGenerate: () => void
  onCopy: () => void
}) {
  return (
    <div>
      <StepHeading>Создай первый invite</StepHeading>
      <BodyText>
        Сгенерируй код и отправь его ученику любым удобным способом — Telegram, email, WhatsApp.
      </BodyText>
      {!inviteUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <Button size="sm" onClick={onGenerate} disabled={busy}>
            {busy ? 'Создаю…' : 'Сгенерировать invite'}
          </Button>
          {error && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--gap-row)',
                fontSize: 12,
                color: 'var(--red)',
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)' }} />
              Не получилось — повтори.
            </span>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              padding: '10px 14px',
              border: '1px solid var(--hair-2)',
              borderRadius: 'var(--radius-inner)',
              background: 'rgba(255, 255, 255, 0.02)',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 13,
              wordBreak: 'break-all',
              color: 'rgb(var(--ink))',
            }}
          >
            {inviteUrl}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button size="sm" variant="ghost" onClick={onCopy} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--ink-60)' }}>
              Можно создавать ещё invite'ы из dashboard'а ниже.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
