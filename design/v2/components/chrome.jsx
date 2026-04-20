// Shared chrome: Logo, Topbar, Nav, OrbHUD, CharacterPortrait

function LogoMark({ size = 28, variant = 'sigil' }) {
  // Three variants; default = sigil (skull + 9 rune)
  if (variant === 'blackletter') {
    return (
      <span style={{ fontFamily: 'var(--font-blackletter)', fontSize: size, color: 'var(--blood-lit)', letterSpacing: '0.02em', lineHeight: 1 }}>Druʒ9</span>
    );
  }
  if (variant === 'carved') {
    return (
      <span style={{
        fontFamily: 'var(--font-display)', fontSize: size, fontWeight: 900, letterSpacing: '0.18em',
        color: 'var(--ember-bright)',
        textShadow: '0 1px 0 #000, 0 2px 0 #1a0d04, 0 -1px 0 rgba(245,197,107,0.3)',
      }}>DRUZ·IX</span>
    );
  }
  // sigil: skull with 9 rune
  const s = size;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={s} height={s} viewBox="0 0 40 40">
        <defs>
          <radialGradient id="emberGlow" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="#e09b3a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#e09b3a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill="url(#emberGlow)" />
        {/* Skull silhouette */}
        <path d="M20 6 C11 6 6 12 6 19 C6 23 8 25 9 26 L9 30 L12 30 L12 33 L15 33 L15 30 L18 30 L18 33 L22 33 L22 30 L25 30 L25 33 L28 33 L28 30 L31 30 L31 26 C32 25 34 23 34 19 C34 12 29 6 20 6 Z"
              fill="#1a0606" stroke="#8a1414" strokeWidth="1" />
        {/* Eye sockets */}
        <ellipse cx="14" cy="18" rx="3" ry="4" fill="#000" />
        <ellipse cx="26" cy="18" rx="3" ry="4" fill="#000" />
        {/* Glow in eyes */}
        <circle cx="14" cy="18" r="1.2" fill="#c22222" />
        <circle cx="26" cy="18" r="1.2" fill="#c22222" />
        {/* Nose */}
        <path d="M20 20 L18 24 L20 25 L22 24 Z" fill="#000" />
        {/* 9 rune on forehead */}
        <text x="20" y="14" textAnchor="middle" fontFamily="var(--font-display)" fontSize="6" fill="#e09b3a" fontWeight="900">IX</text>
      </svg>
      <span style={{
        fontFamily: 'var(--font-display)', fontSize: size * 0.75, fontWeight: 900,
        letterSpacing: '0.22em', color: 'var(--ink-bright)',
        textShadow: '0 0 12px rgba(194,34,34,0.4)',
      }}>DRUZ<span style={{ color: 'var(--blood-lit)' }}>·</span>IX</span>
    </div>
  );
}

function Topbar({ page, onNav }) {
  const items = [
    { k: 'sanctum',  ru: 'Святилище' },
    { k: 'forge',    ru: 'Кузня' },
    { k: 'arena',    ru: 'Арена' },
    { k: 'atlas',    ru: 'Атлас' },
    { k: 'skills',   ru: 'Скиллы' },
    { k: 'relics',   ru: 'Реликвии' },
    { k: 'guild',    ru: 'Гильдия' },
    { k: 'codex',    ru: 'Кодекс' },
    { k: 'profile',  ru: 'Профиль' },
  ];
  return (
    <header style={{
      height: 60, background: 'linear-gradient(180deg, #14100e, #0a0706)',
      borderBottom: '1px solid var(--metal)',
      boxShadow: '0 2px 0 rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 20,
      position: 'sticky', top: 0, zIndex: 40,
    }}>
      <a href="sanctum.html" style={{ textDecoration: 'none' }}>
        <LogoMark size={28} />
      </a>
      <div style={{ width: 1, height: 30, background: 'var(--metal)' }} />
      <nav style={{ display: 'flex', gap: 0 }}>
        {items.map(it => {
          const active = it.k === page;
          return (
            <a key={it.k} href={`${it.k}.html`}
               style={{
                 padding: '10px 11px',
                 fontFamily: 'var(--font-body)',
                 fontSize: 10.5, fontWeight: 700,
                 letterSpacing: '0.14em', textTransform: 'uppercase',
                 color: active ? 'var(--ember-bright)' : 'var(--ink-mid)',
                 borderBottom: active ? '2px solid var(--blood-lit)' : '2px solid transparent',
                 background: active ? 'linear-gradient(180deg, transparent, rgba(138,20,20,0.15))' : 'transparent',
                 whiteSpace: 'nowrap',
                 display: 'inline-flex',
                 alignItems: 'center',
                 textDecoration: 'none',
               }}>
              {it.ru}
            </a>
          );
        })}
      </nav>
      <div className="grow" />
      <SeasonPulse />
      <CurrencyBar />
      <CharHeader />
      <IconLinks page={page} />
    </header>
  );
}

