// Dark Season — сезонное событие в духе PoE leagues. 6 недель,
// модификаторы, лидборд, уникальные награды. Тон — мрачная молитва.
function DarkSeasonScreen() {
  return (
    <div style={{ padding: 0, paddingBottom: 120 }}>
      <SeasonHero />
      <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginTop: 16 }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Modifiers />
          <SeasonPass />
          <Leaderboard />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SeasonTimer />
          <UniqueRewards />
          <Lore />
        </div>
      </div>
    </div>
  );
}

function SeasonHero() {
  return (
    <div style={{ position: 'relative', height: 320, overflow: 'hidden', borderBottom: '1px solid var(--blood)' }}>
      {/* Layered background */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 120%, #5a0808 0%, #1a0303 40%, #0a0101 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, rgba(232,56,56,0.25), transparent 60%)' }} />
      {/* Falling "ash" */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {Array.from({ length: 60 }).map((_, i) => {
          const x = (i * 37 + 17) % 100;
          const y = (i * 13 + 7) % 100;
          const size = ((i * 7) % 3) + 1;
          return <circle key={i} cx={`${x}%`} cy={`${y}%`} r={size} fill="#e09b3a" opacity={0.3 + ((i * 5) % 40) / 100} />;
        })}
      </svg>
      {/* Claws / scratches */}
      <svg viewBox="0 0 1200 320" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.25 }} preserveAspectRatio="none">
        <path d="M 50 0 L 180 320" stroke="#c22222" strokeWidth="1.5" />
        <path d="M 80 0 L 210 320" stroke="#c22222" strokeWidth="1" />
        <path d="M 110 0 L 240 320" stroke="#c22222" strokeWidth="0.8" />
        <path d="M 960 0 L 1090 320" stroke="#c22222" strokeWidth="1.2" />
        <path d="M 990 0 L 1120 320" stroke="#c22222" strokeWidth="1" />
        <path d="M 1020 0 L 1150 320" stroke="#c22222" strokeWidth="0.8" />
      </svg>

      <div style={{ position: 'relative', padding: '50px 40px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--blood-bright)', letterSpacing: '0.5em', fontWeight: 700 }}>СЕЗОН IX · ЛИГА · 6 НЕДЕЛЬ</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 104, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 12, textShadow: '0 0 40px rgba(232,56,56,0.6), 0 4px 0 #000', letterSpacing: '0.02em' }}>
          Tenebræ
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--ember-bright)', letterSpacing: '0.25em', marginTop: 4, fontStyle: 'italic' }}>Тьма</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-mid)', marginTop: 16, maxWidth: 620, margin: '16px auto 0', lineHeight: 1.5, fontStyle: 'italic' }}>
          « Рынок сжался. Ликторы стали резче, окна уже, follow-up жёстче. Кто выдержит шесть недель без света — тот выходит драконобойцем. »
        </div>
        <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-blood" style={{ padding: '12px 28px', fontSize: 11 }}>⚔ ВСТУПИТЬ В ЛИГУ</button>
          <button className="btn btn-ghost" style={{ padding: '12px 22px', fontSize: 11 }}>◈ ПРАВИЛА</button>
        </div>
      </div>
    </div>
  );
}

function SeasonTimer() {
  return (
    <div className="panel" style={{ padding: 0, borderColor: 'var(--blood)' }}>
      <div className="panel-head" style={{ color: 'var(--blood-bright)' }}><span className="ornament">⏳</span> До конца лиги</div>
      <div style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[['27','ДН'],['14','ЧС'],['32','МН'],['06','СК']].map(([v, l]) => (
            <div key={l} style={{ padding: '10px 4px', background: 'var(--bg-inset)', border: '1px solid var(--metal)' }}>
              <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 32, color: 'var(--blood-bright)', lineHeight: 1 }}>{v}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.25em', marginTop: 4, fontWeight: 700 }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 12, fontStyle: 'italic' }}>
          Лига закрывается 15 апреля. После — персонажи переходят в Стандартную лигу.
        </div>
      </div>
    </div>
  );
}

