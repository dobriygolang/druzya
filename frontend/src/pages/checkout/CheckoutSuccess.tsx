// /checkout/success — после успешной оплаты (Wave-11).
//
// Намеренно сдержанная celebration: confetti-overload остаётся для
// /match/:id/end (real victory). Здесь — soft tick + список того, что
// действительно открылось, и ясный next-step.

import { Link } from 'react-router-dom'
import { Check, Sparkles } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { useCurrentPlanQuery } from '../../lib/queries/billing'

const UNLOCKED: string[] = [
  'AI Coach без лимитов — премиум-модели в /settings → AI',
  'Полный атлас навыков — все ноды разблокированы для прогресса',
  'Arena без лимита матчей в неделю',
  'Daily kata без лимита — практикуй сколько хочется',
  'Приоритетный доступ к новым функциям',
]

export default function CheckoutSuccess() {
  const { data: plan } = useCurrentPlanQuery()
  const next = plan?.next_charge_at
    ? new Date(plan.next_charge_at).toLocaleDateString('ru', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''
  const tierLabel = plan?.tier === 'pro' ? 'Pro' : 'Premium'

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-12 sm:px-8 lg:py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-success/15 ring-4 ring-success/10">
            <Check className="h-8 w-8 text-success" strokeWidth={3} />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-wider text-success">
            оплата прошла
          </span>
          <h1 className="font-display text-2xl font-bold text-text-primary lg:text-3xl">
            Подписка{' '}
            <span className="rounded-md bg-warn/20 px-2 py-0.5 font-mono text-[14px] font-bold uppercase text-warn">
              {tierLabel}
            </span>{' '}
            активна
          </h1>
          {next && (
            <p className="text-sm text-text-secondary">
              Следующее списание · <span className="font-semibold text-text-primary">{next}</span>
            </p>
          )}
        </div>

        <Card className="w-full flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-pink" />
            <h3 className="font-display text-lg font-bold text-text-primary">Что у тебя теперь есть</h3>
          </div>
          <ul className="flex flex-col gap-2.5">
            {UNLOCKED.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[13px] text-text-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={3} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/sanctum" className="flex-1 sm:flex-initial">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              В sanctum
            </Button>
          </Link>
          <Link to="/settings" className="flex-1 sm:flex-initial">
            <Button variant="ghost" size="lg" className="w-full sm:w-auto">
              Настройки подписки
            </Button>
          </Link>
        </div>

        <p className="text-center text-[11px] text-text-muted">
          Чек придёт на email в течение нескольких минут. PDF также доступен в /settings/billing.
        </p>
      </div>
    </AppShellV2>
  )
}
