import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  InsetGroove,
} from '../components/chrome'
import { usePodcastCatalogQuery } from '../lib/queries/codex'

export default function CodexPage() {
  const { t } = useTranslation()
  const [section, setSection] = useState<string | 'all'>('all')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const { data } = usePodcastCatalogQuery()

  const episodes =
    (data?.episodes ?? []).filter(
      (e) => section === 'all' || e.section === section,
    ) ?? []

  return (
    <AppShell>
      <PageHeader title={t('codex.title')} subtitle={t('codex.subtitle')} />
      <div
        data-stagger
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <Panel>
          <PanelHead subtitle="SECTIONS">Разделы</PanelHead>
          <div
            style={{
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <button
              onClick={() => setSection('all')}
              className={`tab ${section === 'all' ? 'active' : ''}`}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                color:
                  section === 'all'
                    ? 'var(--gold-bright)'
                    : 'var(--text-mid)',
                background:
                  section === 'all'
                    ? 'rgba(200,169,110,0.06)'
                    : 'transparent',
                borderLeft:
                  section === 'all'
                    ? '2px solid var(--gold)'
                    : '2px solid transparent',
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: '0.15em',
              }}
            >
              Все · {data?.episodes.length ?? 0}
            </button>
            {(data?.sections ?? []).map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`tab ${section === s.key ? 'active' : ''}`}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  color:
                    section === s.key
                      ? 'var(--gold-bright)'
                      : 'var(--text-mid)',
                  background:
                    section === s.key
                      ? 'rgba(200,169,110,0.06)'
                      : 'transparent',
                  borderLeft:
                    section === s.key
                      ? '2px solid var(--gold)'
                      : '2px solid transparent',
                  fontFamily: 'var(--font-display)',
                  fontSize: 11,
                  letterSpacing: '0.15em',
                }}
              >
                {s.title} · {s.count}
              </button>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead subtitle="PODCASTS">{t('codex.podcasts')}</PanelHead>
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {episodes.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                {t('common.empty')}
              </div>
            )}
            {episodes.map((ep) => {
              const playing = playingId === ep.id
              return (
                <InsetGroove key={ep.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    <VinylPlayButton
                      playing={playing}
                      onClick={() =>
                        setPlayingId(playing ? null : ep.id)
                      }
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="heraldic"
                        style={{
                          color: 'var(--gold-bright)',
                          fontSize: 13,
                        }}
                      >
                        {ep.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-mid)',
                          marginTop: 2,
                        }}
                      >
                        {ep.description}
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <Waveform
                          seed={ep.id}
                          progress={playing ? 0.35 : 0}
                          width={220}
                        />
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-mid)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ep.duration_min}:00
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <Badge variant="ember">{ep.section}</Badge>
                        {ep.listened && (
                          <Badge variant="normal">listened</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </InsetGroove>
              )
            })}
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}

/** Vinyl-disc play button — gold seal + pause-bars overlay when playing. */
function VinylPlayButton({
  playing,
  onClick,
}: {
  playing: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={playing ? 'pause' : 'play'}
      style={{
        width: 60,
        height: 60,
        flexShrink: 0,
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 50% 50%, var(--bg-base), var(--bg-void))',
        border: `1.5px solid ${playing ? 'var(--gold-bright)' : 'var(--gold-dim)'}`,
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        boxShadow: playing
          ? '0 0 12px 0 color-mix(in srgb, var(--gold-bright) 50%, transparent)'
          : 'none',
        transition: 'border-color 160ms, box-shadow 160ms',
      }}
    >
      <svg
        width={48}
        height={48}
        viewBox="0 0 48 48"
        style={{
          animation: playing ? 'season-pulse 2.6s linear infinite' : 'none',
        }}
        aria-hidden
      >
        {/* Vinyl grooves */}
        {[20, 17, 14, 11, 8].map((r, i) => (
          <circle
            key={r}
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="var(--gold-dim)"
            strokeWidth="0.5"
            opacity={0.3 + i * 0.08}
          />
        ))}
        {/* Center label */}
        <circle
          cx="24"
          cy="24"
          r="6"
          fill={playing ? 'var(--gold-bright)' : 'var(--gold)'}
        />
        <circle cx="24" cy="24" r="1.5" fill="var(--bg-void)" />
      </svg>
      {/* Play / Pause overlay */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {playing ? (
          <span
            style={{
              display: 'inline-flex',
              gap: 3,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                width: 3,
                height: 12,
                background: 'var(--bg-void)',
              }}
            />
            <span
              style={{
                width: 3,
                height: 12,
                background: 'var(--bg-void)',
              }}
            />
          </span>
        ) : (
          <span
            style={{
              width: 0,
              height: 0,
              borderLeft: '8px solid var(--bg-void)',
              borderTop: '6px solid transparent',
              borderBottom: '6px solid transparent',
              marginLeft: 2,
            }}
          />
        )}
      </span>
    </button>
  )
}

/**
 * Static seeded waveform — 60 bars whose heights are derived from the
 * episode id (FNV-1a + xorshift32). Gold above the progress cursor,
 * dim below. STUB: replace with a real <audio> + AudioContext analyser
 * once player is wired.
 */
function Waveform({
  seed,
  progress,
  width = 200,
  height = 22,
}: {
  seed: string
  progress: number
  width?: number
  height?: number
}) {
  const BARS = 60
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  let s = h || 0xdeadbeef
  const rand = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s >>>= 0
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
  const bars = Array.from({ length: BARS }, () => 0.18 + rand() * 0.82)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${BARS} 20`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      {bars.map((v, i) => {
        const played = i / BARS < progress
        return (
          <rect
            key={i}
            x={i + 0.15}
            y={(1 - v) * 10 + 0.5}
            width={0.7}
            height={v * 19}
            fill={played ? 'var(--gold-bright)' : 'var(--gold-dim)'}
            opacity={played ? 0.95 : 0.7}
          />
        )
      })}
      {/* Cursor line */}
      {progress > 0 && (
        <line
          x1={progress * BARS}
          y1="0"
          x2={progress * BARS}
          y2="20"
          stroke="var(--ember-lit)"
          strokeWidth="0.4"
        />
      )}
    </svg>
  )
}

