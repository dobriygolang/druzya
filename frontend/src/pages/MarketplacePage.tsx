// MarketplacePage — Wave 9.1 of docs/feature/plan.md.
//
// Public route `/marketplace`. Lists published tutor listings with a
// track-kind filter. Each card links to /marketplace/{slug} for the
// detail page; checkout itself is Boosty-only — handled by the detail
// page's outbound link.
//
// No auth gate: the underlying GET /api/v1/marketplace/listings is
// explicitly whitelisted in router.go's restAuthGate.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Card } from '../components/Card'
import { useBrowseListingsQuery, type TutorListing } from '../lib/queries/tutor'

const TRACK_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все треки' },
  { value: 'dev', label: 'Dev' },
  { value: 'dev_senior', label: 'Dev Senior' },
  { value: 'sysanalyst', label: 'Sysanalyst' },
  { value: 'product_analyst', label: 'Product Analyst' },
  { value: 'qa', label: 'QA' },
  { value: 'devops', label: 'DevOps' },
  { value: 'english', label: 'English' },
]

function formatRate(minor: number, currency: string): string {
  const major = minor / 100
  const sym = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency
  return `${major.toLocaleString('ru-RU')} ${sym}/час`
}

export default function MarketplacePage() {
  const [track, setTrack] = useState('')
  const [maxRateMajor, setMaxRateMajor] = useState('')

  const filter = useMemo(() => {
    const f: { track_kinds?: string[]; max_rate_minor?: number } = {}
    if (track) f.track_kinds = [track]
    const n = Number(maxRateMajor)
    if (Number.isFinite(n) && n > 0) f.max_rate_minor = Math.round(n * 100)
    return f
  }, [track, maxRateMajor])

  const q = useBrowseListingsQuery(filter)
  const items = q.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
          MARKETPLACE
        </p>
        <h1 className="font-display text-3xl font-semibold">Найти тутора</h1>
        <p className="max-w-2xl text-[14px] leading-relaxed text-text-secondary">
          Платные занятия идут через Boosty — клик по карточке откроет
          страницу подписки тутора. После оплаты тутор пришлёт инвайт-код,
          и ты увидишь общий календарь и заметки внутри Hone.
        </p>
      </header>

      <Card className="flex-row flex-wrap items-end gap-3 p-4" interactive={false}>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Track
          </span>
          <select
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
          >
            {TRACK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Max rate (₽/час)
          </span>
          <input
            type="number"
            value={maxRateMajor}
            onChange={(e) => setMaxRateMajor(e.target.value)}
            placeholder="∞"
            min={0}
            className="w-32 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </Card>

      {q.isPending && <p className="text-[13px] text-text-secondary">Загружаем…</p>}
      {q.isError && (
        <p className="text-[13px] text-danger">Не удалось загрузить листинги.</p>
      )}
      {q.isSuccess && items.length === 0 && (
        <Card className="flex-col gap-1 p-6 text-center" interactive={false}>
          <p className="text-[14px] text-text-secondary">
            Под этот фильтр пока ничего нет.
          </p>
        </Card>
      )}

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((l) => (
          <li key={l.id}>
            <ListingCard listing={l} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ListingCard({ listing }: { listing: TutorListing }) {
  return (
    <Link
      to={`/marketplace/${encodeURIComponent(listing.slug)}`}
      className="group block h-full"
    >
      <Card className="flex-col gap-2 p-5 transition group-hover:border-text-primary" interactive>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {listing.track_kind}
          </span>
          {listing.languages.map((lang) => (
            <span
              key={lang}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-text-muted"
            >
              {lang}
            </span>
          ))}
        </div>
        <h3 className="font-display text-lg font-semibold text-text-primary">{listing.title}</h3>
        {listing.summary && (
          <p className="line-clamp-3 text-[13px] leading-relaxed text-text-secondary">
            {listing.summary}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[12px] text-text-primary">
            {formatRate(listing.hourly_rate_minor, listing.currency)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            подробнее →
          </span>
        </div>
      </Card>
    </Link>
  )
}
