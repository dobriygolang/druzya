import { useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Button,
  InsetGroove,
  Badge,
} from '../components/chrome'
import { useMockReportQuery } from '../lib/queries/mock'

/**
 * Replay viewer — renders the recorded mock-session video + a right-rail
 * timeline of key events. Bible §20.4 "GhostRuns".
 *
 * Video is pulled from MinIO via `report.replay_url`. In MSW dev mode this
 * is always null so we render a friendly placeholder rather than a broken
 * <video> element.
 *
 * Events are currently stubbed (ListSessionEvents RPC pending). Shape
 * mirrors the planned response so the render code won't change when the
 * real API lands.
 */

type EventKind = 'start' | 'hint' | 'submit' | 'verdict' | 'finish'

type ReplayEvent = {
  at_sec: number
  kind: EventKind
  label: string
  detail?: string
}

const KIND_META: Record<
  EventKind,
  { color: string; icon: string; label: string }
> = {
  start: { color: 'var(--text-mid)', icon: '▶', label: 'START' },
  hint: { color: 'var(--ember-lit)', icon: '◈', label: 'HINT' },
  submit: { color: 'var(--gold)', icon: '⇧', label: 'SUBMIT' },
  verdict: { color: 'var(--tier-normal)', icon: '✓', label: 'VERDICT' },
  finish: { color: 'var(--blood-lit)', icon: '✦', label: 'FINISH' },
}

