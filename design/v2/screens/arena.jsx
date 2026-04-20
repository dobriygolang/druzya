// Arena — PvP matchmaking hub. 1v1 / 2v2 / Guild Wars. PoE-style.
function ArenaScreen() {
  const [mode, setMode] = React.useState('1v1');
  const [queue, setQueue] = React.useState(false);
  const [section, setSection] = React.useState('algorithms');

  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'grid', gridTemplateColumns: '280px 1fr 320px', gap: 16 }}>
      <LeftColumn mode={mode} setMode={setMode} />
      <CenterArena mode={mode} queue={queue} setQueue={setQueue} section={section} setSection={setSection} />
      <RightColumn />
    </div>
  );
}

function LeftColumn({ mode, setMode }) {
  const modes = [
    { k: '1v1', n: '1 vs 1', d: 'Дуэль. Один на один. Только ELO.', rune: '⚔', c: 'var(--blood-lit)' },
    { k: '2v2', n: '2 vs 2', d: 'Парная дуэль. Гильдия или рандом.', rune: '⚔⚔', c: 'var(--ember-lit)' },
    { k: 'royale', n: 'Royale', d: '8 игроков. Выбывание по таймеру.', rune: '☼', c: 'var(--rarity-magic)' },
    { k: 'gwar', n: 'Война Гильдий', d: '5 линий, неделя, асинхронно.', rune: '♛', c: 'var(--rarity-gem)', locked: 'Гильдия LVL 3' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">⚔</span> Режимы Боя</div>
        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {modes.map(m => {
            const active = m.k === mode;
            return (
              <button key={m.k} onClick={() => !m.locked && setMode(m.k)} disabled={!!m.locked} style={{
                padding: '10px 12px', textAlign: 'left', position: 'relative',
                background: active ? 'linear-gradient(180deg, #1f1410, #0f0804)' : 'transparent',
                border: `1px solid ${active ? m.c : 'transparent'}`,
                boxShadow: active ? `0 0 10px ${m.c}44` : 'none',
                opacity: m.locked ? 0.5 : 1, cursor: m.locked ? 'not-allowed' : 'pointer',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16, color: m.c, width: 32, textAlign: 'center', letterSpacing: '-2px' }}>{m.rune}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: active ? 'var(--ink-bright)' : 'var(--ink-mid)', fontWeight: 700, letterSpacing: '0.08em' }}>{m.n}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>{m.d}</div>
                  </div>
                </div>
                {m.locked && <div style={{ marginTop: 4, paddingLeft: 42, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--metal-lit)', letterSpacing: '0.2em' }}>⚿ {m.locked}</div>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">◈</span> Твой Ранг</div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 54, height: 54, position: 'relative', flexShrink: 0 }}>
              <svg viewBox="0 0 60 60" style={{ width: '100%', height: '100%' }}>
                <polygon points="30,4 54,18 54,42 30,56 6,42 6,18" fill="#1a0808" stroke="#e09b3a" strokeWidth="1.5" />
                <polygon points="30,12 47,22 47,38 30,48 13,38 13,22" fill="none" stroke="#8a5a1a" strokeWidth="0.8" />
                <text x="30" y="36" textAnchor="middle" fontFamily="var(--font-display)" fontSize="16" fontWeight="900" fill="#f5c56b">V</text>
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ember-bright)', fontWeight: 700, letterSpacing: '0.08em' }}>ДИВИЗИОН V</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ink-mid)' }}>1847 ELO · #384</div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 3 }}>
            {['W','W','L','W','W','W','L','W','W','W'].map((r, i) => (
              <span key={i} style={{
                flex: 1, height: 14, fontFamily: 'var(--font-code)', fontSize: 8, fontWeight: 700,
                color: r === 'W' ? '#041008' : '#1a0404', letterSpacing: '0.1em',
                background: r === 'W' ? 'var(--toxic-lit)' : 'var(--blood-lit)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                clipPath: 'polygon(0 0, 100% 0, calc(100% - 3px) 100%, 3px 100%)',
              }}>{r}</span>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            <Stat l="Побед" v="248" c="var(--toxic-lit)" />
            <Stat l="Поражений" v="112" c="var(--blood-lit)" />
            <Stat l="Винрейт" v="68%" c="var(--ember-lit)" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ l, v, c }) {
  return (
    <div style={{ padding: '4px 6px', background: 'var(--bg-inset)', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>{l.toUpperCase()}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: c, fontWeight: 700 }}>{v}</div>
    </div>
  );
}

function CenterArena({ mode, queue, setQueue, section, setSection }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <ArenaBanner mode={mode} />
      <SectionPicker section={section} setSection={setSection} />
      <ModifierPicker />
      {queue ? <QueueState onCancel={() => setQueue(false)} /> : <ReadyButton onEnter={() => setQueue(true)} mode={mode} />}
      <RecentMatches />
    </div>
  );
}

function ArenaBanner({ mode }) {
  const modeNames = { '1v1': 'ДУЭЛЬ 1 vs 1', '2v2': 'ПАРНАЯ 2 vs 2', royale: 'РОЯЛЬ · 8', gwar: 'ВОЙНА ГИЛЬДИЙ' };
  return (
    <div style={{ position: 'relative', height: 180, overflow: 'hidden',
      background: 'linear-gradient(180deg, #1a0808 0%, #0a0403 100%)',
      border: '1px solid var(--metal-lit)',
      boxShadow: 'inset 0 0 80px rgba(0,0,0,0.9), 0 0 20px rgba(138,20,20,0.3)',
    }}>
      {/* Arena silhouette */}
      <svg viewBox="0 0 800 180" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="arenaGlow" cx="50%" cy="60%" r="60%">
            <stop offset="0%" stopColor="#c22222" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#c22222" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="800" height="180" fill="url(#arenaGlow)" />
        {/* Colosseum arches */}
        {Array.from({ length: 9 }).map((_, i) => (
          <g key={i} opacity="0.3">
            <rect x={i * 90 + 10} y={60} width="70" height="100" fill="none" stroke="#5a3a1a" strokeWidth="1" />
            <path d={`M${i * 90 + 10} 80 Q${i * 90 + 45} 60 ${i * 90 + 80} 80`} fill="none" stroke="#5a3a1a" strokeWidth="1" />
          </g>
        ))}
        {/* Two fighters silhouettes */}
        <g transform="translate(280, 120)">
          <ellipse cx="0" cy="45" rx="30" ry="4" fill="#000" opacity="0.6" />
          <path d="M-10 -20 L-10 20 L10 20 L10 -20 Z M-8 -30 L8 -30 L8 -20 L-8 -20 Z M-20 -10 L-10 -15 L-10 0 L-20 -5 Z M-18 20 L-12 20 L-12 35 L-20 35 Z M8 20 L12 20 L18 35 L12 35 Z" fill="#0f0808" stroke="#2a1408" strokeWidth="0.5" />
          <rect x="-24" y="-5" width="2" height="25" fill="#5a5045" />
          <rect x="-28" y="-7" width="10" height="2" fill="#7a6a55" />
        </g>
        <g transform="translate(520, 120) scale(-1, 1)">
          <ellipse cx="0" cy="45" rx="30" ry="4" fill="#000" opacity="0.6" />
          <path d="M-10 -20 L-10 20 L10 20 L10 -20 Z M-8 -30 L8 -30 L8 -20 L-8 -20 Z M-20 -10 L-10 -15 L-10 0 L-20 -5 Z M-18 20 L-12 20 L-12 35 L-20 35 Z M8 20 L12 20 L18 35 L12 35 Z" fill="#0f0808" stroke="#2a1408" strokeWidth="0.5" />
          <path d="M-24 -5 L-24 20 L-18 20 L-18 -5 Z" fill="#8a1a1a" />
        </g>
        {/* Torches */}
        {[140, 660].map((x, i) => (
          <g key={i}>
            <rect x={x - 2} y={80} width="4" height="50" fill="#2a1a08" />
            <circle cx={x} cy={78} r="8" fill="#e09b3a" opacity="0.8" />
            <circle cx={x} cy={76} r="5" fill="#f5c56b" />
          </g>
        ))}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 38, color: 'var(--ink-bright)', letterSpacing: '0.04em', textShadow: '0 0 20px rgba(194,34,34,0.8), 0 2px 0 #000', whiteSpace: 'nowrap' }}>
          Arēna Krovi
        </div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', letterSpacing: '0.35em', fontWeight: 700 }}>
          {modeNames[mode]} · ONLINE · 247 В ОЧЕРЕДИ
        </div>
      </div>
    </div>
  );
}

function SectionPicker({ section, setSection }) {
  const sections = [
    { k: 'algorithms', ru: 'АЛГОРИТМЫ', c: '#6a9fd4', icon: '⚙' },
    { k: 'sql', ru: 'SQL', c: '#639922', icon: '⊟' },
    { k: 'go', ru: 'BACKEND', c: '#EF9F27', icon: '⬡' },
    { k: 'sd', ru: 'SYS DESIGN', c: '#7F77DD', icon: '◈' },
    { k: 'bh', ru: 'BEHAVIORAL', c: '#1D9E75', icon: '☉' },
  ];
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="h-caps" style={{ marginBottom: 10 }}>Выбор секции</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr) auto', gap: 6, alignItems: 'stretch' }}>
        {sections.map(s => {
          const active = s.k === section;
          return (
            <button key={s.k} onClick={() => setSection(s.k)} style={{
              padding: '12px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              background: active ? `linear-gradient(180deg, ${s.c}22, ${s.c}08)` : 'var(--bg-inset)',
              border: `1px solid ${active ? s.c : 'var(--metal-dark)'}`,
              boxShadow: active ? `0 0 12px ${s.c}66, inset 0 0 20px ${s.c}11` : 'none',
              cursor: 'pointer',
            }}>
              <span style={{ fontSize: 20, color: s.c, textShadow: active ? `0 0 8px ${s.c}` : 'none' }}>{s.icon}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: active ? 'var(--ink-bright)' : 'var(--ink-mid)', letterSpacing: '0.15em', fontWeight: 700 }}>{s.ru}</span>
            </button>
          );
        })}
        <button style={{
          padding: '12px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          background: 'linear-gradient(180deg, #2a0a0a, #1a0404)',
          border: '1px solid var(--blood-lit)', cursor: 'pointer', minWidth: 70,
        }}>
          <span style={{ fontSize: 20, color: 'var(--blood-bright)' }}>✱</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-bright)', letterSpacing: '0.15em', fontWeight: 700 }}>РАНДОМ</span>
        </button>
      </div>
    </div>
  );
}

