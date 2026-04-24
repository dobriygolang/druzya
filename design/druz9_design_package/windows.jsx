// windows.jsx — Druz9 window mockups: Compact, Expanded, Settings, Area-overlay.

const { useState: useS, useEffect: useE } = React;

// ─── Compact window (460×92, top-right floating) ─────────────
function CompactWindow({ state = 'idle', persona = 'sysdesign', personaOpen = false, variant = 'v1', glass = 'heavy' }) {
  const p = PERSONA[persona] || PERSONA.sysdesign;
  const isV2 = variant === 'v2';

  return (
    <div style={{ position: 'relative' }}>
      <WindowShell width={460} height={92} radius={18} glass={glass}>
        <div className="d9-root" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
          {/* Row 1 — primary input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark persona={persona} size={30} />

            {/* Input pill */}
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 6,
              height: 34, padding: '0 10px 0 12px',
              borderRadius: 10,
              background: 'oklch(1 0 0 / 0.05)',
              border: '0.5px solid var(--d9-hairline)',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.04)',
            }}>
              <span style={{
                flex: 1, fontSize: 13, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em',
              }}>
                {state === 'idle'    && 'Спроси о коде или вопросе…'}
                {state === 'thinking'&& <span style={{ color: 'var(--d9-ink-dim)' }}>Объясни сложность этого алгоритма</span>}
                {state === 'streaming'&&<span style={{ color: 'var(--d9-ink-dim)' }}>Объясни сложность этого алгоритма</span>}
              </span>
              <Kbds keys={['⌘','⏎']} size="sm" sep="" />
            </div>

            <IconButton title="Screenshot region">{Icon.camera(14)}</IconButton>
            <IconButton title="Settings">{Icon.settings(14)}</IconButton>
          </div>

          {/* Row 2 — status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: isV2 ? 0 : 40, height: 22 }}>
            {/* Model picker */}
            <ModelPill label="claude-sonnet-4.5" />
            <Dot />
            {/* Persona picker */}
            <PersonaChip personaId={persona} compact />
            <Dot />
            {/* Status */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>
              <StatusDot state={state === 'idle' ? 'ready' : state} size={6} />
              {state === 'idle' && 'Ready'}
              {state === 'thinking' && 'Thinking…'}
              {state === 'streaming' && 'Streaming…'}
            </span>
            <span style={{ flex: 1 }} />
            <QuotaMeterMini used={38} cap={100} />
          </div>
        </div>
      </WindowShell>

      {/* Persona dropdown */}
      {personaOpen && <PersonaDropdown activeId={persona} />}

      {/* Streaming bottom hairline */}
      {state === 'streaming' && <StreamingHairline />}
    </div>
  );
}

function Dot() {
  return <span style={{ width: 2, height: 2, borderRadius: 2, background: 'var(--d9-ink-ghost)', opacity: 0.6 }} />;
}

function ModelPill({ label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, color: 'var(--d9-ink-dim)',
      fontFamily: 'var(--d9-font-mono)', letterSpacing: '-0.01em',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 1, background: 'var(--d9-accent)', boxShadow: '0 0 6px var(--d9-accent-glow)' }} />
      {label}
      <Caret />
    </span>
  );
}

function QuotaMeterMini({ used, cap }) {
  const pct = Math.min(100, (used / cap) * 100);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 44, height: 3, borderRadius: 2,
        background: 'oklch(1 0 0 / 0.08)', overflow: 'hidden', display: 'inline-block',
      }}>
        <span style={{
          display: 'block', height: '100%', width: pct + '%',
          background: 'linear-gradient(90deg, var(--d9-accent-lo), var(--d9-accent-hi))',
        }} />
      </span>
      <span style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 10, color: 'var(--d9-ink-mute)', fontVariantNumeric: 'tabular-nums' }}>
        {used}<span style={{ color: 'var(--d9-ink-ghost)' }}>/{cap}</span>
      </span>
    </span>
  );
}

function StreamingHairline() {
  return (
    <div style={{
      position: 'absolute', left: 18, right: 18, bottom: 0, height: 1.5,
      background: 'linear-gradient(90deg, transparent, var(--d9-accent-hi) 30%, var(--d9-accent) 50%, var(--d9-accent-hi) 70%, transparent)',
      backgroundSize: '200% 100%',
      animation: 'd9stream 1.8s linear infinite',
      borderRadius: 2,
      filter: 'blur(0.3px)',
    }} />
  );
}

