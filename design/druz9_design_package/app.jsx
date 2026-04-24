// app.jsx — Druz9 design canvas. Pulls every mockup into a single
// DesignCanvas with sections: Foundations, Components, Windows, Motion.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "persona": "sysdesign",
  "glass": "heavy",
  "accent": "violet",
  "density": "comfy",
  "showQuota": true
}/*EDITMODE-END*/;

const ACCENT_SWATCHES = {
  violet: { accent: 'oklch(0.72 0.23 300)', hi: 'oklch(0.82 0.20 310)', lo: 'oklch(0.54 0.22 295)' },
  cyan:   { accent: 'oklch(0.78 0.16 210)', hi: 'oklch(0.86 0.14 215)', lo: 'oklch(0.58 0.18 220)' },
  amber:  { accent: 'oklch(0.82 0.16 70)',  hi: 'oklch(0.88 0.14 75)',  lo: 'oklch(0.66 0.20 50)'  },
  green:  { accent: 'oklch(0.82 0.18 150)', hi: 'oklch(0.88 0.14 155)', lo: 'oklch(0.62 0.20 155)' },
  rose:   { accent: 'oklch(0.72 0.22 15)',  hi: 'oklch(0.82 0.20 25)',  lo: 'oklch(0.54 0.22 12)'  },
};