function ModifierPicker() {
  const [active, setActive] = React.useState(new Set(['speed']));
  const mods = [
    { k: 'speed', n: 'Скорость', d: 'Таймер 20 мин', c: 'var(--ember-lit)', xp: '+15%' },
    { k: 'blind', n: 'Слепой', d: 'Нет подсветки ошибок', c: 'var(--rarity-magic)', xp: '+25%' },
    { k: 'cursed', n: 'Проклятье', d: 'Нет backspace на финале', c: 'var(--blood-lit)', xp: '+40%' },
    { k: 'hardcore', n: 'Хардкор', d: 'Провал = −ELO ×2', c: 'var(--blood-bright)', xp: '+60%' },
  ];
  const toggle = k => setActive(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="h-caps">Модификаторы Битвы</div>
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--toxic-lit)', letterSpacing: '0.2em' }}>+{active.size * 15}% XP</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {mods.map(m => {
          const on = active.has(m.k);
          return (
            <button key={m.k} onClick={() => toggle(m.k)} style={{
              padding: '8px 10px', textAlign: 'left',
              background: on ? `linear-gradient(180deg, ${m.c}22, transparent)` : 'var(--bg-inset)',
              border: `1px solid ${on ? m.c : 'var(--metal-dark)'}`,
              cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: on ? m.c : 'var(--ink-mid)', fontWeight: 700, letterSpacing: '0.06em' }}>{m.n}</span>
                <span style={{ fontSize: 10, color: on ? m.c : 'var(--metal-lit)' }}>{on ? '◼' : '◻'}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, lineHeight: 1.3 }}>{m.d}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: on ? 'var(--toxic-lit)' : 'var(--ink-mid)', marginTop: 4 }}>{m.xp} XP</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReadyButton({ onEnter, mode }) {
  return (
    <div className="panel" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.06em' }}>Готов к битве?</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic', marginTop: 3 }}>
          Средний поиск соперника: ~42 секунды. ELO-разница ≤ 200.
        </div>
      </div>
      {mode === '2v2' && (
        <button className="btn btn-ghost" style={{ padding: '10px 14px' }}>⚯ Пригласить</button>
      )}
      <button onClick={onEnter} className="btn btn-blood" style={{ padding: '12px 28px', fontSize: 13 }}>
        ⚔ В БОЙ
      </button>
    </div>
  );
}