// ─── Persona dropdown ────────────────────────────────────────
function PersonaDropdown({ activeId }) {
  return (
    <div style={{
      position: 'absolute', top: 100, left: 210, width: 260,
      borderRadius: 14,
      background: 'linear-gradient(180deg, oklch(0.18 0.04 278 / 0.82), oklch(0.13 0.035 278 / 0.92))',
      backdropFilter: 'var(--d9-glass-blur)',
      WebkitBackdropFilter: 'var(--d9-glass-blur)',
      boxShadow: 'var(--d9-shadow-pop)',
      padding: 6,
      zIndex: 20,
    }} className="d9-root">
      <div style={{
        padding: '8px 10px 6px',
        fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--d9-ink-ghost)', fontFamily: 'var(--d9-font-mono)',
      }}>Persona</div>
      {PERSONAS.map(p => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 9,
          background: p.id === activeId ? 'oklch(1 0 0 / 0.06)' : 'transparent',
        }}>
          <span className={p.grad} style={{
            width: 22, height: 22, borderRadius: 7,
            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 12px -2px currentColor',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--d9-font-display)', fontStyle: 'italic',
            fontSize: 13, color: 'rgba(255,255,255,0.95)',
          }}>9</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: 'var(--d9-ink)', fontWeight: 500, letterSpacing: '-0.01em' }}>{p.label}</div>
            <div style={{ fontSize: 10.5, color: 'var(--d9-ink-mute)' }}>{p.sub}</div>
          </div>
          {p.id === activeId && <span style={{ color: 'var(--d9-accent-hi)' }}>{Icon.check(12)}</span>}
          <Kbd size="sm">⌥{p.hot}</Kbd>
        </div>
      ))}
      <div style={{ height: 0.5, background: 'var(--d9-hairline)', margin: '4px 8px' }} />
      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--d9-ink-mute)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ opacity: 0.7 }}>Brand-mark tints active persona</span>
      </div>
    </div>
  );
}

// ─── Expanded window (520×680) ───────────────────────────────
function ExpandedWindow({ state = 'messages', persona = 'sysdesign', focused = false, glass = 'heavy' }) {
  return (
    <WindowShell width={520} height={680} radius={18} glass={glass}>
      <div className="d9-root" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 12px 10px 14px',
          borderBottom: '0.5px solid var(--d9-hairline)',
        }}>
          <BrandMark persona={persona} size={24} />
          <span style={{ fontSize: 13, color: 'var(--d9-ink)', fontWeight: 500, letterSpacing: '-0.01em' }}>
            {PERSONA[persona].label}
          </span>
          <ModelPill label="claude-sonnet-4.5" />
          <span style={{ flex: 1 }} />
          <IconButton title="Collapse">{Icon.collapse(14)}</IconButton>
          <IconButton title="Close">{Icon.close(12)}</IconButton>
        </div>

        {/* Message list */}
        <div style={{
          flex: 1, overflow: 'hidden', padding: '18px 18px 10px',
          position: 'relative',
        }}>
          {state === 'empty' && <EmptyState persona={persona} />}
          {state === 'messages' && <MessageList />}
          {state === 'error' && <ErrorState />}
        </div>

        {/* Input */}
        <div style={{
          padding: '10px 12px 12px',
          borderTop: '0.5px solid var(--d9-hairline)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            minHeight: 44, padding: '8px 8px 8px 12px',
            borderRadius: 12,
            background: 'oklch(1 0 0 / 0.05)',
            border: '0.5px solid ' + (focused ? 'var(--d9-accent)' : 'var(--d9-hairline)'),
            boxShadow: focused ? '0 0 0 3px var(--d9-accent-glow)' : 'none',
            transition: 'box-shadow 160ms var(--d9-ease), border-color 160ms',
          }}>
            <div style={{ flex: 1, padding: '4px 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--d9-ink)', letterSpacing: '-0.005em' }}>
              {focused
                ? <>Когда стоит выбрать leader-follower вместо peer-to-peer репликации?<span className="d9-caret"/></>
                : <span style={{ color: 'var(--d9-ink-mute)' }}>Ask about the screenshot, or type a question…</span>
              }
            </div>
            <IconButton title="Attach">{Icon.camera(14)}</IconButton>
            <IconButton title="Voice">{Icon.mic(14)}</IconButton>
            <IconButton title="Send" tone="accent" size={28}>{Icon.arrow(14)}</IconButton>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingLeft: 2, fontSize: 11, color: 'var(--d9-ink-ghost)' }}>
            <Kbds keys={['⌘','⏎']} size="sm" sep="" />
            <span>send</span>
            <span style={{ margin: '0 4px' }}>·</span>
            <Kbds keys={['⌘','⇧','S']} size="sm" sep="" />
            <span>screenshot</span>
            <span style={{ flex: 1 }} />
            <QuotaMeterMini used={38} cap={100} />
          </div>
        </div>
      </div>
    </WindowShell>
  );
}

