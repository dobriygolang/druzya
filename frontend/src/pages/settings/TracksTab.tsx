// /settings/tracks — multi-track selector mirrored from
// pages/onboarding/Step0Tracks but laid out for the Settings shell.
//
// Endpoints (см proto/druz9/v1/profile.proto):
//   GET  /api/v1/profile/me/tracks  → UserTracks
//   PUT  /api/v1/profile/me/tracks  ← UserTracks (replaces full list)
//
// Source-of-truth design: see docs/feature/tracks.md. The Save button
// is disabled until the local state diverges from server state, so a
// no-op click can't blow away started_at timestamps with a fresh write.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { api, ApiError } from '../../lib/apiClient'
import { cn } from '../../lib/cn'

type WireTrack =
  | 'TRACK_DEV'
  | 'TRACK_DEV_SENIOR'
  | 'TRACK_SYSANALYST'
  | 'TRACK_PRODUCT_ANALYST'
  | 'TRACK_QA'
  | 'TRACK_ENGLISH'

type Seniority = '' | 'junior' | 'middle' | 'senior' | 'lead'

type WireUserTrack = {
  track: WireTrack
  seniority: Seniority
  primary: boolean
  started_at?: string
  last_active_at?: string
}

type WireUserTracks = { items?: WireUserTrack[] }

type TrackCard = {
  wire: WireTrack
  title: string
  blurb: string
  needsSeniority: boolean
}

function useCards(): TrackCard[] {
  const { t } = useTranslation('pages')
  return [
    { wire: 'TRACK_DEV', title: t('tracks_tab.card.dev.title'), blurb: t('tracks_tab.card.dev.blurb'), needsSeniority: true },
    { wire: 'TRACK_DEV_SENIOR', title: t('tracks_tab.card.dev_senior.title'), blurb: t('tracks_tab.card.dev_senior.blurb'), needsSeniority: true },
    { wire: 'TRACK_SYSANALYST', title: t('tracks_tab.card.sysanalyst.title'), blurb: t('tracks_tab.card.sysanalyst.blurb'), needsSeniority: true },
    { wire: 'TRACK_PRODUCT_ANALYST', title: t('tracks_tab.card.product_analyst.title'), blurb: t('tracks_tab.card.product_analyst.blurb'), needsSeniority: true },
    { wire: 'TRACK_QA', title: t('tracks_tab.card.qa.title'), blurb: t('tracks_tab.card.qa.blurb'), needsSeniority: true },
    { wire: 'TRACK_ENGLISH', title: t('tracks_tab.card.english.title'), blurb: t('tracks_tab.card.english.blurb'), needsSeniority: false },
  ]
}

type LocalState = {
  picked: Set<WireTrack>
  seniority: Map<WireTrack, Seniority>
  primary: WireTrack | null
}

function emptyState(): LocalState {
  return { picked: new Set(), seniority: new Map(), primary: null }
}

function fromServer(items: WireUserTrack[] | undefined): LocalState {
  const s = emptyState()
  for (const it of items ?? []) {
    s.picked.add(it.track)
    if (it.track !== 'TRACK_ENGLISH') s.seniority.set(it.track, (it.seniority || 'middle') as Seniority)
    if (it.primary) s.primary = it.track
  }
  return s
}

function toWireItems(s: LocalState): WireUserTrack[] {
  return Array.from(s.picked).map((wire) => ({
    track: wire,
    seniority: wire === 'TRACK_ENGLISH' ? '' : (s.seniority.get(wire) ?? 'middle'),
    primary: s.primary === wire,
  }))
}

function snapshotKey(s: LocalState): string {
  // Stable serialization for «is dirty?» comparison. Sort keys so iteration
  // order doesn't lie; primary travels in the row it belongs to.
  const rows = Array.from(s.picked)
    .sort()
    .map((w) => `${w}:${s.seniority.get(w) ?? ''}:${s.primary === w ? '1' : '0'}`)
  return rows.join('|')
}

function reduceClick(s: LocalState, wire: WireTrack): LocalState {
  const picked = new Set(s.picked)
  const seniority = new Map(s.seniority)
  let primary = s.primary
  if (picked.has(wire)) {
    picked.delete(wire)
    seniority.delete(wire)
    if (primary === wire) {
      primary = picked.size > 0 ? picked.values().next().value ?? null : null
    }
  } else {
    picked.add(wire)
    if (wire !== 'TRACK_ENGLISH') seniority.set(wire, 'middle')
    if (primary === null) primary = wire
  }
  return { picked, seniority, primary }
}