function QueueState({ onCancel }) {
  const [t, setT] = React.useState(12);
  React.useEffect(() => { const i = setInterval(() => setT(x => x + 1), 1000); return () => clearInterval(i); }, []);
  return (
    <div className="panel" style={{ padding: 18, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(138,20,20,0.15), transparent 70%)', animation: 'pulse 2s infinite' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 54, height: 54, flexShrink: 0, position: 'relative' }}>
          <svg viewBox="0 0 60 60" style={{ width: '100%', height: '100%' }}>
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--metal-dark)" strokeWidth="2" />
            <circle cx="30" cy="30" r="26" fill="none" stroke="var(--blood-lit)" strokeWidth="2"
              strokeDasharray="50 163" strokeDashoffset="0" transform="rotate(-90 30 30)">
              <animateTransform attributeName="transform" type="rotate" from="-90 30 30" to="270 30 30" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x="30" y="35" textAnchor="middle" fontFamily="var(--font-display)" fontSize="14" fontWeight="700" fill="var(--blood-bright)">◉</text>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>● ПОИСК СОПЕРНИКА</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-bright)', fontWeight: 700, marginTop: 3 }}>
            {String(Math.floor(t / 60)).padStart(2, '0')}:{String(t % 60).padStart(2, '0')}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 2 }}>
            Диапазон ELO: 1647 – 2047 · расширяется через {Math.max(0, 30 - t)} сек
          </div>
        </div>
        <button onClick={onCancel} className="btn btn-ghost" style={{ padding: '10px 18px' }}>✕ Отменить</button>
      </div>
    </div>
  );
}