function EmptyState({ persona }) {
  const p = PERSONA[persona];
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 20px' }}>
      <div className={p.grad} style={{
        width: 76, height: 76, borderRadius: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--d9-font-display)', fontStyle: 'italic',
        fontSize: 44, color: 'rgba(255,255,255,0.97)',
        boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 4px 20px -2px currentColor, 0 0 40px -8px currentColor',
      }}>9</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 26, color: 'var(--d9-ink)', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
          Незаметно. Точно.
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--d9-ink-mute)', marginTop: 6, letterSpacing: '-0.005em' }}>
          {p.label} persona · invisible to screen sharing
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 320 }}>
        {[
          ['Explain what I see', ['⌘','⏎']],
          ['Capture region, then ask', ['⌘','⇧','S']],
          ['Cycle persona', ['⌥','1']],
          ['Hide window', ['⌘','\\']],
        ].map(([label, keys]) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 9,
            background: 'oklch(1 0 0 / 0.03)',
            border: '0.5px solid var(--d9-hairline)',
          }}>
            <span style={{ fontSize: 12.5, color: 'var(--d9-ink-dim)', letterSpacing: '-0.005em', flex: 1 }}>{label}</span>
            <Kbds keys={keys} size="sm" sep="" />
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageList() {
  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <MessageBubble role="user" thumb="code">
        Что делает этот код? Оптимален ли он?
      </MessageBubble>
      <MessageBubble role="assistant">
        Это <strong>рекурсивный quicksort</strong> с разбиением Ломуто. Алгоритм выбирает последний
        элемент в качестве опорного и за один проход размещает все меньшие элементы слева.
        <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 16, margin: '14px 0 4px', color: 'var(--d9-ink)' }}>
          Сложность
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <Tag>O(n log n) avg</Tag>
          <Tag warn>O(n²) worst</Tag>
          <Tag>O(log n) space</Tag>
        </div>
        <CodeBlock lang="ts" filename="quicksort.ts">
{S.cm('// Randomized pivot fixes the worst-case')}
{'\n'}{S.kw('function')} {S.fn('quickSort')}({S.id('arr')}, {S.id('lo')} = {S.num('0')}, {S.id('hi')} = {S.id('arr.length')} - {S.num('1')}) {'{'}
{'\n  '}{S.kw('if')} ({S.id('lo')} &lt; {S.id('hi')}) {'{'}
{'\n    '}{S.kw('const')} {S.id('r')} = {S.id('lo')} + {S.fn('rand')}({S.id('hi')} - {S.id('lo')});
{'\n    '}{S.id('swap')}({S.id('arr')}, {S.id('r')}, {S.id('hi')});
{'\n    '}{S.kw('const')} {S.id('p')} = {S.fn('partition')}({S.id('arr')}, {S.id('lo')}, {S.id('hi')});
{'\n    '}{S.fn('quickSort')}({S.id('arr')}, {S.id('lo')}, {S.id('p')} - {S.num('1')});
{'\n    '}{S.fn('quickSort')}({S.id('arr')}, {S.id('p')} + {S.num('1')}, {S.id('hi')});
{'\n  '}{'}'}
{'\n'}{'}'}
        </CodeBlock>
        Рандомизация pivot делает сценарий O(n²) практически невозможным — этого обычно
        достаточно для интервью.
      </MessageBubble>
      <MessageBubble role="user">
        А когда выбрать merge sort вместо этого?
      </MessageBubble>
      <MessageBubble role="assistant" streaming>
        Merge sort предпочтительнее когда: <em>стабильность</em> важна (равные элементы
        сохраняют порядок), когда данные хранятся на диске
      </MessageBubble>
    </div>
  );
}

function ErrorState() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 30 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'oklch(0.30 0.12 25 / 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d9-err)', fontSize: 24 }}>!</div>
      <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 22 }}>Connection lost</div>
      <div style={{ fontSize: 12.5, color: 'var(--d9-ink-mute)', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
        Anthropic API vanished mid-stream. Your draft is preserved — retry when you're ready.
      </div>
      <button style={{
        padding: '7px 14px', borderRadius: 9,
        background: 'var(--d9-accent)', color: 'white',
        fontSize: 12.5, fontWeight: 500, letterSpacing: '-0.005em',
        boxShadow: '0 0 18px -4px var(--d9-accent-glow)',
      }}>Retry</button>
    </div>
  );
}

