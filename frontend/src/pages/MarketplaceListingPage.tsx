// MarketplaceListingPage — Wave 9.1 public detail page.
//
// Route `/marketplace/:slug`. Renders one listing with its packages and
// a single CTA: «Subscribe via Boosty» — outbound link, target=_blank.
// We intentionally do NOT process payments; Boosty owns the entire
// money flow. Once subscribed on Boosty, the tutor mints a tutor-invite
// code and the student plugs it in via /invite/{code}.
import { useParams } from 'react-router-dom'

import { Card } from '../components/Card'
import { useListingBySlugQuery, type TutorListingPackage } from '../lib/queries/tutor'

function formatPrice(minor: number, currency: string): string {
  const major = minor / 100
  const sym = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency
  return `${major.toLocaleString('ru-RU')} ${sym}`
}

export default function MarketplaceListingPage() {
  const { slug } = useParams<{ slug: string }>()
  const q = useListingBySlugQuery(slug)

  if (q.isPending) {
    return <p className="mx-auto max-w-3xl px-4 py-10 text-text-secondary">Загружаем…</p>
  }
  if (q.isError || !q.data) {
    return (
      <p className="mx-auto max-w-3xl px-4 py-10 text-danger">
        Листинг не найден или снят с публикации.
      </p>
    )
  }
  const { listing, packages, tutor_display } = q.data

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
          MARKETPLACE · {listing.track_kind.toUpperCase()}
        </p>
        <h1 className="font-display text-3xl font-semibold">{listing.title}</h1>
        {tutor_display && (
          <p className="text-[13px] text-text-secondary">
            Тутор: <span className="text-text-primary">{tutor_display}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {listing.languages.map((lang) => (
            <span
              key={lang}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-text-muted"
            >
              {lang}
            </span>
          ))}
        </div>
      </header>

      {listing.summary && (
        <p className="text-[15px] leading-relaxed text-text-primary">{listing.summary}</p>
      )}

      <Card className="flex-col gap-3 p-5" interactive={false}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Hourly rate
        </p>
        <p className="font-display text-2xl font-semibold">
          {formatPrice(listing.hourly_rate_minor, listing.currency)}
          <span className="ml-1 text-sm text-text-secondary">/час</span>
        </p>
        {listing.boosty_url && (
          <a
            href={listing.boosty_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex w-fit items-center gap-2 rounded-md bg-text-primary px-4 py-2 text-sm font-medium text-surface-1"
          >
            Подписаться через Boosty →
          </a>
        )}
        <p className="text-[12px] text-text-muted">
          Платежи и подписки обрабатывает Boosty. После успешной подписки
          тутор пришлёт тебе инвайт-код — введи его на /invite/{'{code}'} и
          получишь общий доступ к календарю + заметкам в Hone.
        </p>
      </Card>

      {packages.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold">Пакеты</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {packages.map((pkg) => (
              <li key={pkg.id}>
                <PackageCard pkg={pkg} currency={listing.currency} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {listing.body_md && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-xl font-semibold">О занятиях</h2>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-secondary">
            {listing.body_md}
          </p>
        </section>
      )}
    </div>
  )
}

function PackageCard({
  pkg,
  currency,
}: {
  pkg: TutorListingPackage
  currency: string
}) {
  return (
    <Card className="flex-col gap-1 p-4" interactive={false}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        {pkg.kind}
      </p>
      <p className="font-display text-lg font-semibold">
        {pkg.hours} ч · {formatPrice(pkg.price_minor, currency)}
      </p>
      {pkg.description && (
        <p className="text-[12px] text-text-secondary">{pkg.description}</p>
      )}
    </Card>
  )
}
