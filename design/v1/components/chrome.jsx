// ============== Shared heraldic elements ==============

function Divider({ children, style }) {
  return (
    <div className="divider" style={style}>
      <span className="star">✦</span>
      <span>{children}</span>
      <span className="star">✦</span>
    </div>
  );
}

function Corners() {
  return <span className="c-br" aria-hidden />;
}

function Card({ children, className = '', style, large = false }) {
  return (
    <div className={`card corners ${large ? 'corners-lg' : ''} ${className}`} style={style}>
      <Corners />
      {children}
    </div>
  );
}

// ============== Topbar ==============
function Topbar({ screen, onNav }) {
  const navs = ['Sanctum', 'Arena', 'Guild', 'Atlas', 'Codex'];
  const active = {
    sanctum: 'Sanctum', 'ai-mock': 'Sanctum', 'ai-native': 'Sanctum',
    atlas: 'Atlas', profile: 'Sanctum', arena: 'Arena', kata: 'Sanctum',
    calendar: 'Sanctum', guild: 'Guild', autopsy: 'Sanctum', mobile: 'Sanctum', onboarding: 'Sanctum'
  }[screen] || 'Sanctum';

  return (
    <div style={{
      height: 48,
      borderBottom: '1px solid var(--gold-dim)',
      background: 'var(--bg-surface)',
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 28,
      position: 'sticky', top: 0, zIndex: 40
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="22" height="22" viewBox="0 0 22 22">
          <polygon points="11,1 20,6 20,16 11,21 2,16 2,6" fill="none" stroke="#c8a96e" strokeWidth="1.2" />
          <polygon points="11,6 15,8.5 15,13.5 11,16 7,13.5 7,8.5" fill="#c8a96e" />
        </svg>
        <span className="heraldic" style={{ color: 'var(--gold-bright)', fontSize: 16 }}>DRUZ9</span>
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--gold-dim)' }} />

      {/* Season */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--text-mid)', letterSpacing: '0.22em' }}>SEASON&nbsp;II</span>
        <span style={{ color: 'var(--gold-dim)' }}>·</span>
        <span className="heraldic" style={{ color: 'var(--gold)', fontSize: 11 }}>The&nbsp;Recursion</span>
      </div>

      <div style={{ width: 1, height: 22, background: 'var(--gold-dim)' }} />

      {/* Nav */}
      <nav style={{ display: 'flex', gap: 4 }}>
        {navs.map(n => (
          <button key={n}
            onClick={() => onNav && onNav(n)}
            className="display"
            style={{
              padding: '6px 14px', fontSize: 11, letterSpacing: '0.2em',
              color: n === active ? 'var(--gold-bright)' : 'var(--text-mid)',
              borderBottom: n === active ? '1px solid var(--gold)' : '1px solid transparent'
            }}>
            {n.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="grow" />

      {/* XP Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--text-mid)', letterSpacing: '0.2em' }}>XP</span>
        <div style={{ position: 'relative', width: 180, height: 10, background: 'var(--bg-inset)', border: '1px solid var(--gold-faint)' }}>
          <div style={{ position: 'absolute', inset: 0, width: '62%', background: 'var(--gold)' }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                         fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--bg-base)', fontWeight: 700, letterSpacing: '0.15em' }}>
            18,420&nbsp;/&nbsp;29,700
          </div>
        </div>
      </div>

      {/* Level */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--text-mid)', letterSpacing: '0.2em' }}>ASCENDANT</span>
        <span className="heraldic" style={{ color: 'var(--gold-bright)', fontSize: 14 }}>LVL 24</span>
      </div>

      {/* Hex avatar */}
      <div className="hex-wrap">
        <div className="hex" style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CharacterChip size={28} />
        </div>
      </div>
    </div>
  );
}

// ============== Left Sidebar — Character & Menu ==============
function LeftSidebar({ onNav, activeSub }) {
  const attrs = [
    { name: 'Intellect',  val: 14, section: 'algo' },
    { name: 'Strength',   val: 11, section: 'sd' },
    { name: 'Dexterity',  val: 9,  section: 'sql' },
    { name: 'Will',       val: 8,  section: 'beh' },
  ];

  const menu = [
    { group: '✦ PRACTICE ✦', items: [
      { label: 'AI Mock', icon: '◈', key: 'ai-mock' },
      { label: 'Live Mock', icon: '⚗', key: 'mock-live' },
      { label: 'AI-Native Round', icon: '⚜', key: 'ai-native' },
      { label: 'Editor', icon: '⊕', key: 'editor' },
    ]},
    { group: '✦ TRIALS ✦', items: [
      { label: 'Arena 1v1', icon: '⚔', key: 'arena' },
      { label: 'Arena 2v2', icon: '⚔', key: 'arena-2v2' },
      { label: 'Guild Wars', icon: '◉', key: 'guild' },
    ]},
    { group: '✦ TRAINING ✦', items: [
      { label: 'Daily Kata', icon: '✦', key: 'kata' },
      { label: 'Interview Calendar', icon: '◈', key: 'calendar' },
      { label: 'Autopsy', icon: '⊘', key: 'autopsy' },
    ]},
  ];

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--gold-dim)',
      display: 'flex', flexDirection: 'column',
      padding: '20px 0', position: 'relative'
    }}>
      {/* Character block */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px 20px', borderBottom: '1px solid var(--gold-faint)' }}>
        <CharacterPortrait size={160} level={24} />
        <div className="heraldic" style={{ color: 'var(--gold-bright)', fontSize: 13, marginTop: 10 }}>Alexei&nbsp;Volkov</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'var(--gold)', letterSpacing: '0.2em', marginTop: 4 }}>
          ASCENDANT · BACKEND ARCHITECT
        </div>

        {/* Attributes */}
        <div style={{ width: '100%', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attrs.map(a => (
            <div key={a.name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, letterSpacing: '0.2em', fontFamily: 'var(--font-display)' }}>
                <span style={{ color: 'var(--text-mid)' }}>{a.name.toUpperCase()}</span>
                <span style={{ color: 'var(--gold-bright)' }}>{a.val}</span>
              </div>
              <div className="seg-bar" style={{ height: 6 }}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <span key={i} className={i < a.val ? 'on' : ''} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Menu */}
      <nav style={{ display: 'flex', flexDirection: 'column', padding: '14px 0', flex: 1, overflow: 'auto' }}>
        {menu.map(g => (
          <div key={g.group} style={{ marginBottom: 12 }}>
            <div style={{ padding: '6px 16px', fontFamily: 'var(--font-heraldic)', fontSize: 9, color: 'var(--gold-dim)', letterSpacing: '0.25em' }}>
              {g.group}
            </div>
            {g.items.map(it => {
              const isActive = it.key === activeSub;
              return (
                <button key={it.key} onClick={() => onNav && onNav(it.key)}
                  style={{
                    width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 16px',
                    color: isActive ? 'var(--gold-bright)' : 'var(--text-mid)',
                    background: isActive ? 'rgba(200,169,110,0.06)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                    fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.1em'
                  }}>
                  <span style={{ color: isActive ? 'var(--gold)' : 'var(--gold-dim)', width: 14 }}>{it.icon}</span>
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ============== Right Sidebar — Flasks, Leaderboard, Season Track ==============
function RightSidebar() {
  const leaderboard = [
    { rank: 1,  name: 'ΣShadowFang',    elo: 2684 },
    { rank: 2,  name: 'Korvax.the.9th', elo: 2612 },
    { rank: 3,  name: 'VeilPiercer',    elo: 2551 },
    { rank: 4,  name: 'alexei.volkov',  elo: 2498, me: true },
    { rank: 5,  name: 'mokoshReborn',   elo: 2455 },
  ];

  return (
    <aside style={{
      width: 180, flexShrink: 0,
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--gold-dim)',
      display: 'flex', flexDirection: 'column',
      padding: 16, gap: 20, overflow: 'auto'
    }}>
      {/* Flasks */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>Flasks</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, justifyItems: 'center' }}>
          <PowerFlask color="#6a9fd4" fill={0.85} label="INSIGHT" />
          <PowerFlask color="#c0392b" fill={0.55} label="RESOLVE" />
          <PowerFlask color="#639922" fill={0.92} label="VIGOR" />
          <PowerFlask color="#EF9F27" fill={0.30} label="FOCUS" />
        </div>
      </div>

      {/* Leaderboard */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>League Top&nbsp;5</Divider>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {leaderboard.map(p => (
            <div key={p.rank} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px',
              background: p.me ? 'rgba(200,169,110,0.08)' : 'transparent',
              border: p.me ? '1px solid var(--gold)' : '1px solid transparent',
              fontSize: 10
            }}>
              <span style={{ fontFamily: 'var(--font-display)', color: p.me ? 'var(--gold-bright)' : 'var(--gold-dim)', width: 16 }}>
                {String(p.rank).padStart(2, '0')}
              </span>
              <span style={{ color: p.me ? 'var(--gold-bright)' : 'var(--text-mid)', flex: 1, fontFamily: 'var(--font-display)', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span style={{ fontFamily: 'var(--font-code)', color: p.me ? 'var(--gold-bright)' : 'var(--text-mid)', fontSize: 9 }}>
                {p.elo}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Season Track */}
      <div>
        <Divider style={{ fontSize: 9, marginBottom: 12 }}>Season Track</Divider>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--text-mid)', letterSpacing: '0.15em', marginBottom: 8 }}>
          TIER 18 / 40 · 2,140 SP
        </div>
        <div style={{ position: 'relative', paddingLeft: 8 }}>
          {/* vertical line */}
          <div style={{ position: 'absolute', left: 13, top: 0, bottom: 0, width: 1, background: 'var(--gold-dim)' }} />
          {[
            { tier: 16, reward: 'Avatar Frame', done: true },
            { tier: 17, reward: '200 AI Credits', done: true },
            { tier: 18, reward: 'Aura: Ember', done: true, current: true },
            { tier: 19, reward: 'Title: Seeker', done: false },
            { tier: 20, reward: 'Guild Emblem', done: false, big: true },
            { tier: 21, reward: '500 AI Credits', done: false },
          ].map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', position: 'relative' }}>
              {/* diamond checkpoint */}
              <div style={{
                width: c.big ? 16 : 11, height: c.big ? 16 : 11,
                transform: 'rotate(45deg)', flexShrink: 0,
                background: c.done ? 'var(--gold)' : 'var(--bg-inset)',
                border: `1px solid ${c.current ? 'var(--gold-bright)' : c.done ? 'var(--gold)' : 'var(--gold-dim)'}`,
                boxShadow: c.current ? '0 0 0 2px rgba(200,169,110,0.2)' : 'none',
                marginLeft: c.big ? -2 : 0
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--gold-dim)', letterSpacing: '0.15em' }}>T{c.tier}</div>
                <div style={{ fontSize: 10, color: c.done ? 'var(--gold-bright)' : 'var(--text-mid)' }}>{c.reward}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { Divider, Card, Corners, Topbar, LeftSidebar, RightSidebar });
