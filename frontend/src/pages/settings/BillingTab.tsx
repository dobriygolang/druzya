// /settings/billing — управление подпиской (Wave-11).
//
// Не отдельный route, а вкладка-секция, монтируемая внутри SettingsPage
// (или отдельно при необходимости — компонент самодостаточный).
//
// Cancel-flow: трёхступенчатый, но без dark-pattern «дайте подумать ещё раз».
// Шаги: 1) кнопка «Отменить подписку» → 2) modal с reason picker и
// свободным комментом → 3) финальное «точно отменить?» с явным CTA. На
// каждом шаге есть «передумал», и она нейтральная (ghost), а primary —
// отмена.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Download, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { cn } from '../../lib/cn'
import {
  useCancelSubscriptionMutation,
  useCurrentPlanQuery,
  useInvoicesQuery,
  type Invoice,
} from '../../lib/queries/billing'

const CANCEL_REASONS = [
  'Слишком дорого',
  'Не пользовался часто',
  'Не хватает функций',
  'Нашёл альтернативу',
  'Временно — вернусь позже',
] as const

export function BillingTab() {
  return (
    <div className="flex flex-col gap-5">
      <CurrentPlanCard />
      <InvoicesCard />
    </div>
  )
}

function CurrentPlanCard() {
  const { data: plan, isLoading } = useCurrentPlanQuery()
  const [cancelStep, setCancelStep] = useState<'idle' | 'reason' | 'confirm' | 'done'>('idle')
  const [reason, setReason] = useState<string>('')
  const [feedback, setFeedback] = useState('')
  const cancel = useCancelSubscriptionMutation()

  const isFree = !plan || plan.tier === 'free'
  const next = plan?.next_charge_at
    ? new Date(plan.next_charge_at).toLocaleDateString('ru', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''

  return (
    <>
      <Card
        className={cn(
          'flex-col gap-4 p-6',
          !isFree && 'border-warn/40 bg-gradient-to-br from-warn/10 to-transparent',
        )}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-text-primary">Текущая подписка</h3>
          {plan?.tier && (
            <span
              className={cn(
                'rounded-md px-2 py-0.5 font-mono text-[11px] font-bold uppercase',
                isFree ? 'bg-surface-2 text-text-secondary' : 'bg-warn/20 text-warn',
              )}
            >
              {plan.tier}
            </span>
          )}
        </div>

        {isLoading && <div className="font-mono text-[11px] text-text-muted">loading…</div>}

        {!isLoading && isFree && (
          <>
            <p className="text-[13px] text-text-secondary">
              Сейчас ты на бесплатном тарифе. Чтобы открыть AI Coach без лимитов и полный атлас навыков —
              подключи Premium.
            </p>
            <Link to="/pricing">
              <Button variant="primary" size="md">
                Посмотреть тарифы
              </Button>
            </Link>
          </>
        )}

        {!isLoading && !isFree && plan && (
          <>
            <div className="flex flex-col gap-3 border-t border-border pt-4 text-[13px]">
              <Row label="Тариф" value={plan.tier === 'pro' ? 'Pro' : 'Premium'} />
              <Row label="Период" value={plan.period === 'annual' ? 'Годовой' : 'Помесячно'} />
              {next && <Row label="Следующее списание" value={next} />}
              {plan.next_charge_amount > 0 && (
                <Row label="Сумма" value={`${plan.next_charge_amount} ₽`} />
              )}
              {plan.payment_method && (
                <Row label="Способ оплаты" value={plan.payment_method.label} />
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
              <Link to="/checkout?plan=premium&period=monthly" className="flex-1 sm:flex-initial">
                <Button variant="ghost" size="md" icon={<CreditCard className="h-4 w-4" />}>
                  Сменить способ оплаты
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setCancelStep('reason')}
                className="flex-1 border-border text-text-secondary hover:text-text-primary sm:flex-initial"
              >
                Отменить подписку
              </Button>
            </div>
          </>
        )}
      </Card>

      {cancelStep !== 'idle' && (
        <CancelModal
          step={cancelStep}
          reason={reason}
          feedback={feedback}
          isPending={cancel.isPending}
          setReason={setReason}
          setFeedback={setFeedback}
          onClose={() => {
            if (cancelStep === 'done') {
              setReason('')
              setFeedback('')
            }
            setCancelStep('idle')
          }}
          onNextStep={() => {
            if (cancelStep === 'reason') {
              setCancelStep('confirm')
            } else if (cancelStep === 'confirm') {
              cancel.mutate(
                { reason, feedback: feedback || undefined },
                { onSuccess: () => setCancelStep('done') },
              )
            } else if (cancelStep === 'done') {
              setReason('')
              setFeedback('')
              setCancelStep('idle')
            }
          }}
        />
      )}
    </>
  )
}

function CancelModal({
  step,
  reason,
  feedback,
  isPending,
  setReason,
  setFeedback,
  onClose,
  onNextStep,
}: {
  step: 'reason' | 'confirm' | 'done'
  reason: string
  feedback: string
  isPending: boolean
  setReason: (r: string) => void
  setFeedback: (f: string) => void
  onClose: () => void
  onNextStep: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-text-primary">
            {step === 'reason' && 'Почему уходишь?'}
            {step === 'confirm' && 'Подтверди отмену'}
            {step === 'done' && 'Подписка отменена'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'reason' && (
          <>
            <p className="text-[13px] text-text-secondary">
              Не для удержания — для нас это сигнал, куда расти. Один пункт обязателен; коммент — по желанию.
            </p>
            <div className="flex flex-col gap-2">
              {CANCEL_REASONS.map((r) => (
                <label
                  key={r}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] transition-colors',
                    reason === r
                      ? 'border-text-primary bg-text-primary/10 text-text-primary'
                      : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="h-4 w-4 accent-accent"
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="Что бы помогло остаться? (необязательно)"
              className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-text-primary/40"
            />
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={onClose} className="flex-1">
                Передумал
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={onNextStep}
                disabled={!reason}
                className="flex-1"
              >
                Продолжить
              </Button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Доступ к премиум-фичам сохранится до конца оплаченного периода. Прогресс, ачивки и история —
              остаются у тебя навсегда. Подключить заново можно в любой момент.
            </p>
            <div className="rounded-md bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-secondary">
              причина · {reason}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={onClose} className="flex-1">
                Передумал
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={onNextStep}
                loading={isPending}
                className="flex-1"
              >
                Отменить подписку
              </Button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Готово. Подписка отменена. Доступ к премиум-фичам сохранится до конца оплаченного периода.
              Спасибо, что был с нами — будем рады, если вернёшься.
            </p>
            <Button variant="primary" size="md" onClick={onClose}>
              Закрыть
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}

function InvoicesCard() {
  const { data: invoices, isLoading } = useInvoicesQuery()

  return (
    <Card className="flex-col gap-4 p-0">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h3 className="font-display text-lg font-bold text-text-primary">История платежей</h3>
      </div>
      {isLoading && (
        <div className="px-6 py-6 font-mono text-[11px] text-text-muted">loading…</div>
      )}
      {!isLoading && (!invoices || invoices.length === 0) && (
        <div className="px-6 py-2">
          <EmptyState
            variant="no-data"
            title="Платежей пока не было"
            body="Здесь появятся чеки, как только будет оформлена подписка."
            compact
          />
        </div>
      )}
      {!isLoading && invoices && invoices.length > 0 && (
        <div className="flex flex-col">
          {invoices.map((inv, i) => (
            <InvoiceRow key={inv.id} invoice={inv} last={i === invoices.length - 1} />
          ))}
        </div>
      )}
    </Card>
  )
}

function InvoiceRow({ invoice, last }: { invoice: Invoice; last: boolean }) {
  const date = new Date(invoice.paid_at).toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-6 py-3.5',
        !last && 'border-b border-border',
      )}
    >
      <div className="flex flex-col">
        <span className="text-[13px] font-semibold text-text-primary">{date}</span>
        <span className="font-mono text-[11px] text-text-muted">{invoice.id}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-mono text-[13px] font-semibold text-text-primary">
          {invoice.amount} ₽
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase',
            invoice.status === 'paid' && 'bg-success/20 text-success',
            invoice.status === 'failed' && 'bg-danger/20 text-danger',
            invoice.status === 'refunded' && 'bg-warn/20 text-warn',
          )}
        >
          {invoice.status}
        </span>
        <a
          href={invoice.pdf_url}
          download
          className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
          aria-label="Скачать PDF"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-semibold text-text-primary">{value}</span>
    </div>
  )
}