function App() {
  const [t, setT] = useTweaks(TWEAK_DEFAULTS);

  // Apply accent var globally
  React.useEffect(() => {
    const s = ACCENT_SWATCHES[t.accent] || ACCENT_SWATCHES.violet;
    document.documentElement.style.setProperty('--d9-accent', s.accent);
    document.documentElement.style.setProperty('--d9-accent-hi', s.hi);
    document.documentElement.style.setProperty('--d9-accent-lo', s.lo);
    document.documentElement.style.setProperty('--d9-accent-glow', s.accent.replace(')', ' / 0.35)'));
  }, [t.accent]);

  return (
    <>
      <DesignCanvas>
        {/* ═══════ FOUNDATIONS ═══════ */}
        <DCSection id="foundations" title="Foundations" subtitle="Midnight-velvet · deep indigo/violet · jewel accents · editorial-premium">
          <DCArtboard id="colors" label="Color · Palette" width={720} height={420}>
            <ColorsSheet />
          </DCArtboard>
          <DCArtboard id="type" label="Type · Scale" width={560} height={420}>
            <TypeSheet />
          </DCArtboard>
          <DCArtboard id="tokens" label="Tokens · Spacing · Radius · Elevation · Motion" width={720} height={420}>
            <TokensSheet />
          </DCArtboard>
          <DCArtboard id="personas" label="Personas · Brand-mark gradients" width={560} height={420}>
            <PersonaSheet />
          </DCArtboard>
        </DCSection>

        {/* ═══════ COMPONENTS ═══════ */}
        <DCSection id="components" title="Components" subtitle="Atoms in ready + hover/focus states">
          <DCArtboard id="buttons" label="IconButton · Kbd · StatusDot" width={560} height={320}>
            <ButtonsSheet />
          </DCArtboard>
          <DCArtboard id="input" label="Input · Textarea · Model pill" width={560} height={320}>
            <InputsSheet />
          </DCArtboard>
          <DCArtboard id="msg" label="MessageBubble · CodeBlock" width={560} height={540}>
            <BubblesSheet />
          </DCArtboard>
          <DCArtboard id="persona-ctrl" label="PersonaChip · Dropdown · Quota" width={420} height={540}>
            <PersonaControlsSheet />
          </DCArtboard>
        </DCSection>

        {/* ═══════ WINDOWS ═══════ */}
        <DCSection id="compact" title="Compact window" subtitle="460 × 92 · primary surface · always-on-top">
          <DCArtboard id="compact-idle" label="v1 · Idle" width={640} height={220}>
            <FloatFrame variant="aurora">
              <CompactWindow state="idle" persona={t.persona} variant="v1" glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="compact-thinking" label="v1 · Thinking" width={640} height={220}>
            <FloatFrame variant="code">
              <CompactWindow state="thinking" persona={t.persona} variant="v1" glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="compact-streaming" label="v1 · Streaming on meeting" width={640} height={220}>
            <FloatFrame variant="meeting">
              <CompactWindow state="streaming" persona={t.persona} variant="v1" glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="compact-persona" label="v1 · Persona picker open" width={640} height={360}>
            <FloatFrame variant="aurora">
              <CompactWindow state="idle" persona={t.persona} personaOpen glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="compact-v2" label="v2 · Centered status (no left-pad)" width={640} height={220}>
            <FloatFrame variant="aurora">
              <CompactWindow state="idle" persona={t.persona} variant="v2" glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="compact-v2-busy" label="v2 · On busy code" width={640} height={220}>
            <FloatFrame variant="code">
              <CompactWindow state="thinking" persona={t.persona} variant="v2" glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
        </DCSection>

        <DCSection id="expanded" title="Expanded window" subtitle="520 × 680 · resizable · full conversation">
          <DCArtboard id="exp-empty" label="Empty" width={580} height={740}>
            <FloatFrame variant="aurora" compact>
              <ExpandedWindow state="empty" persona={t.persona} glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="exp-msg" label="With messages + streaming" width={580} height={740}>
            <FloatFrame variant="aurora" compact>
              <ExpandedWindow state="messages" persona={t.persona} glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
          <DCArtboard id="exp-focus" label="Input focused" width={580} height={740}>
            <FloatFrame variant="aurora" compact>
              <ExpandedWindow state="messages" persona={t.persona} focused glass={t.glass}/>
            </FloatFrame>
          </DCArtboard>
        </DCSection>

        <DCSection id="other" title="Settings & Area capture" subtitle="Standard frame · full-screen crosshair">
          <DCArtboard id="settings" label="Settings · Appearance tab" width={760} height={560}>
            <div style={{ width: '100%', height: '100%', padding: 20, background: 'linear-gradient(135deg, oklch(0.18 0.04 280), oklch(0.08 0.02 280))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SettingsWindow />
            </div>
          </DCArtboard>
          <DCArtboard id="area" label="Area overlay · Drag to capture" width={760} height={420}>
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <Backdrop variant="code">
                <AreaOverlay />
              </Backdrop>
            </div>
          </DCArtboard>
        </DCSection>

        <DCSection id="motion" title="Motion" subtitle="Compact → Expanded morph · ⌘E">
          <DCArtboard id="morph" label="Morph · scrubber + loop" width={920} height={860}>
            <Morph />
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel>
        <TweakSection label="Persona" />
        <TweakSelect label="Active persona" value={t.persona}
          options={PERSONAS.map(p => ({ value: p.id, label: p.label }))}
          onChange={(v) => setT('persona', v)}/>
        <TweakSection label="Surface" />
        <TweakRadio label="Glass" value={t.glass}
          options={['heavy', 'medium', 'opaque']}
          onChange={(v) => setT('glass', v)}/>
        <TweakSelect label="Accent hue" value={t.accent}
          options={Object.keys(ACCENT_SWATCHES).map(k => ({ value: k, label: k }))}
          onChange={(v) => setT('accent', v)}/>
        <TweakRadio label="Density" value={t.density}
          options={['compact', 'comfy']}
          onChange={(v) => setT('density', v)}/>
        <TweakToggle label="Show quota meter" value={t.showQuota}
          onChange={(v) => setT('showQuota', v)}/>
      </TweaksPanel>
    </>
  );
}

// FloatFrame — a backdrop rectangle with the window centered in it,
// so heavy glass has something interesting underneath.
function FloatFrame({ children, variant = 'aurora', compact }) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Backdrop variant={variant}>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: compact ? 'center' : 'center', justifyContent: 'center',
          padding: compact ? 16 : 24,
        }}>
          {children}
        </div>
      </Backdrop>
    </div>
  );
}

// ═════════════════ FOUNDATION SHEETS ═════════════════