function Tag({ children, warn }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 8px', borderRadius: 999,
      fontSize: 10.5, fontFamily: 'var(--d9-font-mono)', letterSpacing: '0.02em',
      color: warn ? 'var(--d9-warn)' : 'var(--d9-ink-dim)',
      background: warn ? 'oklch(0.6 0.15 70 / 0.12)' : 'oklch(1 0 0 / 0.06)',
      border: '0.5px solid ' + (warn ? 'oklch(0.6 0.15 70 / 0.3)' : 'var(--d9-hairline)'),
    }}>{children}</span>
  );
}

// ─── Settings (Appearance tab) ───────────────────────────────
function SettingsWindow() {
  return (
    <div style={{
      width: 720, height: 520, borderRadius: 10,
      background: 'oklch(0.10 0.02 275)',
      boxShadow: 'var(--d9-shadow-win)',
      color: 'var(--d9-ink)',
      fontFamily: 'var(--d9-font-sans)',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      border: '0.5px solid var(--d9-hairline-b)',
    }} className="d9-root">
      {/* Native-ish title bar */}
      <div style={{
        height: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px',
        borderBottom: '0.5px solid var(--d9-hairline)',
        background: 'oklch(0.12 0.02 275)',
      }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'oklch(0.7 0.16 25)', boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3)' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'oklch(0.78 0.15 85)' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'oklch(0.72 0.18 150)' }} />
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>Druz9 — Settings</span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar tabs */}
        <div style={{ width: 180, padding: '16px 8px', borderRight: '0.5px solid var(--d9-hairline)', background: 'oklch(0.09 0.02 275)' }}>
          {['General', 'Hotkeys', 'AI Providers', 'Appearance', 'About'].map((t, i) => (
            <div key={t} style={{
              padding: '7px 12px', borderRadius: 7, fontSize: 12.5, letterSpacing: '-0.005em',
              color: t === 'Appearance' ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
              background: t === 'Appearance' ? 'oklch(1 0 0 / 0.06)' : 'transparent',
              marginBottom: 2,
            }}>{t}</div>
          ))}
        </div>

        {/* Content — Appearance */}
        <div style={{ flex: 1, padding: '24px 28px', overflow: 'hidden' }}>
          <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 26, letterSpacing: '-0.01em', marginBottom: 4 }}>Appearance</div>
          <div style={{ fontSize: 12.5, color: 'var(--d9-ink-mute)', marginBottom: 22 }}>Visual identity of every floating surface.</div>

          <SettingRow label="Theme" hint="Stealth-mode forces dark.">
            <Seg options={['Dark', 'Midnight', 'System']} active="Midnight" />
          </SettingRow>

          <SettingRow label="Glass intensity" hint="Higher = more desktop bleed-through.">
            <RangeMock value={70} />
          </SettingRow>

          <SettingRow label="Accent hue" hint="Focus rings, send button, streaming bar.">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                ['violet', 'oklch(0.72 0.23 300)'],
                ['cyan',   'oklch(0.78 0.16 210)'],
                ['amber',  'oklch(0.82 0.16 70)'],
                ['green',  'oklch(0.82 0.18 150)'],
                ['rose',   'oklch(0.72 0.22 15)'],
              ].map(([id, c], i) => (
                <span key={id} style={{
                  width: 28, height: 28, borderRadius: 8, background: c,
                  boxShadow: i === 0
                    ? 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 0 2px var(--d9-ink), 0 0 0 3.5px var(--d9-accent)'
                    : 'inset 0 0.5px 0 rgba(255,255,255,0.3)',
                }} />
              ))}
            </div>
          </SettingRow>

          <SettingRow label="Persona default" hint="Overridden by ⌥ + digit at runtime.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERSONAS.map(p => (
                <PersonaChip key={p.id} personaId={p.id} compact />
              ))}
            </div>
          </SettingRow>

          <SettingRow label="Message density" hint="Applies to expanded message list.">
            <Seg options={['Compact', 'Comfortable']} active="Comfortable" />
          </SettingRow>

          <SettingRow label="Show quota meter" hint="In compact + expanded input rows.">
            <Toggle on />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', alignItems: 'center', gap: 20, padding: '12px 0', borderBottom: '0.5px solid var(--d9-hairline)' }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--d9-ink)', fontWeight: 500, letterSpacing: '-0.005em' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--d9-ink-ghost)', marginTop: 2, lineHeight: 1.35 }}>{hint}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Seg({ options, active }) {
  return (
    <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, background: 'oklch(1 0 0 / 0.05)', border: '0.5px solid var(--d9-hairline)' }}>
      {options.map(o => (
        <span key={o} style={{
          padding: '5px 12px', fontSize: 12, borderRadius: 6,
          background: o === active ? 'oklch(1 0 0 / 0.08)' : 'transparent',
          color: o === active ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
          boxShadow: o === active ? 'inset 0 0.5px 0 rgba(255,255,255,0.1)' : 'none',
        }}>{o}</span>
      ))}
    </div>
  );
}

