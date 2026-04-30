// Interactive demo frames for the landing page (Wave 1.5.6–1.5.10 of
// docs/feature/plan.md). Three animated mocks — Hone / Cue / Mock
// English — running on a tiny shared state-machine. Hover pauses the
// timeline; click opens a zoom-in modal with the same frame larger.
//
// Architecture choices:
//
//   - State machine is a plain `useEffect + setTimeout` chain rather
//     than `requestAnimationFrame`. We need _frame transitions_, not
//     per-frame animation; CSS transitions handle the visual smoothing.
//
//   - Frames are declared as arrays of `{ delayMs, render }` so each
//     demo reads top-to-bottom like a storyboard.
//
//   - Mounted demos that go off-screen stop their timers via
//     IntersectionObserver — the landing has 3 demos, no point burning
//     setTimeouts when the user is reading the FAQ.
//
//   - The modal is intentionally NOT a portal — react-router-dom
//     doesn't auto-scroll-restore inside portals across our codebase
//     and a plain `position:fixed` overlay works for our use.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// ── Timeline hook ─────────────────────────────────────────────────────

export type Frame = { delayMs: number; render: ReactNode }

type TimelineState = {
  index: number
  paused: boolean
  /** Set by IntersectionObserver — frames don't advance off-screen. */
  visible: boolean
}

function useDemoTimeline(frames: Frame[], paused: boolean, visible: boolean) {
  const [index, setIndex] = useState(0)
  const idxRef = useRef(0)
  idxRef.current = index

  useEffect(() => {
    if (paused || !visible || frames.length === 0) return
    const id = window.setTimeout(() => {
      setIndex((i) => (i + 1) % frames.length)
    }, frames[index]?.delayMs ?? 2_000)
    return () => window.clearTimeout(id)
  }, [index, paused, visible, frames])

  return { index, _state: { paused, visible } as TimelineState }
}

// ── Frame wrapper ─────────────────────────────────────────────────────

type DemoFrameProps = {
  /** Optional aspect-ratio override; defaults to 4/3 (matches existing mocks). */
  aspect?: string
  /** Demo content. */
  children: ReactNode
  /** Click handler — usually opens the zoom-in modal. */
  onExpand?: () => void
  /** Hover-pause handlers wired by the parent demo via `useDemoFrameHover`. */
  onHoverChange?: (paused: boolean) => void
  /** Slot for the visibility sentinel (assigned via ref). */
  visibilityRef?: React.RefObject<HTMLDivElement>
}

function DemoFrame({ aspect = '4/3', children, onExpand, onHoverChange, visibilityRef }: DemoFrameProps) {
  return (
    <div
      ref={visibilityRef}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onClick={onExpand}
      style={{
        position: 'relative',
        aspectRatio: aspect,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--hair-2)',
        background: '#000',
        cursor: onExpand ? 'zoom-in' : 'default',
      }}
    >
      {children}
    </div>
  )
}

// ── Visibility hook (auto-pause when off-screen) ──────────────────────

function useVisible<T extends HTMLElement>(ref: React.RefObject<T | null>, threshold = 0.2): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref, threshold])
  return visible
}

// ── Modal ─────────────────────────────────────────────────────────────

type DemoModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

function DemoModal({ open, onClose, title, children }: DemoModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: '#000',
          border: '1px solid var(--hair-2)',
          borderRadius: 16,
          padding: 24,
          color: '#fff',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div className="mono" style={{ fontSize: 12, letterSpacing: '.18em', color: 'var(--ink-60)' }}>
            {title}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--hair-2)',
              borderRadius: 999,
              color: 'var(--ink-60)',
              fontSize: 11,
              padding: '6px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Esc · закрыть
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Shared helpers ────────────────────────────────────────────────────

const monoStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
}

function CursorBlink({ height = 12 }: { height?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 6,
        height,
        background: '#fff',
        marginLeft: 2,
        verticalAlign: '-2px',
        animation: 'demo-cursor 1s steps(2) infinite',
      }}
    />
  )
}

