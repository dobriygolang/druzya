// TutorListingsPage — Wave 9.1 tutor-side manage UI.
//
// Route `/tutor/listings` (gated). Tutors create draft listings, fill
// in details + Boosty URL, and click «Publish» when ready. Schema
// requires a non-empty https boosty_url at publish time — the server
// returns InvalidArgument otherwise; we surface it inline.
import { useState } from 'react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ApiError } from '../lib/apiClient'
import {
  useArchiveListingMutation,
  useCreateListingMutation,
  useMyListingsQuery,
  usePublishListingMutation,
  useUpdateListingMutation,
  type TutorListing,
} from '../lib/queries/tutor'

const TRACKS = ['dev', 'dev_senior', 'sysanalyst', 'product_analyst', 'qa', 'devops', 'english']

export default function TutorListingsPage() {
  const q = useMyListingsQuery()
  const items = q.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
          TUTOR · LISTINGS
        </p>
        <h1 className="font-display text-3xl font-semibold">Твои публикации</h1>
        <p className="text-[13px] text-text-secondary">
          Запусти витрину на /marketplace. Деньги собираются через Boosty
          — добавь ссылку на свою страницу подписки до публикации.
        </p>
      </header>

      <CreateListingForm />

      {q.isPending && <p className="text-[13px] text-text-secondary">Загружаем…</p>}
      {items.length === 0 && q.isSuccess && (
        <Card className="flex-col gap-1 p-6 text-center" interactive={false}>
          <p className="text-[14px] text-text-secondary">
            Пока ни одного листинга. Создай первый.
          </p>
        </Card>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((l) => (
          <li key={l.id}>
            <ListingRow listing={l} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function CreateListingForm() {
  const create = useCreateListingMutation()
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [trackKind, setTrackKind] = useState('dev')
  const [hourlyMajor, setHourlyMajor] = useState('1500')
  const [boostyURL, setBoostyURL] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const rate = Math.round(Number(hourlyMajor) * 100)
    if (!slug || !title || !Number.isFinite(rate) || rate <= 0) return
    create.mutate(
      {
        slug,
        title: title.trim(),
        summary: '',
        body_md: '',
        track_kind: trackKind,
        languages: ['ru'],
        hourly_rate_minor: rate,
        currency: 'RUB',
        boosty_url: boostyURL.trim(),
      },
      {
        onSuccess: () => {
          setSlug('')
          setTitle('')
          setBoostyURL('')
        },
      },
    )
  }

  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        Создать draft
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="slug-в-урле (eng-with-maria)"
            minLength={3}
            maxLength={64}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            required
          />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="English с Марией — Tier-1 разговорный"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            required
          />
          <select
            value={trackKind}
            onChange={(e) => setTrackKind(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
          >
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={hourlyMajor}
            onChange={(e) => setHourlyMajor(e.target.value)}
            placeholder="₽/час"
            min={1}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
            required
          />
        </div>
        <input
          type="url"
          value={boostyURL}
          onChange={(e) => setBoostyURL(e.target.value)}
          placeholder="https://boosty.to/your-tutor-page (нужно для publish)"
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Создаём…' : 'Create draft'}
          </Button>
          {create.isError && (
            <span className="text-[12px] text-danger">
              {create.error instanceof ApiError ? create.error.body : 'Ошибка'}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function ListingRow({ listing }: { listing: TutorListing }) {
  const update = useUpdateListingMutation()
  const publish = usePublishListingMutation()
  const archive = useArchiveListingMutation()
  const [boosty, setBoosty] = useState(listing.boosty_url)

  const isPublished = Boolean(listing.published_at) && !listing.archived_at
  const isArchived = Boolean(listing.archived_at)

  const onSaveBoosty = () => {
    update.mutate({
      listing_id: listing.id,
      slug: listing.slug,
      title: listing.title,
      summary: listing.summary,
      body_md: listing.body_md,
      track_kind: listing.track_kind,
      languages: listing.languages,
      hourly_rate_minor: listing.hourly_rate_minor,
      currency: listing.currency,
      boosty_url: boosty.trim(),
    })
  }

  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <p className="font-display text-base font-semibold">{listing.title}</p>
          <p className="font-mono text-[11px] text-text-muted">
            /{listing.slug} · {listing.track_kind} ·{' '}
            {(listing.hourly_rate_minor / 100).toLocaleString('ru-RU')} ₽/час
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
            isArchived
              ? 'bg-surface-2 text-text-muted'
              : isPublished
                ? 'bg-success/20 text-success'
                : 'bg-surface-2 text-text-muted'
          }`}
        >
          {isArchived ? 'archived' : isPublished ? 'published' : 'draft'}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="url"
          value={boosty}
          onChange={(e) => setBoosty(e.target.value)}
          placeholder="https://boosty.to/…"
          className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary"
        />
        <Button type="button" onClick={onSaveBoosty} disabled={update.isPending}>
          {update.isPending ? '…' : 'Save Boosty URL'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!isPublished && !isArchived && (
          <Button
            type="button"
            onClick={() => publish.mutate(listing.id)}
            disabled={publish.isPending}
          >
            {publish.isPending ? 'Публикуем…' : 'Publish'}
          </Button>
        )}
        {!isArchived && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => archive.mutate(listing.id)}
            disabled={archive.isPending}
          >
            {archive.isPending ? '…' : 'Archive'}
          </Button>
        )}
        {publish.isError && (
          <span className="text-[12px] text-danger">
            {publish.error instanceof ApiError ? publish.error.body : 'Не получилось'}
          </span>
        )}
      </div>
    </Card>
  )
}