function SeasonPulse() {
  return (
    <a href="season.html" title="Сезон Tenebræ · 27 дней" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', background: 'linear-gradient(90deg, #3a0808, #1a0404)',
      border: '1px solid var(--blood-lit)', textDecoration: 'none',
      boxShadow: 'inset 0 0 8px rgba(232,56,56,0.2)',
    }}>
      <span style={{
        width: 7, height: 7, background: 'var(--blood-bright)', borderRadius: '50%',
        boxShadow: '0 0 8px var(--blood-bright)',
        animation: 'pulse 2s infinite',
      }} />
      <span style={{ fontFamily: 'var(--font-blackletter)', fontSize: 14, color: 'var(--ink-bright)', lineHeight: 1 }}>Tenebræ</span>
      <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em', fontWeight: 700 }}>27д</span>
    </a>
  );
}

function IconLinks({ page }) {
  const links = [
    { k: 'results',  t: 'Итог', i: '☠' },
    { k: 'settings', t: 'Настройки', i: '❂' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {links.map(l => {
        const active = l.k === page;
        return (
          <a key={l.k} href={`${l.k}.html`} title={l.t} style={{
            width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: active ? 'var(--bg-inset)' : 'transparent',
            border: '1px solid var(--metal-dark)',
            color: active ? 'var(--ember-bright)' : 'var(--ink-mid)',
            fontSize: 16, textDecoration: 'none',
          }}>{l.i}</a>
        );
      })}
    </div>
  );
}

function CurrencyBar() {
  const items = [
    { icon: '◈', v: '1,240', label: 'XP', c: 'var(--ember-lit)' },
    { icon: '⬢', v: '47',    label: 'Гемы', c: 'var(--rarity-gem)' },
    { icon: '❂', v: '12',    label: 'Свитки', c: 'var(--rarity-rare)' },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      {items.map(i => (
        <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }}>
          <span style={{ color: i.c, fontSize: 14 }}>{i.icon}</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--ink-bright)', fontWeight: 700 }}>{i.v}</span>
        </div>
      ))}
    </div>
  );
}

function CharHeader() {
  const char = (() => {
    try { return JSON.parse(localStorage.getItem('druz9.character') || '{}'); } catch { return {}; }
  })();
  const CLASS_NAMES = {
    alg: 'АЛГОРИТМИСТ', dba: 'DBA·ЖРЕЦ', back: 'БЭКЕНД-ВОИН',
    arch: 'АРХИТЕКТОР', comm: 'БЕХАВ·МАГ', ai: 'AI-АПОСТАТ',
  };
  const name  = char.name ? char.name.toUpperCase() : 'А. ВОЛКОВ';
  const cls   = CLASS_NAMES[char.charClass] || 'АРХИТЕКТОР';
  const level = char.level || 24;
  const init  = (char.name || 'А').trim().charAt(0).toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', letterSpacing: '0.08em' }}>{name}</div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.1em' }}>LVL {level} · {cls}</div>
      </div>
      <div style={{
        width: 42, height: 42,
        background: 'radial-gradient(circle, #3a0909 0%, #0a0303 100%)',
        border: '2px solid var(--metal-lit)',
        boxShadow: '0 0 10px rgba(194,34,34,0.3), inset 0 0 10px rgba(0,0,0,0.8)',
        position: 'relative',
        clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ember-bright)', fontWeight: 900 }}>{init}</span>
      </div>
    </div>
  );
}

