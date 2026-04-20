// Guild — Кровь·IX. PoE2 "guild hall": herald banner, roster, war lines, treasury, capture event.
function GuildScreen() {
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <GuildBanner />
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 300px', gap: 14 }}>
        <LeftGuild />
        <CenterGuild />
        <RightGuild />
      </div>
    </div>
  );
}

function GuildBanner() {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, #14100f 0%, #0a0605 100%)',
      border: '1px solid var(--metal-lit)',
      boxShadow: 'inset 0 0 100px rgba(0,0,0,0.9), 0 0 30px rgba(194,34,34,0.15)',
    }}>
      {/* Stone texture + blood stains */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `
        radial-gradient(ellipse at 20% 30%, rgba(138,20,20,0.12), transparent 35%),
        radial-gradient(ellipse at 80% 60%, rgba(138,20,20,0.1), transparent 40%),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.01) 0 1px, transparent 1px 6px)
      ` }} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '200px 1fr auto', gap: 24, padding: 24, alignItems: 'center' }}>
        <GuildEmblem size={160} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.35em', fontWeight: 700 }}>
            ОСНОВАНА СЕЗОН I · 147 ДНЕЙ НАЗАД
          </div>
          <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 58, color: 'var(--ink-bright)', letterSpacing: '0.02em', marginTop: 4, textShadow: '0 0 20px rgba(194,34,34,0.5), 0 2px 0 #000', lineHeight: 1, whiteSpace: 'nowrap' }}>
            Kroʋ · IX
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ember-lit)', letterSpacing: '0.3em', marginTop: 6, fontStyle: 'italic', fontWeight: 500 }}>
            « ЧТО НЕ СЛОМАЛО — ЗАКАЛИЛО »
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            <GuildStatChip label="РАНГ" value="#12" c="var(--ember-bright)" />
            <GuildStatChip label="GUILD ELO" value="4 247" c="var(--blood-lit)" />
            <GuildStatChip label="ЧЛЕНОВ" value="8 / 10" c="var(--ink-bright)" />
            <GuildStatChip label="ВОЙН" value="23-11" c="var(--toxic-lit)" />
            <GuildStatChip label="КАЗНА" value="18 240 ❂" c="var(--rarity-gem)" />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <button className="btn btn-blood" style={{ padding: '10px 18px', fontSize: 11 }}>⚔ ОБЪЯВИТЬ ВОЙНУ</button>
          <button className="btn btn-ghost" style={{ padding: '10px 18px', fontSize: 11 }}>✧ ПРИГЛАСИТЬ</button>
          <button className="btn btn-ghost" style={{ padding: '10px 18px', fontSize: 11 }}>⚙ УПРАВЛЕНИЕ</button>
        </div>
      </div>
    </div>
  );
}