function RangeMock({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 320 }}>
      <div style={{ flex: 1, height: 3, background: 'oklch(1 0 0 / 0.08)', borderRadius: 2, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: value + '%', background: 'var(--d9-accent)', borderRadius: 2, boxShadow: '0 0 10px var(--d9-accent-glow)' }} />
        <div style={{ position: 'absolute', left: `calc(${value}% - 7px)`, top: -5.5, width: 14, height: 14, borderRadius: '50%', background: 'var(--d9-ink)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </div>
      <span style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 11, color: 'var(--d9-ink-mute)', width: 30, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

function Toggle({ on }) {
  return (
    <div style={{
      width: 32, height: 18, borderRadius: 10, position: 'relative',
      background: on ? 'var(--d9-accent)' : 'oklch(1 0 0 / 0.1)',
      boxShadow: on ? '0 0 12px -2px var(--d9-accent-glow)' : 'none',
      transition: 'background 120ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'left 120ms var(--d9-ease)',
      }} />
    </div>
  );
}

// ─── Area overlay ────────────────────────────────────────────
function AreaOverlay() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: 'crosshair' }}>
      {/* Dark scrim with hole */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'oklch(0.05 0.01 280 / 0.55)',
        backdropFilter: 'saturate(0.7)',
        WebkitBackdropFilter: 'saturate(0.7)',
      }} />
      {/* Selection rect */}
      <div style={{
        position: 'absolute',
        left: 120, top: 80, width: 380, height: 170,
        border: '1px solid var(--d9-accent-hi)',
        boxShadow: '0 0 0 9999px oklch(0.05 0.01 280 / 0.55), 0 0 24px -2px var(--d9-accent-glow)',
        background: 'transparent',
      }}>
        {/* corner handles */}
        {[[0,0],[1,0],[0,1],[1,1]].map(([x,y], i) => (
          <span key={i} style={{
            position: 'absolute',
            left: x ? -3 : -3, top: y ? 'auto' : -3, bottom: y ? -3 : 'auto', right: x ? -3 : 'auto',
            width: 7, height: 7, background: 'var(--d9-ink)',
            border: '1px solid var(--d9-accent-hi)',
          }} />
        ))}
        {/* dims */}
        <span style={{
          position: 'absolute', top: -26, left: 0,
          fontFamily: 'var(--d9-font-mono)', fontSize: 10.5,
          color: 'var(--d9-ink)',
          background: 'oklch(0.12 0.04 280 / 0.85)',
          padding: '3px 6px', borderRadius: 4,
          letterSpacing: '0.02em',
        }}>380 × 170</span>
      </div>
      {/* hint bar */}
      <div style={{
        position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 14px', borderRadius: 999,
        background: 'oklch(0.12 0.04 280 / 0.85)',
        backdropFilter: 'var(--d9-glass-blur)',
        WebkitBackdropFilter: 'var(--d9-glass-blur)',
        boxShadow: 'var(--d9-shadow-pop)',
        border: '0.5px solid var(--d9-hairline-b)',
        fontSize: 12, color: 'var(--d9-ink-dim)', letterSpacing: '-0.005em',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--d9-accent-hi)', boxShadow: '0 0 6px var(--d9-accent-glow)' }} />
          Drag to capture
        </span>
        <span style={{ width: 1, height: 12, background: 'var(--d9-hairline)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Kbd size="sm">⏎</Kbd> send to Druz9
        </span>
        <span style={{ width: 1, height: 12, background: 'var(--d9-hairline)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Kbd size="sm">Esc</Kbd> cancel
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { CompactWindow, ExpandedWindow, SettingsWindow, AreaOverlay, EmptyState, MessageList });