export function TracksTab() {
  const { t } = useTranslation('pages')
  const CARDS = useCards()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['profile', 'me', 'tracks'],
    queryFn: () => api<WireUserTracks>('/profile/me/tracks'),
  })

  const [local, setLocal] = useState<LocalState>(emptyState)
  const [serverKey, setServerKey] = useState<string>('')

  useEffect(() => {
    if (query.data) {
      const s = fromServer(query.data.items)
      setLocal(s)
      setServerKey(snapshotKey(s))
    }
  }, [query.data])

  const dirty = useMemo(() => snapshotKey(local) !== serverKey, [local, serverKey])
  const canSave = local.picked.size > 0 && local.primary !== null && dirty

  const save = useMutation({
    mutationFn: () => api<WireUserTracks>('/profile/me/tracks', {
      method: 'PUT',
      body: JSON.stringify({ items: toWireItems(local) }),
    }),
    onSuccess: (data) => {
      const s = fromServer(data.items)
      setLocal(s)
      setServerKey(snapshotKey(s))
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
    },
  })

  if (query.isLoading) {
    return (
      <Card>
        <div className="p-6 text-text-secondary text-sm">{t('tracks_tab.loading')}</div>
      </Card>
    )
  }
  if (query.isError) {
    return (
      <Card>
        <div className="p-6 text-sm" style={{ color: 'var(--red)' }}>
          {t('tracks_tab.load_failed')}
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex flex-col gap-1.5 p-6 pb-4">
        <h2 className="font-display text-xl font-bold">{t('tracks_tab.heading')}</h2>
        <p className="text-sm text-text-secondary">
          {t('tracks_tab.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 px-6 pb-4 sm:grid-cols-2">
        {CARDS.map((c) => {
          const selected = local.picked.has(c.wire)
          const isPrimary = local.primary === c.wire
          return (
            <div
              key={c.wire}
              style={{
                transition:
                  'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              className={cn(
                'relative rounded-xl border p-4',
                selected ? 'border-text-primary bg-text-primary/5' : 'border-border hover:border-border-strong',
              )}
            >
              {selected && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 1.5,
                    height: 24,
                    background: 'var(--red)',
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => setLocal((s) => reduceClick(s, c.wire))}
                aria-pressed={selected}
                className="text-left w-full"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-display text-[15px] font-bold">{c.title}</div>
                  {selected && (
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-text-primary text-[10px] font-bold text-bg">
                      ✓
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-text-secondary leading-relaxed">{c.blurb}</div>
              </button>

              {selected && c.needsSeniority && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(['junior', 'middle', 'senior', 'lead'] as const).map((s) => {
                    const active = local.seniority.get(c.wire) === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setLocal((prev) => {
                          const next = new Map(prev.seniority)
                          next.set(c.wire, s)
                          return { ...prev, seniority: next }
                        })}
                        style={{
                          transition:
                            'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
                        }}
                        className={cn(
                          'rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em]',
                          active
                            ? 'border-text-primary bg-text-primary text-bg'
                            : 'border-border text-text-secondary hover:border-border-strong',
                        )}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              )}

              {selected && local.picked.size > 1 && (
                <button
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, primary: c.wire }))}
                  style={{
                    transition:
                      'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
                  }}
                  className={cn(
                    'mt-3 w-full text-center rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]',
                    isPrimary
                      ? 'border-text-primary bg-text-primary/10 text-text-primary'
                      : 'border-border text-text-muted hover:border-border-strong',
                  )}
                  aria-pressed={isPrimary}
                >
                  {isPrimary ? t('tracks_tab.is_primary') : t('tracks_tab.make_primary')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-4">
        <div className="text-[12px] text-text-secondary">
          {local.picked.size === 0
            ? t('tracks_tab.footer_none')
            : t('tracks_tab.footer_summary', { n: local.picked.size, primary: local.primary ?? t('tracks_tab.primary_none') })}
        </div>
        <div className="flex items-center gap-3">
          {save.isError && (
            <span className="text-[12px]" style={{ color: 'var(--red)' }}>
              {save.error instanceof ApiError ? save.error.body : t('tracks_tab.save_error_generic')}
            </span>
          )}
          {save.isSuccess && !dirty && (
            <span className="text-[12px] text-text-muted">{t('tracks_tab.saved_indicator')}</span>
          )}
          <Button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
          >
            {save.isPending ? t('tracks_tab.save_saving') : t('tracks_tab.save_btn')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
