// /checkout/failure — оплата не прошла (Wave-11).
//
// Принципы (см. brief):
// - Реальная причина, не «произошла ошибка». «Карта отклонена банком» лучше,
//   чем «something went wrong» — пользователь хотя бы понимает, что делать
//   (другая карта vs повторить vs позвонить в банк).
// - Retry CTA → /checkout (восстанавливает прежний выбор плана через
//   document.referrer fallback не делаем — slim, /pricing достаточен).
// - Fallback контакт: явный mailto + telegram, чтобы человек, у которого
//   реально не работает оплата, мог написать живому.

import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Mail, Send } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'

type ReasonCopy = {
  title: string
  body: string
  hint?: string
}

// Маппинг кодов из бэкенда → честные русские формулировки. Когда AIADMIN
// определит реальный enum — расширить.
const REASONS: Record<string, ReasonCopy> = {
  'card-declined': {
    title: 'Банк отклонил карту',
    body: 'Это типичная ситуация — банк может блокировать платежи на иностранные сервисы или из-за лимита. Попробуй другую карту или способ оплаты (СБП, Tinkoff).',
    hint: 'Если используешь карту другой страны — попробуй СБП.',
  },
  'insufficient-funds': {
    title: 'Недостаточно средств',
    body: 'На карте не хватает суммы для списания. Пополни баланс или выбери другой способ оплаты.',
  },
  '3ds-failed': {
    title: '3-D Secure не прошёл',
    body: 'Подтверждение по SMS не было получено за отведённое время. Попробуй ещё раз — обычно это вопрос задержки SMS.',
  },
  network: {
    title: 'Не получилось связаться с платёжным шлюзом',
    body: 'Скорее всего, временные неполадки сети. Подожди минуту и попробуй ещё раз.',
  },
  unknown: {
    title: 'Оплата не прошла',
    body: 'К сожалению, мы не получили подробной причины от платёжного провайдера. Попробуй другой способ оплаты или напиши в поддержку — поможем разобраться.',
  },
}

export default function CheckoutFailure() {
  const [params] = useSearchParams()
  const reasonKey = params.get('reason') ?? 'unknown'
  const copy = REASONS[reasonKey] ?? REASONS.unknown

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-12 sm:px-8 lg:py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-danger/15 ring-4 ring-danger/10">
            <AlertTriangle className="h-8 w-8 text-danger" />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-wider text-danger">
            оплата не прошла
          </span>
          <h1 className="font-display text-2xl font-bold text-text-primary lg:text-3xl">
            {copy.title}
          </h1>
          <p className="max-w-[480px] text-sm leading-relaxed text-text-secondary">{copy.body}</p>
          {copy.hint && (
            <p className="rounded-md bg-warn/10 px-3 py-2 font-mono text-[11px] text-warn">
              {copy.hint}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link to="/checkout?plan=premium&period=monthly" className="flex-1 sm:flex-initial">
            <Button variant="primary" size="lg" className="w-full sm:w-auto">
              Попробовать снова
            </Button>
          </Link>
          <Link to="/pricing" className="flex-1 sm:flex-initial">
            <Button variant="ghost" size="lg" className="w-full sm:w-auto">
              Вернуться к тарифам
            </Button>
          </Link>
        </div>

        <Card className="w-full flex-col gap-4 p-6">
          <h3 className="font-display text-lg font-bold text-text-primary">Не получается?</h3>
          <p className="text-[13px] text-text-secondary">
            Напиши — разберёмся в течение нескольких часов. Если оплата спишется, но подписка не активируется,
            обязательно вернём.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href="mailto:support@druz9.app?subject=Не%20прошла%20оплата"
              className="flex flex-1 items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 text-[13px] font-semibold text-text-primary hover:border-border-strong"
            >
              <Mail className="h-4 w-4 text-text-muted" />
              support@druz9.app
            </a>
            <a
              href="https://t.me/druz9_support"
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 text-[13px] font-semibold text-text-primary hover:border-border-strong"
            >
              <Send className="h-4 w-4 text-text-muted" />
              @druz9_support
            </a>
          </div>
        </Card>

        <p className="font-mono text-[10px] text-text-muted">
          код причины · {reasonKey}
        </p>
      </div>
    </AppShellV2>
  )
}