// STUB events — `ListSessionEvents` RPC pending. Timestamps in seconds.
const STUB_EVENTS: ReplayEvent[] = [
  { at_sec: 0, kind: 'start', label: 'Сессия начата' },
  { at_sec: 92, kind: 'hint', label: 'AI-подсказка', detail: 'Обсуждение O(n log n)' },
  { at_sec: 240, kind: 'submit', label: 'Первая попытка', detail: 'WA на edge case' },
  { at_sec: 318, kind: 'hint', label: 'AI-подсказка', detail: 'Два указателя vs hash map' },
  { at_sec: 512, kind: 'submit', label: 'Вторая попытка' },
  { at_sec: 524, kind: 'verdict', label: 'ACCEPTED', detail: 'All 12 tests passed' },
  { at_sec: 720, kind: 'finish', label: 'Сессия завершена' },
]

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function MockReplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { data: report } = useMockReportQuery(sessionId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cursor, setCursor] = useState<number>(0)

  const totalDuration = useMemo(
    () => STUB_EVENTS[STUB_EVENTS.length - 1]?.at_sec ?? 720,
    [],
  )

  const jumpTo = (sec: number) => {
    setCursor(sec)
    if (videoRef.current) videoRef.current.currentTime = sec
  }

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20 }}>
        <PageHeader
          title="Реплей мок-сессии"
          subtitle={sessionId ? `SESSION ${sessionId.slice(0, 8)}` : undefined}
          right={
            <div style={{ display: 'flex', gap: 10 }}>
              <Link
                to={`/mock/${sessionId}/result`}
                style={{ textDecoration: 'none' }}
              >
                <Button tone="ghost">← К результату</Button>
              </Link>
            </div>
          }
        />

        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr',
            gap: 20,
            alignItems: 'flex-start',
          }}
        >
          {/* Video panel */}
          <Panel>
            <PanelHead>Запись</PanelHead>
            <div style={{ padding: 14 }}>
              {report?.replay_url ? (
                <video
                  ref={videoRef}
                  src={report.replay_url}
                  controls
                  preload="metadata"
                  onTimeUpdate={(e) => setCursor(Math.floor(e.currentTarget.currentTime))}
                  style={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    background: 'var(--bg-void)',
                    border: '1px solid var(--gold-dim)',
                  }}
                />
              ) : (
                <InsetGroove
                  style={{
                    aspectRatio: '16 / 9',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    background:
                      'radial-gradient(ellipse at 50% 40%, rgba(200,169,110,0.08), transparent 60%), var(--bg-inset)',
                  }}
                >
                  <div
                    className="heraldic"
                    style={{
                      color: 'var(--gold-dim)',
                      fontSize: 16,
                      letterSpacing: '0.3em',
                    }}
                  >
                    ◉ GHOSTRUN
                  </div>
                  <div
                    style={{
                      color: 'var(--text-mid)',
                      fontSize: 12,
                      maxWidth: 380,
                      textAlign: 'center',
                      lineHeight: 1.55,
                    }}
                  >
                    Запись пока недоступна — сессии до апреля 2026 не
                    фиксировались. После ближайшего mock'а здесь появится
                    видео + синхронные события справа.
                  </div>
                  <div
                    className="mono"
                    style={{
                      marginTop: 8,
                      fontSize: 9,
                      color: 'var(--text-dim)',
                      letterSpacing: '0.2em',
                    }}
                  >
                    STUB · ListSessionEvents RPC pending
                  </div>
                </InsetGroove>
              )}

              {/* Scrubber — static render over STUB_EVENTS even without video */}
              <div style={{ marginTop: 14, position: 'relative', height: 28 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 12,
                    height: 4,
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--gold-faint)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 12,
                    height: 4,
                    width: `${Math.min(100, (cursor / totalDuration) * 100)}%`,
                    background:
                      'linear-gradient(90deg, var(--gold), var(--gold-bright))',
                  }}
                />
                {STUB_EVENTS.map((e) => {
                  const pct = (e.at_sec / totalDuration) * 100
                  const meta = KIND_META[e.kind]
                  return (
                    <button
                      key={`${e.kind}-${e.at_sec}`}
                      onClick={() => jumpTo(e.at_sec)}
                      title={`${meta.label} · ${fmtTime(e.at_sec)} · ${e.label}`}
                      style={{
                        position: 'absolute',
                        left: `calc(${pct}% - 5px)`,
                        top: 8,
                        width: 12,
                        height: 12,
                        background: meta.color,
                        border: '1px solid var(--bg-void)',
                        transform: 'rotate(45deg)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                      aria-label={`jump to ${meta.label}`}
                    />
                  )
                })}
              </div>
              <div
                className="mono"
                style={{
                  marginTop: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: 'var(--text-mid)',
                  letterSpacing: '0.18em',
                }}
              >
                <span>{fmtTime(cursor)}</span>
                <span>{fmtTime(totalDuration)}</span>
              </div>
            </div>
          </Panel>

          {/* Events timeline */}
          <Panel>
            <PanelHead>События</PanelHead>
            <div
              style={{
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                maxHeight: 520,
                overflow: 'auto',
              }}
            >
              {STUB_EVENTS.map((e, i) => {
                const meta = KIND_META[e.kind]
                const active = cursor >= e.at_sec
                return (
                  <button
                    key={i}
                    onClick={() => jumpTo(e.at_sec)}
                    style={{
                      textAlign: 'left',
                      padding: 10,
                      background: active
                        ? 'rgba(200,169,110,0.06)'
                        : 'var(--bg-inset)',
                      border: `1px solid ${
                        active ? meta.color : 'var(--gold-faint)'
                      }`,
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        flexShrink: 0,
                        background: meta.color,
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--bg-void)',
                        fontSize: 11,
                        fontFamily: 'var(--font-display)',
                        transform: 'rotate(45deg)',
                      }}
                    >
                      <span style={{ transform: 'rotate(-45deg)' }}>
                        {meta.icon}
                      </span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                        }}
                      >
                        <span
                          className="caps"
                          style={{ color: meta.color, fontSize: 9 }}
                        >
                          {meta.label}
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-dim)',
                          }}
                        >
                          {fmtTime(e.at_sec)}
                        </span>
                      </div>
                      <div
                        style={{
                          color: 'var(--text-bright)',
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {e.label}
                      </div>
                      {e.detail && (
                        <div
                          style={{
                            color: 'var(--text-mid)',
                            fontSize: 10,
                            marginTop: 2,
                          }}
                        >
                          {e.detail}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 8,
                  borderTop: '1px solid var(--gold-faint)',
                }}
              >
                <Badge variant="dim">
                  {STUB_EVENTS.length} events · {fmtTime(totalDuration)} total
                </Badge>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}
