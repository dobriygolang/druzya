import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Editor, { type Monaco } from '@monaco-editor/react'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Badge,
  Button,
  InsetGroove,
} from '../components/chrome'
import { useArenaMatchQuery } from '../lib/queries/arena'

/** Reuse the noir Monaco theme defined first in MockSessionPage. Defining
 * twice is harmless — Monaco no-ops a re-define with the same id. */
function defineDruz9Theme(monaco: Monaco) {
  monaco.editor.defineTheme('druz9-noir', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b5f54', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'e8c87a' },
      { token: 'string', foreground: '9a8c76' },
      { token: 'number', foreground: '6a9fd4' },
      { token: 'type', foreground: 'e09b3a' },
    ],
    colors: {
      'editor.background': '#0a0c10',
      'editor.foreground': '#e8dcc8',
      'editor.lineHighlightBackground': '#14100f',
      'editorCursor.foreground': '#e8c87a',
      'editorLineNumber.foreground': '#4a3c28',
      'editorLineNumber.activeForeground': '#c8a96e',
    },
  })
}

/**
 * Bible §3.4 — duel view: two players, shared timer, dual editor.
 * For now: only your own editor is interactive (Monaco).
 * Opponent's pane shows a "ghost" placeholder until the WebSocket cursor
 * stream is wired (planned in §19.2 EditorHub).
 */
export default function ArenaMatchPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: match } = useArenaMatchQuery(matchId)

  const [code, setCode] = useState('')
  const initRef = useRef(false)
  useEffect(() => {
    if (!initRef.current && match?.task?.starter_code?.go) {
      setCode(match.task.starter_code.go)
      initRef.current = true
    }
  }, [match?.task?.starter_code?.go])

  const [elapsed, setElapsed] = useState(0)
  const startedRef = useRef(Date.now())
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedRef.current), 1000)
    return () => clearInterval(id)
  }, [])

  const remainingSec = Math.max(
    0,
    Math.round((match?.task?.time_limit_sec ?? 0) - elapsed / 1000),
  )
  const mm = Math.floor(remainingSec / 60).toString().padStart(2, '0')
  const ss = (remainingSec % 60).toString().padStart(2, '0')

  if (!match) {
    return (
      <AppShell sidebars={false}>
        <div style={{ padding: 20, color: 'var(--text-dim)' }}>
          {t('common.loading')}
        </div>
      </AppShell>
    )
  }

  const [you, opponent] = match.participants

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20 }}>
        <PageHeader
          title={`Дуэль · ${match.task.title}`}
          subtitle={`MATCH ${matchId?.slice(0, 8)} · ${match.task.difficulty.toUpperCase()}`}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to="/arena" style={{ textDecoration: 'none' }}>
                <Button tone="ghost">← В арену</Button>
              </Link>
              <div
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  border: `1px solid ${
                    remainingSec < 30 ? 'var(--blood-lit)' : 'var(--gold-faint)'
                  }`,
                  background: 'var(--bg-inset)',
                  color: remainingSec < 30 ? 'var(--blood-bright)' : 'var(--gold-bright)',
                  fontSize: 14,
                  letterSpacing: '0.1em',
                }}
              >
                <span style={{ fontSize: 11 }}>⏱</span>
                <span>{mm}:{ss}</span>
              </div>
              <Button tone="primary">{t('arena.submit')}</Button>
              <Button tone="ghost" onClick={() => navigate('/arena')}>
                Forfeit
              </Button>
            </div>
          }
        />

        {/* Top strip — players */}
        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
            marginBottom: 16,
          }}
        >
          <PlayerCard
            tone="ally"
            label={t('arena.you')}
            username={you.username}
            elo={you.elo_before}
          />
          <PlayerCard
            tone="enemy"
            label={t('arena.opponent')}
            username={opponent?.username ?? '???'}
            elo={opponent?.elo_before ?? 0}
          />
        </div>

        {/* Task description */}
        <Panel style={{ marginBottom: 16 }}>
          <PanelHead>Задача</PanelHead>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <Badge variant="hard">{match.task.difficulty}</Badge>
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-bright)',
                lineHeight: 1.55,
              }}
            >
              {match.task.description}
            </div>
            <InsetGroove style={{ marginTop: 12 }}>
              {match.task.example_cases.map((c, i) => (
                <div key={i} className="mono" style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--text-mid)' }}>in: </span>
                  {c.input}
                  <br />
                  <span style={{ color: 'var(--gold-bright)' }}>out: </span>
                  {c.output}
                </div>
              ))}
            </InsetGroove>
          </div>
        </Panel>

        {/* Dual editor — left=you, right=opponent ghost */}
        <div
          data-stagger
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
            height: 'calc(100vh - 460px)',
            minHeight: 360,
          }}
        >
          <Panel style={{ display: 'flex', flexDirection: 'column' }}>
            <PanelHead>
              <span style={{ color: 'var(--gold-bright)' }}>
                Твой код
              </span>
            </PanelHead>
            <div style={{ flex: 1, background: '#0a0c10' }}>
              <Editor
                height="100%"
                defaultLanguage="go"
                language="go"
                value={code}
                onChange={(v) => setCode(v ?? '')}
                beforeMount={defineDruz9Theme}
                theme="druz9-noir"
                options={{
                  fontFamily:
                    "JetBrains Mono, Menlo, ui-monospace, monospace",
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 10, bottom: 10 },
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  tabSize: 2,
                }}
              />
            </div>
          </Panel>

          <Panel style={{ display: 'flex', flexDirection: 'column' }}>
            <PanelHead>
              <span style={{ color: 'var(--blood-lit)' }}>
                Код противника
              </span>
              <span
                style={{
                  marginLeft: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 9,
                  color: 'var(--text-mid)',
                  letterSpacing: '0.2em',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--tier-normal)',
                    boxShadow: '0 0 6px var(--tier-normal)',
                    animation: 'sigil-aura 1.6s ease-in-out infinite',
                  }}
                />
                LIVE
              </span>
            </PanelHead>
            <OpponentGhostPanel />
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