function ColorsSheet() {
  const swatches = [
    ['Surface', [
      ['--d9-void', 'void'], ['--d9-obsidian', 'obsidian'],
      ['--d9-slate', 'slate'], ['--d9-slate-2', 'slate-2'],
    ]],
    ['Ink', [
      ['--d9-ink', 'ink'], ['--d9-ink-dim', 'ink-dim'],
      ['--d9-ink-mute', 'ink-mute'], ['--d9-ink-ghost', 'ink-ghost'],
    ]],
    ['Accent · Violet plasma', [
      ['--d9-accent-lo', 'accent-lo'], ['--d9-accent', 'accent'], ['--d9-accent-hi', 'accent-hi'],
    ]],
    ['Status', [
      ['--d9-ok', 'ok'], ['--d9-warn', 'warn'], ['--d9-err', 'err'],
    ]],
  ];
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24, overflow: 'hidden' }}>
      <SheetHeader title="Palette" sub="OKLCH — consistent luminance across hues"/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {swatches.map(([group, items]) => (
          <div key={group}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--d9-ink-ghost)', fontFamily: 'var(--d9-font-mono)', marginBottom: 8 }}>{group}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {items.map(([tok, label]) => (
                <div key={tok} style={{ flex: 1 }}>
                  <div style={{ height: 48, borderRadius: 8, background: `var(${tok})`, boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.08)' }}/>
                  <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 9.5, color: 'var(--d9-ink-mute)', marginTop: 4, letterSpacing: '0.01em' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypeSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24, overflow: 'hidden' }}>
      <SheetHeader title="Typography" sub="Instrument Serif · Manrope · JetBrains Mono"/>
      <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 44, lineHeight: 1, letterSpacing: '-0.02em', marginBottom: 2 }}>
        Незаметно. Точно.
      </div>
      <div style={{ fontSize: 11, color: 'var(--d9-ink-ghost)', fontFamily: 'var(--d9-font-mono)', marginBottom: 20 }}>Display — Instrument Serif Italic · 44/48</div>

      <TypeRow size="26/30" label="Display / h1 italic" style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 26 }}>Editorial — clarity of thought</TypeRow>
      <TypeRow size="18/24" label="Heading · Manrope 600" style={{ fontFamily: 'var(--d9-font-sans)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.015em' }}>Stealth AI for coding interviews</TypeRow>
      <TypeRow size="13.5/22" label="Body · Manrope 400" style={{ fontFamily: 'var(--d9-font-sans)', fontSize: 13.5, letterSpacing: '-0.005em' }}>Объясни мне эту реализацию quicksort и сложность.</TypeRow>
      <TypeRow size="12/18" label="UI · Manrope 500" style={{ fontFamily: 'var(--d9-font-sans)', fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' }}>System Design · claude-sonnet-4.5 · Ready</TypeRow>
      <TypeRow size="12/18" label="Mono · JetBrains 400" style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 12 }}>quickSort(arr, 0, arr.length - 1);</TypeRow>
      <TypeRow size="10/14" label="Caption · mono uppercase" style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--d9-ink-ghost)' }}>Invisible to screen sharing</TypeRow>
    </div>
  );
}

function TypeRow({ size, label, style, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: 16, padding: '8px 0', borderBottom: '0.5px solid var(--d9-hairline)' }}>
      <div style={style}>{children}</div>
      <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 9.5, color: 'var(--d9-ink-ghost)', textAlign: 'right', lineHeight: 1.3 }}>
        <div>{label}</div>
        <div>{size}</div>
      </div>
    </div>
  );
}

function TokensSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <div>
        <SheetHeader title="Spacing" sub="4 · 8 · 12 · 16 · 24 · 32"/>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 22 }}>
          {[4,8,12,16,24,32].map(n => (
            <div key={n} style={{ textAlign: 'center' }}>
              <div style={{ width: n, height: n, background: 'var(--d9-accent)', borderRadius: 2, boxShadow: '0 0 8px var(--d9-accent-glow)' }}/>
              <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 9.5, color: 'var(--d9-ink-mute)', marginTop: 6 }}>{n}</div>
            </div>
          ))}
        </div>
        <SheetHeader title="Radius" sub="xs 6 · sm 8 · md 12 · lg 16 · xl 18"/>
        <div style={{ display: 'flex', gap: 10 }}>
          {[[6,'xs'],[8,'sm'],[12,'md'],[16,'lg'],[18,'xl']].map(([r, l]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: r, background: 'var(--d9-slate)', border: '0.5px solid var(--d9-hairline-b)'}}/>
              <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 9.5, color: 'var(--d9-ink-mute)', marginTop: 6 }}>{l} · {r}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <SheetHeader title="Elevation" sub="Window · Pop · Key"/>
        <div style={{ display: 'flex', gap: 18, marginBottom: 24 }}>
          {[
            ['Win', 'var(--d9-shadow-win)'],
            ['Pop', 'var(--d9-shadow-pop)'],
            ['Key', 'var(--d9-shadow-key)'],
          ].map(([l, s]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ width: 60, height: 40, borderRadius: 8, background: 'var(--d9-slate-2)', boxShadow: s }}/>
              <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 9.5, color: 'var(--d9-ink-mute)', marginTop: 8 }}>{l}</div>
            </div>
          ))}
        </div>
        <SheetHeader title="Motion" sub="hover 120 · press 80 · focus 160 · morph 480"/>
        <div style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 10.5, color: 'var(--d9-ink-mute)', lineHeight: 1.8 }}>
          <div>ease       cubic-bezier(.2,.7,.2,1)</div>
          <div>ease-out   cubic-bezier(.15,.85,.3,1)</div>
          <div>ease-in    cubic-bezier(.5,0,.9,.3)</div>
        </div>
      </div>
    </div>
  );
}

function PersonaSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24 }}>
      <SheetHeader title="Personas" sub="Brand-mark gradient swaps per persona"/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PERSONAS.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className={p.grad} style={{
              width: 44, height: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--d9-font-display)', fontStyle: 'italic',
              fontSize: 24, color: 'rgba(255,255,255,0.97)',
              boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 20px -4px currentColor',
            }}>9</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}>{p.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--d9-ink-mute)' }}>{p.sub}</div>
            </div>
            <Kbd>⌥{p.hot}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════════ COMPONENT SHEETS ═════════════════

function ButtonsSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24 }}>
      <SheetHeader title="Controls" />
      <Sub>IconButton · default / hover / active / accent</Sub>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <IconButton>{Icon.camera(14)}</IconButton>
        <div style={{ background: 'oklch(1 0 0 / 0.07)', borderRadius: 8 }}>
          <IconButton>{Icon.settings(14)}</IconButton>
        </div>
        <IconButton active>{Icon.mic(14)}</IconButton>
        <IconButton tone="accent">{Icon.arrow(14)}</IconButton>
      </div>

      <Sub>Kbd · hotkey chips</Sub>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <Kbds keys={['⌘','⏎']}/>
        <Kbds keys={['⌘','⇧','S']}/>
        <Kbds keys={['⌥','1']}/>
        <Kbds keys={['Esc']}/>
      </div>

      <Sub>StatusDot · idle · ready · thinking · streaming · error</Sub>
      <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
        {['idle','ready','thinking','streaming','error'].map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot state={s}/>
            <span style={{ fontFamily: 'var(--d9-font-mono)', fontSize: 10.5, color: 'var(--d9-ink-mute)' }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InputsSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24 }}>
      <SheetHeader title="Input states"/>
      <Sub>Rest</Sub>
      <InputMock placeholder="Ask about your screen or conversation…"/>
      <Sub>Focus</Sub>
      <InputMock value="Explain this recursion" focused/>
      <Sub>With attachment</Sub>
      <InputMock value="Что это за алгоритм?" attach/>

      <Sub style={{ marginTop: 16 }}>Model picker</Sub>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <ModelPill label="claude-sonnet-4.5"/>
        <ModelPill label="gpt-4.1"/>
        <ModelPill label="gemini-2.5-pro"/>
      </div>
    </div>
  );
}