function GuildStatChip({ label, value, c }) {
  return (
    <div className="inset-groove" style={{ padding: '8px 12px', minWidth: 110 }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.25em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: c, fontWeight: 700, marginTop: 2, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function GuildEmblem({ size = 160 }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg viewBox="0 0 200 200" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="emblemGlow" cx="50%" cy="55%" r="55%">
            <stop offset="0%" stopColor="#c22222" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#c22222" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="shieldMetal" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6d5a45" />
            <stop offset="50%" stopColor="#453a2e" />
            <stop offset="100%" stopColor="#2a221b" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="95" fill="url(#emblemGlow)" />
        {/* Shield outer */}
        <path d="M100 20 L160 35 L160 110 Q160 160 100 185 Q40 160 40 110 L40 35 Z"
              fill="url(#shieldMetal)" stroke="#8a7258" strokeWidth="2" />
        {/* Shield inner bevel */}
        <path d="M100 30 L152 42 L152 108 Q152 152 100 175 Q48 152 48 108 L48 42 Z"
              fill="#1a0808" stroke="#8a1414" strokeWidth="1" />
        {/* Center rune IX */}
        <g transform="translate(100, 100)">
          {/* Crossed swords behind */}
          <g stroke="#5a5045" strokeWidth="3" fill="#3a3025">
            <line x1="-36" y1="-36" x2="36" y2="36" />
            <line x1="36" y1="-36" x2="-36" y2="36" />
            <rect x="-42" y="-42" width="12" height="3" transform="rotate(45)" fill="#8a7258" />
            <rect x="-42" y="-42" width="12" height="3" transform="rotate(-45)" fill="#8a7258" />
            <rect x="30" y="-42" width="12" height="3" transform="rotate(45)" fill="#8a7258" />
            <rect x="30" y="-42" width="12" height="3" transform="rotate(-45)" fill="#8a7258" />
          </g>
          {/* Blood drop */}
          <path d="M0 -50 Q-18 -20 -18 0 Q-18 22 0 22 Q18 22 18 0 Q18 -20 0 -50 Z"
                fill="#c22222" stroke="#8a1414" strokeWidth="1.5" />
          {/* Skull on drop */}
          <circle cx="0" cy="-8" r="10" fill="#1a0404" />
          <ellipse cx="-4" cy="-10" rx="2" ry="3" fill="#3a0909" />
          <ellipse cx="4" cy="-10" rx="2" ry="3" fill="#3a0909" />
          {/* IX below drop */}
          <text x="0" y="50" textAnchor="middle" fontFamily="var(--font-display)" fontSize="22" fontWeight="900" fill="#f5c56b" letterSpacing="2">IX</text>
        </g>
        {/* Banner ribbon */}
        <path d="M30 150 L100 165 L170 150 L165 180 L100 195 L35 180 Z"
              fill="#3a0909" stroke="#8a1414" strokeWidth="1" />
        <text x="100" y="180" textAnchor="middle" fontFamily="var(--font-display)" fontSize="9" fill="#f5c56b" letterSpacing="2">KROV · IX</text>
      </svg>
    </div>
  );
}

// ------------- LEFT: ROSTER -------------
function LeftGuild() {
  const members = [
    { n: 'А.ВОЛКОВ', r: 'GUILDMASTER', cls: 'АРХИТЕКТОР', lvl: 24, elo: 1847, sec: 'sd', status: 'online', me: true, c: 'var(--ember-bright)' },
    { n: 'Нихил', r: 'CAPTAIN', cls: 'АЛГОРИТМИСТ', lvl: 31, elo: 2734, sec: 'alg', status: 'online', c: 'var(--rarity-magic)' },
    { n: 'root_priest', r: 'OFFICER', cls: 'DBA', lvl: 28, elo: 2689, sec: 'sql', status: 'online', c: 'var(--rarity-rare)' },
    { n: 'BitReaper', r: 'OFFICER', cls: 'BACKEND', lvl: 27, elo: 2654, sec: 'go', status: 'in-match', c: 'var(--rarity-rare)' },
    { n: 'Ravenmark', r: 'MEMBER', cls: 'АЛГОРИТМИСТ', lvl: 22, elo: 1912, sec: 'alg', status: 'online' },
    { n: 'void_walker', r: 'MEMBER', cls: 'АРХИТЕКТОР', lvl: 19, elo: 1890, sec: 'sd', status: 'offline' },
    { n: 'Серый·Маг', r: 'MEMBER', cls: 'COMM', lvl: 16, elo: 1601, sec: 'bh', status: 'offline' },
    { n: 'null_witch', r: 'INITIATE', cls: 'NEW', lvl: 6, elo: 1043, sec: 'alg', status: 'online', new: true },
  ];
  const secColors = { alg: '#6a9fd4', sql: '#639922', go: '#EF9F27', sd: '#7F77DD', bh: '#1D9E75' };
  const statusIcons = { online: { c: 'var(--toxic-lit)', t: '●' }, 'in-match': { c: 'var(--blood-lit)', t: '◉' }, offline: { c: 'var(--ink-dim)', t: '○' } };
  const statusLabel = { online: 'ONLINE', 'in-match': 'IN MATCH', offline: 'OFFLINE' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="ornament">⚯</span> Орден Гильдии
          <div className="grow" />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>8 / 10</span>
        </div>
        <div style={{ padding: '8px 0' }}>
          {members.map((m, i) => (
            <div key={m.n} style={{
              padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
              background: m.me ? 'linear-gradient(90deg, rgba(224,155,58,0.1), transparent)' : 'transparent',
              borderLeft: m.me ? '2px solid var(--ember-bright)' : '2px solid transparent',
              borderBottom: i < members.length - 1 ? '1px solid var(--metal-dark)' : 'none',
            }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0, position: 'relative',
                background: `linear-gradient(180deg, ${secColors[m.sec]}22, #0a0404)`,
                border: `1px solid ${secColors[m.sec]}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: secColors[m.sec], fontWeight: 900 }}>{m.n[0].toUpperCase()}</span>
                <span style={{ position: 'absolute', bottom: -2, right: -2, fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ember-bright)', background: '#0a0404', padding: '0 2px', border: '1px solid var(--metal-dark)' }}>{m.lvl}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: m.c || 'var(--ink-bright)', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.n}</span>
                  {m.new && <span style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--toxic-lit)', letterSpacing: '0.15em' }}>NEW</span>}
                </div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>
                  {m.r} · {m.cls}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', fontWeight: 700 }}>{m.elo}</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: statusIcons[m.status].c, letterSpacing: '0.15em' }}>
                  {statusIcons[m.status].t} {statusLabel[m.status]}
                </div>
              </div>
            </div>
          ))}
          {/* Empty slots */}
          {[1, 2].map(i => (
            <div key={i} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.5, borderBottom: i === 1 ? '1px solid var(--metal-dark)' : 'none' }}>
              <div style={{ width: 32, height: 32, flexShrink: 0, border: '1px dashed var(--metal-lit)', clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.2em', flex: 1 }}>СВОБОДНО</span>
              <button style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>+ ПРИЗВАТЬ</button>
            </div>
          ))}
        </div>
      </div>

      <Treasury />
    </div>
  );
}

function Treasury() {
  const items = [
    { i: '◈', n: 'Сезон-Токены', v: '840', c: 'var(--ember-bright)' },
    { i: '❂', n: 'Свитки', v: '312', c: 'var(--rarity-rare)' },
    { i: '⬢', n: 'Гемы', v: '1 240', c: 'var(--rarity-gem)' },
    { i: '✶', n: 'Реликвии', v: '7', c: 'var(--rarity-magic)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">❂</span> Казна Гильдии
      </div>
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {items.map(it => (
          <div key={it.n} className="inset-groove" style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, color: it.c, width: 20, textAlign: 'center' }}>{it.i}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>{it.n.toUpperCase()}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: it.c, fontWeight: 700 }}>{it.v}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------- CENTER: WAR -------------
function CenterGuild() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <WarPanel />
      <CaptureEvent />
      <Chronicle />
    </div>
  );
}

function WarPanel() {
  const lines = [
    { sec: 'АЛГОРИТМЫ', c: '#6a9fd4', us: 8420, them: 7890, player: 'Нихил', enemy: 'Axiom·42', icon: '⚙' },
    { sec: 'SQL', c: '#639922', us: 6120, them: 7340, player: 'root_priest', enemy: 'queen_query', icon: '⊟' },
    { sec: 'BACKEND', c: '#EF9F27', us: 7890, them: 6220, player: 'BitReaper', enemy: 'goroutine_x', icon: '⬡' },
    { sec: 'SYS DESIGN', c: '#7F77DD', us: 5240, them: 6870, player: 'ВОЛКОВ', enemy: 'CAP_theorem', icon: '◈' },
    { sec: 'BEHAVIORAL', c: '#1D9E75', us: 7100, them: 6980, player: 'Серый·Маг', enemy: 'soft_sigma', icon: '☉' },
  ];
  const wonLines = lines.filter(l => l.us > l.them).length;
  return (
    <div className="panel" style={{ padding: 0, border: '1px solid var(--blood-dark)', background: 'linear-gradient(180deg, #1a0908 0%, #0d0605 100%)' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--blood-dark)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 20, color: 'var(--blood-bright)', animation: 'pulse 2s infinite' }}>⚔</span>
        <div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>НЕДЕЛЬНАЯ ВОЙНА · СРЕДА</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-bright)', letterSpacing: '0.06em', fontWeight: 700, marginTop: 1 }}>
            Кровь·IX <span style={{ color: 'var(--blood-bright)' }}>vs</span> Некропоэзис
          </div>
        </div>
        <div className="grow" />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ЛИНИЙ ВЗЯТО</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, letterSpacing: '0.1em', color: 'var(--ember-bright)' }}>
            <span style={{ color: wonLines >= 3 ? 'var(--toxic-lit)' : 'var(--ember-bright)' }}>{wonLines}</span>
            <span style={{ color: 'var(--ink-dim)' }}> / 5 / </span>
            <span style={{ color: 'var(--blood-lit)' }}>{lines.length - wonLines}</span>
          </div>
        </div>
        <div className="inset-groove" style={{ padding: '6px 12px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ДО КОНЦА</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--blood-lit)', fontWeight: 700 }}>2д 14ч</div>
        </div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map(l => {
          const won = l.us > l.them;
          const total = l.us + l.them;
          const usPct = (l.us / total) * 100;
          return (
            <div key={l.sec} style={{
              padding: '10px 14px', background: 'var(--bg-inset)',
              border: `1px solid ${won ? 'var(--toxic)' : 'var(--blood-dark)'}`,
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 16, color: l.c, width: 22, textAlign: 'center', flexShrink: 0 }}>{l.icon}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: l.c, fontWeight: 700, letterSpacing: '0.1em', flexShrink: 0 }}>{l.sec}</span>
                <div className="grow" />
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
                  padding: '2px 10px', flexShrink: 0,
                  color: won ? '#041008' : '#e8dccb',
                  background: won ? 'var(--toxic-lit)' : 'var(--blood-lit)',
                  clipPath: 'polygon(4px 0, calc(100% - 4px) 0, 100% 50%, calc(100% - 4px) 100%, 4px 100%, 0 50%)',
                }}>{won ? 'ПОБЕДА' : 'ПРОИГРЫШ'}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: won ? 'var(--toxic-lit)' : 'var(--ink-mid)', letterSpacing: '0.05em', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.player} <span style={{ color: 'var(--ink-dim)' }}>vs</span> {l.enemy}
              </div>
              {/* Tug-of-war bar */}
              <div style={{ position: 'relative', height: 14, background: '#0a0404', border: '1px solid var(--metal-dark)', display: 'flex' }}>
                <div style={{ width: `${usPct}%`, background: `linear-gradient(90deg, ${l.c}, ${l.c}cc)`, transition: 'width 0.4s' }} />
                <div style={{ width: `${100 - usPct}%`, background: 'linear-gradient(90deg, var(--blood-deep), var(--blood))' }} />
                <div style={{ position: 'absolute', left: `${usPct}%`, top: -2, width: 2, height: 18, background: 'var(--ink-bright)', transform: 'translateX(-1px)', boxShadow: '0 0 4px #fff' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--font-code)', fontSize: 9 }}>
                <span style={{ color: l.c, fontWeight: 700 }}>НАШИ · {l.us.toLocaleString('ru')}</span>
                <span style={{ color: 'var(--blood-lit)', fontWeight: 700 }}>{l.them.toLocaleString('ru')} · ИХ</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CaptureEvent() {
  return (
    <div className="panel" style={{ padding: 0, borderColor: 'var(--ember)' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid var(--ember-dark, #3a1f08)' }}>
        <span className="ornament" style={{ color: 'var(--ember-bright)' }}>♛</span> Захват Компании
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em', animation: 'pulse 2s infinite' }}>● АКТИВНО · 36ч</span>
      </div>
      <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 64, height: 64, flexShrink: 0, position: 'relative' }}>
          <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
            <polygon points="40,4 72,22 72,58 40,76 8,58 8,22" fill="#1a0808" stroke="#EF9F27" strokeWidth="1.5" />
            <text x="40" y="50" textAnchor="middle" fontFamily="var(--font-blackletter)" fontSize="30" fill="#f5c56b" fontWeight="700">O</text>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>
            ОЗОН · осада крепости
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic', marginTop: 2 }}>
            Набрать 10 000 очков по задачам Ozon за 48 часов. Награда — герб «Осаждающие».
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 8, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', position: 'relative' }}>
              <div style={{ width: '62%', height: '100%', background: 'linear-gradient(90deg, var(--ember), var(--ember-lit))', boxShadow: '0 0 8px var(--ember-lit)' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-bright)', fontWeight: 700 }}>6 240 / 10 000</span>
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>
            Топ вклад: Нихил 1 820 · root_priest 1 440 · BitReaper 1 210
          </div>
        </div>
        <button className="btn btn-blood" style={{ padding: '10px 16px', fontSize: 11, flexShrink: 0 }}>⚔ ПРИСОЕДИНИТЬСЯ</button>
      </div>
    </div>
  );
}

function Chronicle() {
  const entries = [
    { who: 'BitReaper', t: 'взял линию BACKEND против goroutine_x · +280 очков', when: '2ч', c: '#EF9F27', icon: '◉' },
    { who: 'Серый·Маг', t: 'закрыл третью линию BEHAVIORAL · +190 очков', when: '4ч', c: '#1D9E75', icon: '◉' },
    { who: 'Нихил', t: 'осадил ОЗОН — +1 820 очков в захвате', when: '6ч', c: 'var(--ember-lit)', icon: '♛' },
    { who: 'null_witch', t: 'принял вступление · инициация начата', when: '1д', c: 'var(--toxic-lit)', icon: '✦' },
    { who: 'Orden', t: 'недельная война объявлена: Некропоэзис', when: '2д', c: 'var(--blood-lit)', icon: '⚔' },
    { who: 'void_walker', t: 'проиграл линию SYS DESIGN против CAP_theorem', when: '3д', c: 'var(--blood-lit)', icon: '☠' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">✦</span> Летопись Гильдии</div>
      <div style={{ padding: '6px 16px' }}>
        {entries.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < entries.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <span style={{ fontSize: 14, color: e.c, width: 20, textAlign: 'center', flexShrink: 0 }}>{e.icon}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--ink-bright)', width: 110, flexShrink: 0, letterSpacing: '0.04em' }}>{e.who}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', flex: 1, minWidth: 0 }}>{e.t}</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em', flexShrink: 0 }}>{e.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------- RIGHT: SEASON + RIVALS + BOARD -------------
function RightGuild() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SeasonTrack />
      <Rivals />
      <QuestBoard />
    </div>
  );
}

function SeasonTrack() {
  const milestones = [
    { n: 1, reward: 'Герб', done: true },
    { n: 5, reward: 'Знамя', done: true },
    { n: 10, reward: 'Аура', done: true },
    { n: 15, reward: 'Титул', done: false, current: true },
    { n: 20, reward: 'Реликвия', done: false },
    { n: 25, reward: 'Трон', done: false },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✧</span> Сезон II · The Recursion
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>12/25</span>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', lineHeight: 1.5, fontStyle: 'italic' }}>
          « Рекурсия пожирает собственный хвост. Вы — виток, который не сорвётся. »
        </div>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {milestones.map(m => (
            <div key={m.n} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
              background: m.current ? 'linear-gradient(90deg, rgba(224,155,58,0.12), transparent)' : 'transparent',
              borderLeft: m.current ? '2px solid var(--ember-bright)' : '2px solid transparent',
            }}>
              <span style={{
                width: 22, height: 22, flexShrink: 0,
                background: m.done ? 'var(--toxic-lit)' : m.current ? 'var(--ember-lit)' : 'var(--bg-inset)',
                border: `1px solid ${m.done ? 'var(--toxic-bright, #b8e860)' : m.current ? 'var(--ember-bright)' : 'var(--metal)'}`,
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 700,
                color: m.done ? '#041008' : m.current ? '#1a0d00' : 'var(--ink-dim)',
                boxShadow: m.current ? '0 0 8px var(--ember-lit)' : 'none',
              }}>{m.done ? '✓' : m.n}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.15em', width: 40 }}>LVL {m.n}</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 12, color: m.done ? 'var(--toxic-lit)' : m.current ? 'var(--ember-bright)' : 'var(--ink-mid)', letterSpacing: '0.05em', fontWeight: 600 }}>{m.reward}</span>
              {m.current && <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>840/1k</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Rivals() {
  const rivals = [
    { n: 'Некропоэзис', elo: 4412, w: 18, l: 5, status: 'war', c: 'var(--blood-bright)' },
    { n: 'Хранители·Нуля', elo: 4180, w: 22, l: 9, status: 'rival', c: 'var(--rarity-magic)' },
    { n: 'Orden·Voidi', elo: 3960, w: 14, l: 14, status: 'neutral', c: 'var(--ink-mid)' },
    { n: 'Без·Имени', elo: 4740, w: 27, l: 2, status: 'fear', c: 'var(--rarity-rare)' },
  ];
  const statusLabel = { war: 'ВОЙНА', rival: 'СОПЕРНИКИ', neutral: '—', fear: 'НЕДОСТИЖИМЫ' };
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">♆</span> Вражеский Лагерь</div>
      <div style={{ padding: '8px 0' }}>
        {rivals.map((r, i) => (
          <div key={r.n} style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: i < rivals.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.n}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: r.c, letterSpacing: '0.15em' }}>{statusLabel[r.status]} · {r.w}W–{r.l}L</div>
            </div>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-lit)', fontWeight: 700 }}>{r.elo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestBoard() {
  const quests = [
    { t: 'Закрыть линию Sys Design', p: '0/1', xp: 280, c: 'var(--rarity-magic)' },
    { t: 'Рекрутировать 2 инициатов', p: '1/2', xp: 120, c: 'var(--toxic-lit)' },
    { t: 'Вклад в казну 5 000 ❂', p: '3 120/5 000', xp: 180, c: 'var(--rarity-gem)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">☉</span> Доска Заданий</div>
      <div style={{ padding: '8px 0' }}>
        {quests.map((q, i) => (
          <div key={i} style={{ padding: '8px 14px', borderBottom: i < quests.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: q.c }}>◈</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-bright)', flex: 1 }}>{q.t}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', fontWeight: 700 }}>+{q.xp}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: q.c, letterSpacing: '0.1em', marginTop: 3, paddingLeft: 18 }}>{q.p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { GuildScreen });