// One <style> tag injected once for the keyframes used across demos.
function DemoStyleTag() {
  return (
    <style>{`
      @keyframes demo-cursor { 0%,49%{opacity:1} 50%,100%{opacity:0} }
      @keyframes demo-pop { 0%{opacity:0;transform:translateY(4px)} 100%{opacity:1;transform:translateY(0)} }
      @keyframes demo-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      @keyframes demo-stream { 0%{width:0} 100%{width:100%} }
    `}</style>
  )
}

// ── Hone demo ─────────────────────────────────────────────────────────
//
// Loop (≈10s):
//   0 (3s): "Today" — заголовок + 3 plan-item с pop-in
//   1 (3s): "Focus 25:00" — pomodoro-таймер тикает к 24:46
//   2 (3s): AI insight card — «3h focus сегодня, +2h к прошлой неделе»

function honeFrames(): Frame[] {
  return [
    {
      delayMs: 3_000,
      render: <HoneFrameToday />,
    },
    {
      delayMs: 3_500,
      render: <HoneFrameFocus />,
    },
    {
      delayMs: 3_500,
      render: <HoneFrameInsight />,
    },
  ]
}

function HoneFrameToday() {
  const items = [
    { tag: 'dev_senior', text: 'System Design: distributed cache' },
    { tag: 'english',    text: 'Reading: chapter 4 (12 min)' },
    { tag: 'dev',        text: 'Algorithms: sliding window practice' },
  ]
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        TODAY · 30 АПР
      </div>
      <div style={{ fontSize: 22, letterSpacing: '-0.01em', marginBottom: 18 }}>
        Senior dev + English<br />
        <span style={{ color: 'var(--ink-40)', fontSize: 14 }}>3 пункта · ~1h 40m</span>
      </div>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            ...monoStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--hair)',
            opacity: 0,
            animation: `demo-pop 0.4s ease-out forwards`,
            animationDelay: `${i * 0.35}s`,
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: '.12em',
              padding: '3px 7px',
              borderRadius: 999,
              border: '1px solid var(--hair-2)',
              color: 'var(--ink-60)',
            }}
          >
            {it.tag.toUpperCase()}
          </span>
          <span style={{ fontSize: 13, fontFamily: "'Inter', sans-serif" }}>{it.text}</span>
        </div>
      ))}
    </div>
  )
}

function HoneFrameFocus() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        FOCUS · POMODORO
      </div>
      <div style={{ ...monoStyle, fontSize: 84, letterSpacing: '-0.04em', lineHeight: 1, marginBottom: 16 }}>
        24:46
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-60)', textAlign: 'center', marginBottom: 24 }}>
        SYSTEM DESIGN · DISTRIBUTED CACHE
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: 'var(--red)',
            animation: 'demo-pulse 1.4s ease-in-out infinite',
          }}
        />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-60)' }}>
          REC · 14 OF 25 MIN
        </span>
      </div>
    </div>
  )
}

function HoneFrameInsight() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        AI COACH · INSIGHT
      </div>
      <div style={{ fontSize: 18, letterSpacing: '-0.01em', lineHeight: 1.4, marginBottom: 18 }}>
        За эту неделю — <span style={{ color: '#fff', fontWeight: 600 }}>+2h focus</span> и
        прокачка conditionals в English. SD ещё проседает —
        предложу одну sysdesign-задачу на завтра.
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 28, ...monoStyle }}>
        <Stat label="FOCUS" value="14h" delta="+2h" />
        <Stat label="MOCK" value="3" delta="2 / 3 strict" />
        <Stat label="NOTES" value="8" delta="" />
      </div>
    </div>
  )
}

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-40)' }}>{label}</div>
      <div style={{ fontSize: 22, letterSpacing: '-0.02em', marginTop: 4 }}>{value}</div>
      {delta && (
        <div style={{ fontSize: 10, color: 'var(--ink-60)', marginTop: 2 }}>{delta}</div>
      )}
    </div>
  )
}