function Modifiers() {
  const mods = [
    { i: '☠', t: 'Жадный Ликтор', d: 'На каждый бой +1 follow-up, случайно прерывает ответ на 14-й секунде.', c: 'var(--blood-lit)' },
    { i: '☉', t: 'Короткое Солнце', d: 'Системные дизайны — 25 минут вместо 45. Учись отвечать плотно.', c: 'var(--ember-bright)' },
    { i: '⚡', t: 'Голод Рынка', d: '+40% XP за убитого дракона. Меньше вакансий, но каждая — тяжелее.', c: 'var(--toxic-lit)' },
    { i: '◐', t: 'Зеркало Самозванца', d: 'В начале боя Ликтор задаёт провокационный личный вопрос. Не игнорировать.', c: 'var(--rarity-magic)' },
    { i: '✕', t: 'Hardcore', d: 'Одна смерть — персонаж уходит в Стандарт. Только для сильнейших.', c: 'var(--blood-bright)', hardcore: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⟐</span> Модификаторы лиги · действуют все сразу</div>
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {mods.map((m, i) => (
          <div key={i} style={{
            padding: 12, background: 'var(--bg-inset)', border: `1px solid ${m.c}44`,
            gridColumn: m.hardcore ? '1 / -1' : 'auto',
            position: 'relative', overflow: 'hidden',
          }}>
            {m.hardcore && <div style={{ position: 'absolute', top: 0, right: 0, padding: '2px 10px', background: 'var(--blood)', fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-bright)', letterSpacing: '0.3em', fontWeight: 700 }}>OPT-IN</div>}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 20, color: m.c }}>{m.i}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: m.c, fontWeight: 700, letterSpacing: '0.06em' }}>{m.t}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', marginTop: 6, lineHeight: 1.5 }}>{m.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeasonPass() {
  const tiers = [
    { lvl: 1, name: 'Послушник', reward: '+3 свитка', got: true, prem: false },
    { lvl: 5, name: 'Носящий прах', reward: 'Реликвия · Пепельный Плащ', got: true, prem: false },
    { lvl: 10, name: 'Крестоносец', reward: 'Титул в профиль', got: true, prem: false },
    { lvl: 15, name: 'Чернокнижник', reward: '+1 respec', got: false, prem: false, current: true },
    { lvl: 20, name: 'Инквизитор', reward: '500 гемов', got: false, prem: true },
    { lvl: 30, name: 'Палач', reward: 'Эмблема для гильдии', got: false, prem: false },
    { lvl: 40, name: 'Чёрный Кардинал', reward: 'Ликтор · Custom voice', got: false, prem: true },
    { lvl: 50, name: 'Tenebræ', reward: '♛ Уникальная корона', got: false, prem: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">✦</span> Season Pass · уровень 15 из 50</div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ position: 'relative', height: 6, background: 'var(--bg-inset)', border: '1px solid var(--metal)', marginBottom: 18 }}>
          <div style={{ width: '30%', height: '100%', background: 'linear-gradient(90deg, var(--blood), var(--ember-bright))' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiers.length}, 1fr)`, gap: 8 }}>
          {tiers.map(t => (
            <div key={t.lvl} style={{
              padding: '10px 6px', textAlign: 'center',
              background: t.current ? 'linear-gradient(180deg, #3a1a08, #1a0804)' : 'var(--bg-inset)',
              border: `1px solid ${t.current ? 'var(--ember-bright)' : t.got ? 'var(--toxic-lit)' : t.prem ? 'var(--rarity-gem)' : 'var(--metal-dark)'}`,
              opacity: t.got ? 0.7 : 1, position: 'relative',
            }}>
              {t.prem && <span style={{ position: 'absolute', top: -1, right: -1, padding: '1px 4px', background: 'var(--rarity-gem)', fontFamily: 'var(--font-code)', fontSize: 7, color: '#0a0404', letterSpacing: '0.1em', fontWeight: 700 }}>★</span>}
              {t.got && <span style={{ position: 'absolute', top: -1, left: -1, padding: '1px 4px', background: 'var(--toxic-lit)', color: '#0a0404', fontSize: 8, fontWeight: 700 }}>✓</span>}
              <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 22, color: t.current ? 'var(--ember-bright)' : t.got ? 'var(--ink-dim)' : 'var(--ink-mid)', lineHeight: 1 }}>{t.lvl}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--ink-mid)', letterSpacing: '0.05em', marginTop: 4, fontWeight: 600, lineHeight: 1.2 }}>{t.name}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: t.prem ? 'var(--rarity-gem)' : 'var(--ember-lit)', letterSpacing: '0.05em', marginTop: 4, lineHeight: 1.3, minHeight: 20 }}>{t.reward}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Leaderboard() {
  const rows = [
    { r: 1, n: 'Rollo the Black', cls: 'Инквизитор', lvl: 47, kills: 12, dead: false },
    { r: 2, n: 'Marina V.', cls: 'Чернокнижник', lvl: 44, kills: 9, dead: false },
    { r: 3, n: 'Alex P.', cls: 'Палач', lvl: 42, kills: 14, dead: false },
    { r: 4, n: '☠ Ivan (мёртв)', cls: 'HC · Архитектор', lvl: 38, kills: 7, dead: true },
    { r: 5, n: 'Nikita D.', cls: 'Инквизитор', lvl: 37, kills: 8, dead: false },
    { r: 247, n: 'А. Волков (ты)', cls: 'Архитектор', lvl: 15, kills: 2, dead: false, you: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">♛</span> Лидборд Tenebræ · 4 812 бойцов</div>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 140px 70px 70px', gap: 0, padding: '6px 14px', background: 'var(--bg-inset)', borderBottom: '1px solid var(--metal)', fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em', fontWeight: 700 }}>
          <div>РАНГ</div><div>БОЕЦ</div><div>КЛАСС</div><div style={{ textAlign: 'right' }}>LVL</div><div style={{ textAlign: 'right' }}>ДРАК.</div>
        </div>
        {rows.map(r => (
          <div key={r.r} style={{
            display: 'grid', gridTemplateColumns: '50px 1fr 140px 70px 70px', gap: 0, padding: '10px 14px',
            borderBottom: '1px solid var(--metal-dark)', alignItems: 'center',
            background: r.you ? 'linear-gradient(90deg, rgba(245,197,107,0.1), transparent)' : 'transparent',
            opacity: r.dead ? 0.5 : 1,
          }}>
            <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 18, color: r.r <= 3 ? 'var(--ember-bright)' : r.you ? 'var(--ember-bright)' : 'var(--ink-mid)' }}>{r.r}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: r.dead ? 'var(--blood-lit)' : r.you ? 'var(--ember-bright)' : 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.03em', textDecoration: r.dead ? 'line-through' : 'none' }}>{r.n}</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-mid)', letterSpacing: '0.1em' }}>{r.cls}</div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--ink-bright)', fontWeight: 700 }}>{r.lvl}</div>
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--blood-bright)', fontWeight: 700 }}>{r.kills}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UniqueRewards() {
  const items = [
    { i: '♛', n: 'Корона Tenebræ', d: 'LVL 50 · косметика профиля', c: 'var(--rarity-unique)' },
    { i: '⬡', n: 'Пепельный Плащ', d: 'LVL 5 · +2 к Ликтор-голосу', c: 'var(--rarity-magic)' },
    { i: '❂', n: 'Чёрный Свиток', d: 'LVL 30 · доступ к Nightmare', c: 'var(--rarity-rare)' },
    { i: '⚔', n: 'Клинок Палача', d: 'HC exclusive · badge', c: 'var(--blood-bright)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">✦</span> Уникальные награды</div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: 10, background: 'var(--bg-inset)', border: `1px solid ${it.c}44`, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 22, color: it.c, width: 26, textAlign: 'center', textShadow: `0 0 8px ${it.c}` }}>{it.i}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: it.c, fontWeight: 700, letterSpacing: '0.05em' }}>{it.n}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.08em', marginTop: 2 }}>{it.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lore() {
  return (
    <div className="panel" style={{ padding: 18, background: 'linear-gradient(180deg, #1a0303 0%, #0a0101 100%)', borderColor: 'var(--blood)' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-bright)', letterSpacing: '0.3em', fontWeight: 700 }}>ЛОР ЛИГИ</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-mid)', lineHeight: 1.6, marginTop: 10, fontStyle: 'italic' }}>
        « Когда Тьма пришла — закрылись триста окон. Старшие ликторы стали по двое. Follow-up стал закон, а вакансия — обещание без клятвы. Братья, мы не ждём света. Мы учимся в темноте. »
      </div>
      <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 18, color: 'var(--blood-lit)', marginTop: 12, textAlign: 'right' }}>— Ordo Nocturnus</div>
    </div>
  );
}

Object.assign(window, { DarkSeasonScreen });