function InputMock({ placeholder, value, focused, attach }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      minHeight: 40, padding: '6px 8px 6px 12px', borderRadius: 11,
      background: 'oklch(1 0 0 / 0.05)',
      border: '0.5px solid ' + (focused ? 'var(--d9-accent)' : 'var(--d9-hairline)'),
      boxShadow: focused ? '0 0 0 3px var(--d9-accent-glow)' : 'none',
      marginBottom: 10,
    }}>
      {attach && (
        <div style={{
          height: 26, padding: '0 8px 0 4px', display: 'flex', alignItems: 'center', gap: 5,
          background: 'oklch(1 0 0 / 0.06)', borderRadius: 7, border: '0.5px solid var(--d9-hairline)',
        }}>
          <div style={{ width: 18, height: 18, borderRadius: 4, background: 'repeating-linear-gradient(135deg, oklch(0.25 0.05 280), oklch(0.25 0.05 280) 3px, oklch(0.20 0.05 280) 3px, oklch(0.20 0.05 280) 6px)' }}/>
          <span style={{ fontSize: 11, color: 'var(--d9-ink-dim)', fontFamily: 'var(--d9-font-mono)' }}>screen.png</span>
        </div>
      )}
      <div style={{ flex: 1, fontSize: 13, color: value ? 'var(--d9-ink)' : 'var(--d9-ink-mute)', letterSpacing: '-0.005em' }}>
        {value || placeholder}{focused && <span className="d9-caret"/>}
      </div>
      <IconButton tone="accent" size={26}>{Icon.arrow(14)}</IconButton>
    </div>
  );
}

function BubblesSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24, overflow: 'hidden' }}>
      <SheetHeader title="Messages & Code"/>
      <div style={{ padding: '0 0 8px' }}>
        <MessageBubble role="user">What does this partition function do?</MessageBubble>
        <MessageBubble role="user" thumb="code">Разбери этот фрагмент построчно</MessageBubble>
        <MessageBubble role="assistant">
          Lomuto partition places the pivot at its final sorted position by scanning and
          swapping smaller elements leftward.
          <CodeBlock lang="ts" filename="partition.ts">
{S.kw('function')} {S.fn('partition')}({S.id('arr')}, {S.id('lo')}, {S.id('hi')}) {'{'}
{'\n  '}{S.kw('const')} {S.id('pivot')} = {S.id('arr[hi]')};
{'\n  '}{S.kw('let')} {S.id('i')} = {S.id('lo')} - {S.num('1')};
{'\n  '}{S.kw('for')} ({S.kw('let')} {S.id('j')} = {S.id('lo')}; {S.id('j')} &lt; {S.id('hi')}; {S.id('j++')}) {'{'}
{'\n    '}{S.kw('if')} ({S.id('arr[j]')} &lt;= {S.id('pivot')}) [{S.id('arr[++i]')}, {S.id('arr[j]')}] = [{S.id('arr[j]')}, {S.id('arr[i]')}];
{'\n  '}{'}'}
{'\n  '}{S.kw('return')} {S.id('i + 1')};
{'\n'}{'}'}
          </CodeBlock>
        </MessageBubble>
      </div>
    </div>
  );
}

function PersonaControlsSheet() {
  return (
    <div className="d9-root" style={{ width: '100%', height: '100%', background: 'var(--d9-obsidian)', padding: 24 }}>
      <SheetHeader title="Persona & Quota"/>
      <Sub>Chips</Sub>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {PERSONAS.slice(0, 3).map(p => <div key={p.id}><PersonaChip personaId={p.id}/></div>)}
      </div>
      <Sub>Quota meter</Sub>
      <div style={{ padding: 10, borderRadius: 10, background: 'oklch(1 0 0 / 0.04)', border: '0.5px solid var(--d9-hairline)' }}>
        <QuotaMeter used={38} cap={100} label="Requests"/>
      </div>
      <div style={{ height: 8 }}/>
      <div style={{ padding: 10, borderRadius: 10, background: 'oklch(1 0 0 / 0.04)', border: '0.5px solid var(--d9-hairline)' }}>
        <QuotaMeter used={87} cap={100} label="Tokens·k"/>
      </div>
    </div>
  );
}

function SheetHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: 'var(--d9-font-display)', fontStyle: 'italic', fontSize: 22, letterSpacing: '-0.01em' }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--d9-ink-ghost)', fontFamily: 'var(--d9-font-mono)', letterSpacing: '0.02em', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Sub({ children, style }) {
  return <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--d9-ink-ghost)', fontFamily: 'var(--d9-font-mono)', marginBottom: 10, marginTop: 4, ...style }}>{children}</div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