export function HoneDemo({ onExpand }: { onExpand?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const visible = useVisible(ref)
  const frames = honeFrames()
  const { index } = useDemoTimeline(frames, paused, visible)
  return (
    <DemoFrame
      onHoverChange={setPaused}
      visibilityRef={ref}
      onExpand={onExpand}
    >
      <DemoStyleTag />
      <ChromeBar label="HONE" sub={`${(index + 1).toString().padStart(2, '0')} / ${frames.length.toString().padStart(2, '0')}`} />
      <div key={index} style={{ position: 'absolute', inset: 0, animation: 'demo-pop 0.35s ease-out' }}>
        {frames[index].render}
      </div>
    </DemoFrame>
  )
}

// ── Cue demo ──────────────────────────────────────────────────────────
//
// Loop (≈7s):
//   0 (2s): "fake desktop" с кодом в IDE — ⌘⇧Space hint в углу
//   1 (3s): popup появляется, показывает streaming-ответ
//   2 (2s): popup затухает, desktop — снова без оверлея

function cueFrames(): Frame[] {
  return [
    { delayMs: 2_000, render: <CueFrameIdle /> },
    { delayMs: 3_500, render: <CueFrameAnswer /> },
    { delayMs: 1_500, render: <CueFrameFade /> },
  ]
}

function CueFrameIdle() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '46px 24px 24px',
      ...monoStyle, fontSize: 11, color: 'var(--ink-60)', lineHeight: 1.55 }}>
      <CueIdeBackdrop />
      <div style={{ position: 'absolute', right: 16, bottom: 16,
        padding: '6px 10px', borderRadius: 8, border: '1px solid var(--hair-2)',
        background: 'rgba(0,0,0,0.7)', fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)' }}>
        ⌘ ⇧ SPACE · CUE
      </div>
    </div>
  )
}

function CueFrameAnswer() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CueIdeBackdrop dim />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%,-50%)',
          width: '78%',
          background: 'rgba(8,8,8,0.92)',
          border: '1px solid var(--hair-2)',
          borderRadius: 12,
          padding: 16,
          backdropFilter: 'blur(14px)',
          animation: 'demo-pop 0.35s ease-out',
        }}
      >
        <div className="mono" style={{ fontSize: 9, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 10 }}>
          CUE · ASKING GROQ · LLAMA-3.3-70B
        </div>
        <div style={{ ...monoStyle, fontSize: 12, color: 'var(--ink-60)', marginBottom: 10 }}>
          Why does this redis lock release fail under load?
        </div>
        <div style={{ ...monoStyle, fontSize: 12, lineHeight: 1.6, color: '#fff', position: 'relative' }}>
          {'Race between SETNX and EXPIRE — '}
          <span style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap',
            verticalAlign: 'bottom', animation: 'demo-stream 2.4s steps(40) forwards' }}>
            use SET key val NX PX ttl atomically.
          </span>
          <CursorBlink />
        </div>
      </div>
    </div>
  )
}

function CueFrameFade() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CueIdeBackdrop />
    </div>
  )
}

function CueIdeBackdrop({ dim = false }: { dim?: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '46px 24px 24px', opacity: dim ? 0.4 : 1, transition: 'opacity .3s' }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.6 }}>
        <span style={{ color: 'rgb(180,140,255)' }}>func</span>{' '}
        <span style={{ color: '#fff' }}>acquireLock</span>(ctx, key) {'{'}
        <br />
        {'  '}<span style={{ color: 'var(--ink-60)' }}>// SETNX → if 1, lock acquired</span><br />
        {'  '}ok, _ := redis.SetNX(ctx, key, val, 0)<br />
        {'  '}if !ok {'{'} return ErrLocked {'}'}<br />
        {'  '}redis.Expire(ctx, key, ttl)<br />
        {'  '}<span style={{ color: 'rgb(255,140,140)' }}>// race: lock can outlive ttl</span><br />
        {'  '}return nil<br />
        {'}'}
      </div>
    </div>
  )
}

