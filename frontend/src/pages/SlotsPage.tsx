import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  PageHeader,
  Badge,
  Button,
  InsetGroove,
} from '../components/chrome'
import {
  useSlotsQuery,
  useBookSlot,
  type Slot,
  type SlotBooking,
} from '../lib/queries/slot'

/**
 * Live-mock slot booking.
 * Bible §3.3 (live-mock flow) + §19.3 (slot schema).
 *
 * UX:
 *  - Left column: filter bar (section chips) + grid of slot cards.
 *  - On successful booking → modal with Google Meet url placeholder.
 *  - Bookings ARE reflected in the card — "spots_left=0" slots render
 *    as "Забронировано" with the meet link surfaced.
 */

type SectionKey = Slot['section'] | 'all'

const SECTION_ACCENT: Record<string, string> = {
  algorithms: 'var(--sec-algo-accent)',
  sql: 'var(--sec-sql-accent)',
  go: 'var(--sec-go-accent)',
  system_design: 'var(--sec-sd-accent)',
  behavioral: 'var(--sec-beh-accent)',
}

function formatStartsAt(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  const time = d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return { date, time }
}

export default function SlotsPage() {
  const { t } = useTranslation()
  const { data, isLoading } = useSlotsQuery()
  const book = useBookSlot()
  const [section, setSection] = useState<SectionKey>('all')
  const [justBooked, setJustBooked] = useState<{
    slot: Slot
    booking: SlotBooking
  } | null>(null)

  const bookedByIdx = useMemo(() => {
    const m = new Map<string, SlotBooking>()
    for (const b of data?.bookings ?? []) m.set(b.slot_id, b)
    return m
  }, [data?.bookings])

  const filteredSlots = (data?.slots ?? []).filter(
    (s) => section === 'all' || s.section === section,
  )

  return (
    <AppShell>
      <PageHeader
        title="Слоты менторов"
        subtitle="LIVE-MOCK · запись на интервью с наставниками"
        right={
          <Badge variant="gold">
            {data?.slots.length ?? 0} слот{data?.slots.length === 1 ? '' : 'ов'}
          </Badge>
        }
      />

      {/* Section filter chips */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        {(
          [
            'all',
            'algorithms',
            'sql',
            'go',
            'system_design',
            'behavioral',
          ] as SectionKey[]
        ).map((s) => {
          const active = section === s
          const accent =
            s === 'all'
              ? 'var(--gold)'
              : SECTION_ACCENT[s] ?? 'var(--gold)'
          return (
            <button
              key={s}
              onClick={() => setSection(s)}
              className="tile-button"
              style={{
                padding: '6px 14px',
                fontFamily: 'var(--font-display)',
                fontSize: 10,
                letterSpacing: '0.2em',
                color: active ? 'var(--gold-bright)' : 'var(--text-mid)',
                background: active
                  ? 'rgba(200,169,110,0.08)'
                  : 'var(--bg-inset)',
                border: `1px solid ${active ? accent : 'var(--gold-faint)'}`,
                cursor: 'pointer',
              }}
            >
              {s === 'all' ? 'Все' : t(`sections.${s}`, s)}
            </button>
          )
        })}
      </div>

      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        {isLoading && (
          <div style={{ color: 'var(--text-dim)' }}>{t('common.loading')}</div>
        )}
        {!isLoading && filteredSlots.length === 0 && (
          <div style={{ color: 'var(--text-dim)' }}>{t('common.empty')}</div>
        )}
        {filteredSlots.map((s) => {
          const accent = SECTION_ACCENT[s.section] ?? 'var(--gold)'
          const booking = bookedByIdx.get(s.id)
          const fullyBooked = !booking && s.spots_left <= 0
          const when = formatStartsAt(s.starts_at)
          return (
            <div
              key={s.id}
              className={booking || fullyBooked ? '' : 'tile-button'}
              style={{
                padding: 16,
                background:
                  'linear-gradient(180deg, rgba(13,14,18,0.95), rgba(10,12,16,0.95))',
                border: `1px solid ${
                  booking ? 'var(--gold-bright)' : accent
                }`,
                boxShadow: booking
                  ? '0 0 14px 0 rgba(232,200,122,0.25)'
                  : `0 0 10px 0 color-mix(in srgb, ${accent} 18%, transparent)`,
                opacity: fullyBooked ? 0.55 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  className="caps"
                  style={{
                    color: accent,
                    fontSize: 9,
                    letterSpacing: '0.25em',
                  }}
                >
                  {t(`sections.${s.section}`, s.section)}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-mid)',
                  }}
                >
                  ELO {s.mentor.elo}
                </span>
              </div>
              <div>
                <div
                  className="heraldic"
                  style={{
                    color: 'var(--gold-bright)',
                    fontSize: 14,
                  }}
                >
                  {s.mentor.username}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-mid)',
                    marginTop: 2,
                  }}
                >
                  {s.mentor.title}
                </div>
              </div>
              <InsetGroove>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--text-bright)' }}>
                    {when.date}
                  </span>
                  <span
                    className="mono"
                    style={{ color: 'var(--gold-bright)' }}
                  >
                    {when.time} · {s.duration_min} мин
                  </span>
                </div>
              </InsetGroove>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color:
                      s.price_ai_credits === 0
                        ? 'var(--tier-normal)'
                        : 'var(--ember-lit)',
                  }}
                >
                  {s.price_ai_credits === 0
                    ? 'FREE'
                    : `${s.price_ai_credits} credits`}
                </span>
                {booking ? (
                  <a
                    href={booking.meet_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <Button tone="primary" size="sm">
                      Присоединиться →
                    </Button>
                  </a>
                ) : fullyBooked ? (
                  <Button tone="ghost" size="sm" disabled>
                    Занято
                  </Button>
                ) : (
                  <Button
                    tone="blood"
                    size="sm"
                    disabled={book.isPending}
                    onClick={async () => {
                      try {
                        const res = await book.mutateAsync(s.id)
                        setJustBooked({ slot: s, booking: res })
                      } catch {
                        // STUB: surface error toast once toast system exists
                      }
                    }}
                  >
                    {book.isPending ? '…' : 'Забронировать'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirmation modal */}
      {justBooked && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setJustBooked(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 460,
              width: '90%',
              padding: 24,
              background: 'var(--bg-card)',
              border: '1px solid var(--gold-bright)',
              boxShadow: '0 0 32px 0 rgba(232,200,122,0.35)',
            }}
          >
            <div
              className="heraldic"
              style={{
                color: 'var(--gold-bright)',
                fontSize: 18,
                letterSpacing: '0.1em',
              }}
            >
              ✦ Слот забронирован
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: 'var(--text-bright)',
                lineHeight: 1.55,
              }}
            >
              {justBooked.slot.mentor.username} ждёт тебя
              {' '}
              {formatStartsAt(justBooked.slot.starts_at).date} в{' '}
              {formatStartsAt(justBooked.slot.starts_at).time}.
            </div>
            <InsetGroove style={{ marginTop: 14 }}>
              <div
                className="caps"
                style={{
                  color: 'var(--gold-dim)',
                  fontSize: 9,
                  marginBottom: 4,
                }}
              >
                Ссылка на встречу
              </div>
              <a
                href={justBooked.booking.meet_url}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{
                  fontSize: 12,
                  color: 'var(--gold-bright)',
                  wordBreak: 'break-all',
                }}
              >
                {justBooked.booking.meet_url}
              </a>
            </InsetGroove>
            <div
              style={{
                marginTop: 18,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <Button tone="ghost" onClick={() => setJustBooked(null)}>
                Закрыть
              </Button>
              <a
                href={justBooked.booking.meet_url}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <Button tone="primary">Открыть →</Button>
              </a>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
