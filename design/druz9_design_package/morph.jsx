// morph.jsx — Animated compact → expanded morph with scrubber.
// Uses Stage/Sprite + interpolate from animations.jsx.

function Morph() {
  return (
    <Stage width={900} height={820} duration={5} background="transparent" fit="contain" autoplay loop>
      <MorphScene />
    </Stage>
  );
}

function MorphScene() {
  const t = useTime();
  const p = Math.min(1, t / 2.8); // 0→1 morph progress then holds

  // Dims
  const w = interpolate([0, 1], [460, 520], Easing.easeInOutCubic)(p);
  const h = interpolate([0, 1], [92, 680], Easing.easeInOutCubic)(p);
  const r = interpolate([0, 1], [18, 18])(p);

  // Opacity of inner regions
  const headerOp  = p < 0.12 ? 0 : interpolate([0.12, 0.35], [0, 1], Easing.easeOutCubic)(p);
  const listOp    = p < 0.4  ? 0 : interpolate([0.4, 0.7], [0, 1], Easing.easeOutCubic)(p);
  const inputOp   = p < 0.25 ? 0 : interpolate([0.25, 0.55], [0, 1], Easing.easeOutCubic)(p);
  const compactOp = interpolate([0, 0.18, 0.25], [1, 1, 0])(p);

  return (
    <div style={{ position: 'absolute', inset: 0, background: `
      radial-gradient(900px 500px at 20% 15%, oklch(0.75 0.18 55 / 0.55), transparent 60%),
      radial-gradient(800px 600px at 85% 30%, oklch(0.65 0.22 340 / 0.55), transparent 55%),
      radial-gradient(1100px 700px at 60% 95%, oklch(0.35 0.15 260 / 0.7), transparent 55%),
      linear-gradient(180deg, oklch(0.16 0.04 275), oklch(0.08 0.03 280))` }}>

      {/* scrubber hint */}
      <div style={{
        position: 'absolute', top: 18, left: 20, fontFamily: 'var(--d9-font-mono)',
        fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        Morph · t={t.toFixed(2)}s · ⌘E to expand
      </div>

      {/* The morphing window */}
      <div style={{
        position: 'absolute',
        left: '50%', top: 120,
        transform: `translateX(-50%)`,
        width: w, height: h,
        borderRadius: r,
        background: 'linear-gradient(180deg, oklch(0.16 0.04 278 / 0.72), oklch(0.12 0.035 278 / 0.82))',
        backdropFilter: 'blur(30px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.4)',
        boxShadow: 'var(--d9-shadow-win)',
        overflow: 'hidden',
        transition: 'none',
      }} className="d9-root">
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          border: '0.5px solid var(--d9-hairline-b)', pointerEvents: 'none',
        }} />

        {/* Compact contents (fade out) */}
        <div style={{
          position: 'absolute', inset: 0, opacity: compactOp,
          padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark persona="sysdesign" size={30} />
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 6,
              height: 34, padding: '0 10px 0 12px', borderRadius: 10,
              background: 'oklch(1 0 0 / 0.05)', border: '0.5px solid var(--d9-hairline)',
            }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--d9-ink-mute)' }}>Спроси о коде или вопросе…</span>
              <Kbds keys={['⌘','⏎']} size="sm" sep=""/>
            </div>
            <IconButton>{Icon.camera(14)}</IconButton>
            <IconButton>{Icon.settings(14)}</IconButton>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 40 }}>
            <ModelPill label="claude-sonnet-4.5"/>
            <Dot/><PersonaChip personaId="sysdesign" compact/><Dot/>
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, color:'var(--d9-ink-mute)' }}>
              <StatusDot state="ready"/>Ready
            </span>
          </div>
        </div>

        {/* Expanded contents (fade in) */}
        <div style={{ position: 'absolute', inset: 0, opacity: p > 0.12 ? 1 : 0, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 12px 10px 14px',
            borderBottom: '0.5px solid var(--d9-hairline)',
            opacity: headerOp,
          }}>
            <BrandMark persona="sysdesign" size={24} />
            <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em' }}>System Design</span>
            <ModelPill label="claude-sonnet-4.5"/>
            <span style={{ flex: 1 }}/>
            <IconButton>{Icon.collapse(14)}</IconButton>
            <IconButton>{Icon.close(12)}</IconButton>
          </div>

          {/* list */}
          <div style={{ flex: 1, padding: '18px 18px 10px', opacity: listOp, overflow: 'hidden' }}>
            <MessageBubble role="user">Leader-follower vs peer-to-peer?</MessageBubble>
            <MessageBubble role="assistant" streaming>
              Выбирай leader-follower когда нужна сильная согласованность и простая модель
              записи. Один primary принимает записи, реплики
            </MessageBubble>
          </div>

          {/* input */}
          <div style={{ padding: '10px 12px 12px', borderTop: '0.5px solid var(--d9-hairline)', opacity: inputOp }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              minHeight: 44, padding: '8px 8px 8px 12px', borderRadius: 12,
              background: 'oklch(1 0 0 / 0.05)',
              border: '0.5px solid var(--d9-accent)',
              boxShadow: '0 0 0 3px var(--d9-accent-glow)',
            }}>
              <div style={{ flex: 1, fontSize: 13.5, color: 'var(--d9-ink)' }}>
                Leader-follower vs peer-to-peer?<span className="d9-caret"/>
              </div>
              <IconButton tone="accent">{Icon.arrow(14)}</IconButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Morph });
