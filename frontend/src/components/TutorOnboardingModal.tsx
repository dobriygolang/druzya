// TutorOnboardingModal — 4-step explainer для тутора при первом /tutor visit.
//
// Sergey 2026-05-01: «Onboarding wizard для тутора при первом /tutor visit
// — 4-step explanation + invite-code generator». Это убирает «А что вообще
// делать?»-вопрос для нового тутора и ведёт его прямо к созданию первого
// invite-кода.
//
// State persisted в localStorage (key: 'tutor:onboarded'). Re-open
// возможен из dashboard'а через explicit «Tutorial» кнопку (не сделано в
// этой волне — добавим если попросят).

import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

import { Button } from './Button'
import { useCreateInviteMutation } from '../lib/queries/tutor'

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
  const [step, setStep] = useState(0)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const create = useCreateInviteMutation()

  const close = () => {
    markOnboarded()
    onClose()
  }

  const next = () => setStep((s) => Math.min(3, s + 1))
  const prev = () => setStep((s) => Math.max(0, s - 1))

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
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative w-[min(560px,92vw)] max-h-[92vh] overflow-y-auto rounded-lg bg-surface-1 shadow-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
            ОНБОРДИНГ ТУТОРА · {step + 1}/4
          </span>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-6">
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

        <footer className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0}
            className="text-[13px] text-text-secondary disabled:opacity-30"
          >
            Назад
          </button>
          {step < 3 ? (
            <Button size="sm" onClick={next}>Далее</Button>
          ) : (
            <Button size="sm" onClick={close}>Готово</Button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Step0() {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-text-primary">
      <h2 className="font-display text-xl font-bold">druz9 — твой бесплатный тулкит</h2>
      <p>
        Тут нет marketplace и нет денежного шага. druz9 — это инструменты для тебя как тутора:
        очередь assignments, snapshot ученика, AI pre-session brief, общий календарь и shared
        reading library. Платформа amplify-ит твою работу, не подменяет её.
      </p>
    </div>
  )
}

function Step1() {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-text-primary">
      <h2 className="font-display text-xl font-bold">Invite-коды — основа всего</h2>
      <p>
        Ты создаёшь invite — даёшь код / ссылку ученику. Он переходит, регистрируется (или
        логинится) и попадает к тебе в список «Мои студенты». До этого момента ничего у вас
        не связано — только после accept'а.
      </p>
      <p className="text-text-secondary">
        Invite одноразовый. Можно держать несколько активных одновременно, например по одному
        на каждого приходящего ученика.
      </p>
    </div>
  )
}

function Step2() {
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-text-primary">
      <h2 className="font-display text-xl font-bold">Что ты делаешь между сессиями</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-[13.5px]">
        <li>
          <b>Push assignment</b> — задаёшь домашку с дедлайном; она автоматически появится у
          ученика в Hone TaskBoard. За 24 часа до deadline ему придёт нотификация.
        </li>
        <li>
          <b>Snapshot ученика</b> — что он делал на неделе: focus seconds, mocks, weak spots,
          external activity (LeetCode/Coursera).
        </li>
        <li>
          <b>AI brief перед сессией</b> — суммируется в 1-параграф «о чём говорить
          сегодня».
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
    <div className="space-y-4 text-[14px] leading-relaxed text-text-primary">
      <h2 className="font-display text-xl font-bold">Создай первый invite</h2>
      <p>
        Сгенерируй код и отправь его ученику любым удобным способом — Telegram, email,
        WhatsApp.
      </p>
      {!inviteUrl ? (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={onGenerate} disabled={busy}>
            {busy ? 'Создаю…' : 'Сгенерировать invite'}
          </Button>
          {error && <span className="text-[12px] text-warn">Не получилось — повтори.</span>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] break-all">
            {inviteUrl}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onCopy} icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
            <span className="text-[12px] text-text-secondary">
              Можно создавать ещё invite'ы из dashboard'а ниже.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