function OrbHUD() {
  // The PoE-signature dual-orb HUD (health + mana) — sits at bottom
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'flex-end', gap: 0, zIndex: 30, pointerEvents: 'none',
    }}>
      {/* Life orb (blood) */}
      <div style={{ position: 'relative' }}>
        <div className="orb" style={{ width: 110, height: 110 }}>
          <div className="orb-fill" style={{ height: '72%' }} />
          <div className="orb-label">
            <div style={{ fontSize: 18, fontWeight: 700 }}>1,840</div>
            <div style={{ fontSize: 9, color: 'var(--ink-mid)', letterSpacing: '0.15em' }}>/ 2,560</div>
          </div>
        </div>
      </div>

      {/* Skill bar (center) */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px',
        background: 'linear-gradient(180deg, #1a1410, #0a0706)',
        border: '1px solid var(--metal-lit)',
        borderBottom: 'none',
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.6)',
        marginBottom: 8,
      }}>
        {['⚔', '◈', '✦', '⬢', '❂'].map((g, i) => (
          <div key={i} style={{
            width: 44, height: 44,
            background: i === 0 ? 'radial-gradient(circle, #5a1414, #0a0303)' : 'var(--bg-inset)',
            border: `1px solid ${i === 0 ? 'var(--blood-lit)' : 'var(--metal)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: i === 0 ? 'var(--blood-bright)' : 'var(--ink-dim)',
            position: 'relative',
          }}>
            {g}
            <span style={{
              position: 'absolute', bottom: 1, right: 2,
              fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-mid)'
            }}>{i + 1}</span>
          </div>
        ))}
      </div>

      {/* Mana orb (blue) */}
      <div className="orb" style={{
        width: 110, height: 110,
        background: 'radial-gradient(circle at 35% 30%, #1a1a5a, #060a1a 70%)',
      }}>
        <div className="orb-fill" style={{
          height: '54%',
          background: 'linear-gradient(180deg, rgba(100,100,255,0.8), rgba(40,40,160,0.95))'
        }} />
        <div className="orb-label">
          <div style={{ fontSize: 18, fontWeight: 700 }}>420</div>
          <div style={{ fontSize: 9, color: 'var(--ink-mid)', letterSpacing: '0.15em' }}>/ 780</div>
        </div>
      </div>
    </div>
  );
}

function CharacterPortrait({ size = 140, name = 'АЛЕКСЕЙ', cls = 'АРХИТЕКТОР', level = 24 }) {
  return (
    <div style={{
      width: size, height: size, position: 'relative',
      background: 'radial-gradient(ellipse at 50% 30%, #2a1010, #0a0404 70%)',
      border: '2px solid var(--metal-lit)',
      boxShadow: 'inset 0 0 30px rgba(0,0,0,0.9), 0 0 20px rgba(138,20,20,0.3)',
    }}>
      {/* Silhouette warrior */}
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
        <defs>
          <radialGradient id="emberFloor" cx="50%" cy="95%" r="50%">
            <stop offset="0%" stopColor="#e09b3a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#e09b3a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#emberFloor)" opacity="0.4" />
        {/* Ground */}
        <ellipse cx="50" cy="92" rx="28" ry="4" fill="#1a0808" />
        {/* Cape */}
        <path d="M30 38 Q25 60 28 88 L72 88 Q75 60 70 38 Z" fill="#1a0404" stroke="#3a0808" strokeWidth="0.5" />
        {/* Body */}
        <path d="M38 42 L38 72 L62 72 L62 42 Z" fill="#0f0808" />
        <path d="M35 70 L35 85 L45 85 L45 72 Z M55 72 L55 85 L65 85 L65 70 Z" fill="#0a0404" />
        {/* Shoulders */}
        <path d="M32 40 L38 42 L38 52 L30 48 Z M68 42 L62 42 L62 52 L70 48 Z" fill="#2a1a0a" stroke="#453015" strokeWidth="0.5" />
        {/* Head/helm */}
        <path d="M42 28 L42 42 L58 42 L58 28 Q50 22 42 28 Z" fill="#1a1008" stroke="#3a2010" strokeWidth="0.5" />
        {/* Helm slit */}
        <rect x="45" y="32" width="10" height="2" fill="#c22222" opacity="0.9" />
        {/* Sword */}
        <rect x="48" y="46" width="4" height="26" fill="#5a5045" />
        <rect x="44" y="44" width="12" height="3" fill="#7a6a55" />
        <rect x="49" y="70" width="2" height="4" fill="#3a3025" />
      </svg>
      {/* Level badge */}
      <div style={{
        position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)',
        padding: '3px 10px', background: 'linear-gradient(180deg, #3a0808, #1a0404)',
        border: '1px solid var(--blood-lit)',
        fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
        color: 'var(--ember-bright)', letterSpacing: '0.15em',
        clipPath: 'polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%)',
      }}>LVL {level}</div>
    </div>
  );
}

Object.assign(window, { LogoMark, Topbar, OrbHUD, CharacterPortrait });
