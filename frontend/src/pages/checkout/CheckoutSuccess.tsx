// /checkout/success — Stripe Checkout вернул нас сюда после успешной оплаты.
//
// Stream-C MVP flow:
//   1. webhook checkout.session.completed уже долетел до бэка (или долетит
//      в течение секунд) и SetTier(Pro) сработал.
//   2. /subscription/tier-info теперь возвращает source='pro'.
//   3. Через 3s — auto-redirect на /today.
//
// Если tier ещё не успел переключиться (Stripe webhook latency >3s) — UI
// всё равно показывает success, а реальный gate откроется на /today когда
// react-query refetch'нёт tier-info.

import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Sparkles } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { useTierQuery } from '../../lib/queries/tier'

const UNLOCKED: string[] = [
  'Безлимит AI-mock pipelines — все 5-stage прогоны',
  'Deep readiness analytics — расширенный radar и trend',
  'Premium Cue — расширенный live-транскрипт',
  'Google Calendar sync — events в /today',
  'Advanced goal analytics — milestones + drift detection',
]

const REDIRECT_DELAY_MS = 3000

export default function CheckoutSuccess() {
  const tier = useTierQuery()
  const navigate = useNavigate()
  const label = tier.data?.source === 'pro' ? 'Pro' : 'Pro'

  useEffect(() => {
    const t = setTimeout(() => navigate('/today', { replace: true }), REDIRECT_DELAY_MS)
    return () => clearTimeout(t)
  }, [navigate])

  // Force-refetch tier-info, чтобы UI как можно быстрее увидел source='pro'.
  useEffect(() => {
    void tier.refetch()
  }, [tier])

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-12 sm:px-8 lg:py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-text-primary/15 ring-4 ring-text-primary/10">
            <Check className="h-8 w-8 text-text-primary" strokeWidth={3} />
          </div>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: 'rgb(var(--ink))' }}
          >
            оплата прошла
          </span>
          <h1 className="font-display text-2xl font-bold text-text-primary lg:text-3xl">
            <span className="rounded-md bg-text-primary/15 px-2 py-0.5 font-mono text-[14px] font-bold uppercase tracking-[0.08em] text-text-primary">
              {label}
            </span>{' '}
            активирован!
          </h1>
          <p className="text-sm text-text-secondary">
            Pro-фичи открыты. Через 3 секунды откроем /today.
          </p>
        </div>

        <Card className="w-full flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-text-secondary" />
            <h3 className="font-display text-lg font-bold text-text-primary">Что открылось</h3>
          </div>
          <ul className="flex flex-col gap-2.5">
            {UNLOCKED.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[13px] text-text-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" strokeWidth={3} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/today" className="flex-1 sm:flex-initial">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              К /today сейчас
            </Button>
          </Link>
          <Link to="/settings" className="flex-1 sm:flex-initial">
            <Button variant="ghost" size="lg" className="w-full sm:w-auto">
              Настройки подписки
            </Button>
          </Link>
        </div>

        <p className="text-center text-[11px] text-text-muted">
          Чек придёт на email. Управлять подпиской — /settings/billing.
        </p>
      </div>
    </AppShellV2>
  )
}