function RecentMatches() {
  const matches = [
    { opp: 'Ravenmark_42', elo: 1912, me: 'W', mine: 1832, delta: 15, time: '12:34', task: 'LRU Cache', sec: 'algorithms' },
    { opp: 'ShadowByte', elo: 1784, me: 'W', mine: 1817, delta: 12, time: '08:22', task: 'Top K Elements', sec: 'algorithms' },
    { opp: 'NullPointer', elo: 2041, me: 'L', mine: 1805, delta: -18, time: '15:02', task: 'Consistent Hash', sec: 'sd' },
    { opp: 'Grimoire_X', elo: 1723, me: 'W', mine: 1823, delta: 9, time: '06:11', task: 'JOIN Optimization', sec: 'sql' },
    { opp: 'void_walker', elo: 1890, me: 'L', mine: 1814, delta: -14, time: '11:48', task: 'Rate Limiter', sec: 'go' },
  ];
  const secColors = { algorithms: '#6a9fd4', sql: '#639922', go: '#EF9F27', sd: '#7F77DD', bh: '#1D9E75' };
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">✦</span> Последние Битвы</div>
      <div style={{ padding: '8px 16px' }}>
        {matches.map((m, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < matches.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <span style={{
              width: 24, height: 24, flexShrink: 0,
              background: m.me === 'W' ? 'var(--toxic-lit)' : 'var(--blood-lit)',
              color: m.me === 'W' ? '#041008' : '#1a0404',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              clipPath: 'polygon(4px 0, calc(100% - 4px) 0, 100% 50%, calc(100% - 4px) 100%, 4px 100%, 0 50%)',
            }}>{m.me}</span>
            <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.opp}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)' }}>{m.elo} ELO</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {m.task}</span>
            </div>
            <span style={{ padding: '1px 6px', fontFamily: 'var(--font-code)', fontSize: 8, letterSpacing: '0.15em', color: secColors[m.sec], border: `1px solid ${secColors[m.sec]}66` }}>{m.sec.toUpperCase()}</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', flexShrink: 0 }}>{m.time}</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, fontWeight: 700, color: m.delta > 0 ? 'var(--toxic-lit)' : 'var(--blood-lit)', width: 42, textAlign: 'right', flexShrink: 0 }}>
              {m.delta > 0 ? '+' : ''}{m.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RightColumn() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Leaderboard />
      <LiveSpectate />
      <AnticheatNotice />
    </div>
  );
}

function Leaderboard() {
  const players = [
    { r: 1, n: 'ObsidianArchon', elo: 2847, div: 'ЭТЕРНАЛ', c: 'var(--rarity-legendary)', guild: 'Кровь·IX' },
    { r: 2, n: 'Baal_the_Clean', elo: 2791, div: 'ЭТЕРНАЛ', c: 'var(--rarity-legendary)', guild: 'Без Имени' },
    { r: 3, n: 'Нихил', elo: 2734, div: 'АСЦЕНДАНТ', c: 'var(--rarity-rare)', guild: 'Кровь·IX' },
    { r: 4, n: 'root_priest', elo: 2689, div: 'АСЦЕНДАНТ', c: 'var(--rarity-rare)', guild: 'Некропоэзис' },
    { r: 5, n: 'BitReaper', elo: 2654, div: 'АСЦЕНДАНТ', c: 'var(--rarity-rare)', guild: '—' },
    { r: 6, n: 'Серый·Маг', elo: 2601, div: 'АСЦЕНДАНТ', c: 'var(--rarity-rare)', guild: 'Хранители' },
    { r: 384, n: 'А.ВОЛКОВ (ты)', elo: 1847, div: 'V', c: 'var(--ember-lit)', guild: 'Кровь·IX', me: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">♛</span> Топ Соперников
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>СЕЗОН II</span>
      </div>
      <div style={{ padding: '8px 0' }}>
        {players.map((p, i) => (
          <div key={p.r} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
            background: p.me ? 'linear-gradient(90deg, rgba(224,155,58,0.1), transparent)' : 'transparent',
            borderLeft: p.me ? '2px solid var(--ember-bright)' : '2px solid transparent',
            marginTop: i === players.length - 1 ? 6 : 0,
            borderTop: i === players.length - 1 ? '1px solid var(--metal-dark)' : 'none',
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: p.r <= 3 ? p.c : 'var(--ink-mid)', width: 32, textAlign: 'right', flexShrink: 0 }}>
              {p.r <= 3 ? ['✦','✧','✧'][p.r - 1] + ' ' + p.r : `#${p.r}`}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: p.me ? 'var(--ember-bright)' : 'var(--ink-bright)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.n}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: p.c, letterSpacing: '0.15em' }}>{p.div} · <span style={{ color: 'var(--ink-dim)' }}>{p.guild}</span></div>
            </div>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-lit)', fontWeight: 700, flexShrink: 0 }}>{p.elo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveSpectate() {
  const live = [
    { a: 'Nihil', b: 'BitReaper', viewers: 247, sec: 'ALG', c: '#6a9fd4' },
    { a: 'root_priest', b: 'Shadow·42', viewers: 128, sec: 'SD', c: '#7F77DD' },
    { a: 'Aphelion', b: 'void_dm', viewers: 82, sec: 'SQL', c: '#639922' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">◉</span> Смотреть Live
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.2em', animation: 'blink 2s infinite' }}>● LIVE</span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {live.map((l, i) => (
          <button key={i} style={{
            padding: '8px 10px', textAlign: 'left', background: 'var(--bg-inset)',
            border: '1px solid var(--metal-dark)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ padding: '2px 6px', fontFamily: 'var(--font-code)', fontSize: 8, color: l.c, border: `1px solid ${l.c}66`, letterSpacing: '0.15em', flexShrink: 0 }}>{l.sec}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--ink-bright)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.a} <span style={{ color: 'var(--blood-lit)' }}>vs</span> {l.b}
              </div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)' }}>{l.viewers} зрителей</div>
            </div>
            <span style={{ color: 'var(--ember-lit)', fontSize: 12 }}>▶</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AnticheatNotice() {
  return (
    <div className="panel" style={{ padding: 14, background: 'linear-gradient(180deg, #1a0808, #0a0403)', borderColor: 'var(--blood-dark)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18, color: 'var(--blood-bright)' }}>⚠</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', letterSpacing: '0.08em', fontWeight: 700 }}>АНТИЧИТ · АКТИВЕН</span>
      </div>
      <div style={{ marginTop: 8, fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-mid)', lineHeight: 1.5, fontStyle: 'italic' }}>
        « Вставка кода запрещена. Переключение вкладок логируется. Аномально быстрое решение = follow-up вопросы. »
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 4 }}>
        {['◯ Paste', '◯ Tab', '◯ Speed'].map(s => (
          <span key={s} style={{ flex: 1, padding: '3px 6px', fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--toxic-lit)', background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', textAlign: 'center', letterSpacing: '0.1em' }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ArenaScreen });