/**
 * Ghost presence panel — simulates what you'd see over a real WebSocket
 * EditorHub stream:
 *  - Static "already typed" code lines (darker)
 *  - A blinking caret at the opponent's current position
 *  - A small label with opponent's name above the caret, PoE-trade-chat style
 *
 * STUB: swap to `useEditorPresence(sessionId)` once
 * `editor.proto/EditorService.Watch` streaming RPC ships.
 */
function OpponentGhostPanel() {
  // "Typed" lines — width percentages so it looks like code without reading
  // as nonsense. Shade derived from line position to mimic syntax highlight.
  const LINES = [
    { w: 56, mono: 'func twoSum(nums []int, target int) []int {' },
    { w: 48, mono: '\u00a0\u00a0seen := map[int]int{}' },
    { w: 72, mono: '\u00a0\u00a0for i, n := range nums {' },
    { w: 84, mono: '\u00a0\u00a0\u00a0\u00a0if j, ok := seen[target - n]; ok {' },
    { w: 56, mono: '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0return []int{j, i}' },
  ]

  return (
    <div
      style={{
        flex: 1,
        background: '#0a0c10',
        padding: '12px 14px',
        fontFamily: 'var(--font-code)',
        fontSize: 12,
        color: 'var(--text-dim)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {LINES.map((l, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 20,
              textAlign: 'right',
              color: 'var(--gold-dim)',
              opacity: 0.6,
              flexShrink: 0,
            }}
          >
            {i + 1}
          </span>
          <span
            style={{
              color: i === 0 ? 'var(--gold-dim)' : 'var(--text-mid)',
              whiteSpace: 'pre',
              opacity: 0.65 + (i / LINES.length) * 0.3,
              flex: `0 0 auto`,
              maxWidth: `${l.w}%`,
              overflow: 'hidden',
              textOverflow: 'clip',
            }}
          >
            {l.mono}
          </span>
        </div>
      ))}

      {/* Opponent caret — positioned absolutely over line 5 column ~32ch */}
      <div
        style={{
          position: 'absolute',
          left: 'calc(20px + 14px + 14ch)', // gutter + gap + col offset
          top: 'calc(12px + 4 * (4px + 1em))',
          pointerEvents: 'none',
        }}
      >
        <span
          aria-label="opponent cursor"
          style={{
            display: 'inline-block',
            width: 2,
            height: '1.15em',
            background: 'var(--blood-bright)',
            boxShadow: '0 0 5px var(--blood-bright)',
            animation: 'sigil-aura 1s ease-in-out infinite',
            verticalAlign: 'text-bottom',
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 4,
            top: -18,
            fontSize: 9,
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.15em',
            padding: '1px 5px',
            background: 'var(--blood)',
            color: '#fff',
            whiteSpace: 'nowrap',
          }}
        >
          SHADOW_4821
        </span>
      </div>

      <span
        style={{
          position: 'absolute',
          bottom: 10,
          right: 14,
          fontSize: 8,
          color: 'var(--text-dim)',
          letterSpacing: '0.25em',
        }}
      >
        ◈ EDITOR PRESENCE · STUB
      </span>
    </div>
  )
}

function PlayerCard({
  tone,
  label,
  username,
  elo,
}: {
  tone: 'ally' | 'enemy'
  label: string
  username: string
  elo: number
}) {
  const accent = tone === 'ally' ? 'var(--gold-bright)' : 'var(--blood-lit)'
  const initial = username.charAt(0).toUpperCase()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        background: 'var(--bg-inset)',
        border: `1px solid ${accent}`,
        boxShadow: `0 0 10px 0 color-mix(in srgb, ${accent} 25%, transparent)`,
      }}
    >
      <svg width={42} height={48} viewBox="0 0 30 34">
        <polygon
          points="15,2 27,6 27,24 15,32 3,24 3,6"
          fill={tone === 'ally' ? 'var(--gold-faint)' : 'var(--blood-deep)'}
          stroke={accent}
          strokeWidth="1.4"
        />
        <text
          x="15"
          y="21"
          textAnchor="middle"
          fill={accent}
          fontFamily="var(--font-display)"
          fontSize="14"
        >
          {initial}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="caps"
          style={{ color: accent, fontSize: 9, letterSpacing: '0.3em' }}
        >
          {label}
        </div>
        <div
          className="heraldic"
          style={{ color: 'var(--text-bright)', fontSize: 14, marginTop: 2 }}
        >
          {username}
        </div>
        <div
          className="mono"
          style={{ color: 'var(--text-mid)', fontSize: 11, marginTop: 1 }}
        >
          ELO {elo}
        </div>
      </div>
    </div>
  )
}