export function CueDemo({ onExpand }: { onExpand?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const visible = useVisible(ref)
  const frames = cueFrames()
  const { index } = useDemoTimeline(frames, paused, visible)
  return (
    <DemoFrame onHoverChange={setPaused} visibilityRef={ref} onExpand={onExpand}>
      <DemoStyleTag />
      <ChromeBar label="CUE" sub="STEALTH · macOS" />
      <div key={index} style={{ position: 'absolute', inset: 0 }}>
        {frames[index].render}
      </div>
    </DemoFrame>
  )
}

// ── English Mock demo ─────────────────────────────────────────────────
//
// Loop (≈11s):
//   0 (3s): AI question card — «Tell me about yourself»
//   1 (4s): user typewriter answer
//   2 (4s): rubric appears with 4 dimensions

function englishMockFrames(): Frame[] {
  return [
    { delayMs: 3_000, render: <EngFrameQuestion /> },
    { delayMs: 4_000, render: <EngFrameAnswering /> },
    { delayMs: 4_000, render: <EngFrameRubric /> },
  ]
}

function EngFrameQuestion() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        ENGLISH HR · ROUND 01
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
        <span
          style={{
            ...monoStyle,
            width: 28, height: 28, borderRadius: 999,
            background: '#fff', color: '#000', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          AI
        </span>
        <div style={{ fontSize: 16, lineHeight: 1.45 }}>
          Let's start simple — could you tell me about your most recent role
          and what you spent the last quarter on?
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--ink-40)' }}>
          YOUR TURN <CursorBlink height={10} />
        </div>
      </div>
    </div>
  )
}

function EngFrameAnswering() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        ENGLISH HR · ROUND 01
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <span
          style={{
            ...monoStyle,
            width: 22, height: 22, borderRadius: 999,
            background: 'var(--ink-60)', color: '#000', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          You
        </span>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: '#fff' }}>
          <span style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'normal',
            animation: 'demo-stream 3.2s steps(60) forwards', verticalAlign: 'bottom' }}>
            I'm a senior backend engineer at a fintech. Last quarter I led
            the redis-based rate-limit rollout — sub-millisecond p99 across
            three regions.
          </span>
          <CursorBlink height={11} />
        </div>
      </div>
    </div>
  )
}

function EngFrameRubric() {
  const dims: { key: string; score: number; note: string }[] = [
    { key: 'clarity',  score: 78, note: 'structured answers, clear cause→effect' },
    { key: 'accuracy', score: 72, note: 'minor article slips («the redis»)' },
    { key: 'range',    score: 65, note: 'reaches for precision but defaults to "stuff"' },
    { key: 'fluency',  score: 80, note: 'natural pacing, few fillers' },
  ]
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '52px 28px 28px' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 14 }}>
        RUBRIC · ROUND COMPLETE
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dims.map((d, i) => (
          <div
            key={d.key}
            style={{
              display: 'grid',
              gridTemplateColumns: '90px 56px 1fr',
              alignItems: 'center',
              gap: 10,
              opacity: 0,
              animation: 'demo-pop 0.35s ease-out forwards',
              animationDelay: `${i * 0.12}s`,
            }}
          >
            <span className="mono" style={{ fontSize: 11, letterSpacing: '.18em', color: 'var(--ink-60)' }}>
              {d.key.toUpperCase()}
            </span>
            <span style={{ ...monoStyle, fontSize: 18, letterSpacing: '-0.02em', textAlign: 'right' }}>
              {d.score}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-60)' }}>{d.note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EnglishMockDemo({ onExpand }: { onExpand?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const visible = useVisible(ref)
  const frames = englishMockFrames()
  const { index } = useDemoTimeline(frames, paused, visible)
  return (
    <DemoFrame onHoverChange={setPaused} visibilityRef={ref} onExpand={onExpand}>
      <DemoStyleTag />
      <ChromeBar label="DRUZ9.ONLINE · MOCK" sub="ENGLISH HR" />
      <div key={index} style={{ position: 'absolute', inset: 0 }}>
        {frames[index].render}
      </div>
    </DemoFrame>
  )
}

// ── Chrome bar (top of frame) ─────────────────────────────────────────

function ChromeBar({ label, sub }: { label: string; sub?: string }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--hair)',
        background: 'rgba(0,0,0,0.6)',
        position: 'relative',
        zIndex: 3,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
      <span style={{ width: 9, height: 9, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
      <span style={{ width: 9, height: 9, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
      <span className="mono" style={{ marginLeft: 12, fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-60)' }}>
        {label}
      </span>
      {sub && (
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ── Public re-exports ─────────────────────────────────────────────────

export { DemoModal }
