// Relics — инвентарь в духе PoE. Сетка 8x5, tooltip, фильтры, равиты.
// Предметы = абстрактные бонусы: больше XP, быстрее CD, лучше голос Ликтора.
function RelicsScreen() {
  const [selected, setSelected] = React.useState(5);
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <EquippedSlots />
        <InventoryGrid selected={selected} onSelect={setSelected} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RelicInspector id={selected} />
        <StashTabs />
      </div>
    </div>
  );
}

const RELICS = [
  null,
  { n: 'Пепельный Плащ',      r: 'magic',   i: '⬡', mods: ['+12% XP от мок-боёв', '+1 к голосу в бою'], req: 'LVL 5', flavor: '« Пахнет прахом семи собесов »' },
  { n: 'Кольцо Ясности',      r: 'rare',    i: '◈', mods: ['+18% XP', '−2 сек пауза Ликтора', '+5% шанс follow-up'], req: 'LVL 8', flavor: '« Ясность стоит крови »' },
  { n: 'Маска Безмолвия',     r: 'rare',    i: '☉', mods: ['+25% к спокойствию', 'Блок паники на 30 сек', '−10% громкость Ликтора'], req: 'LVL 12' },
  { n: 'Свиток Raft',         r: 'normal',  i: '❂', mods: ['+1 попытка в дереве Distributed'], req: 'LVL 3' },
  { n: 'Корона Архитектора',  r: 'unique',  i: '♛', mods: ['+50% XP System Design', 'Ликтор обращается «магистр»', '−1 попытка CEX, +3 попытки TECH'], req: 'LVL 24', flavor: '« Носивший её Олег стал CTO Avito. Маска помнит голос. »', unique: true },
  { n: 'Амулет Раны',         r: 'magic',   i: '☠', mods: ['Падения дают +40% XP', 'Кулдаун −3 дня'], req: 'LVL 10' },
  { n: 'Перо Чёрного',        r: 'rare',    i: '◆', mods: ['+2 к голосу', 'Авто-транскрипт', 'Autopsy за 30 мин'], req: 'LVL 15' },
  { n: 'Руна Терпения',       r: 'normal',  i: '◇', mods: ['+5% выдержки follow-up'], req: 'LVL 1' },
  { n: 'Шип Паники',          r: 'magic',   i: '⚡', mods: ['−15% паника', 'Ликтор не перебивает первые 20 сек'], req: 'LVL 6' },
  { n: 'Клинок Палача',       r: 'unique',  i: '⚔', mods: ['HC exclusive', '+100% XP, но одна смерть = Standard', 'Badge в профиле'], req: 'HC only', unique: true },
  { n: 'Горсть Пепла',        r: 'currency',i: '◉', mods: ['Currency · 12 штук'], req: '—', stack: 12 },
  { n: 'Свиток Linearizability', r: 'normal', i: '❂', mods: ['Разблокирует узел 48 мин'], req: 'LVL 14' },
  { n: 'Осколок Зеркала',     r: 'currency',i: '◐', mods: ['Currency · respec 1 points'], req: '—', stack: 3 },
  { n: 'Реликвия Ozon',       r: 'rare',    i: '⬢', mods: ['+30% XP на интервью Ozon', 'Показывает инсайдер-вопросы'], req: 'Убит дракон Ozon' },
  { n: 'Фитиль',              r: 'currency',i: '✦', mods: ['Currency · кулдаун −1 день'], req: '—', stack: 7 },
];

function rarityColor(r) {
  return {
    normal:   'var(--metal-lit)',
    magic:    'var(--rarity-magic)',
    rare:     'var(--rarity-rare)',
    unique:   'var(--rarity-unique)',
    currency: 'var(--rarity-gem)',
  }[r] || 'var(--metal-lit)';
}

function EquippedSlots() {
  const slots = [
    { k: 'helm',   t: 'Шлем',     i: 5,    pos: 'С' },  // corona
    { k: 'cloak',  t: 'Плащ',     i: 1 },
    { k: 'chest',  t: 'Броня',    i: null },
    { k: 'ring1',  t: 'Кольцо I', i: 2 },
    { k: 'ring2',  t: 'Кольцо II', i: null },
    { k: 'amulet', t: 'Амулет',   i: 6 },
    { k: 'weapon', t: 'Оружие',   i: null },
    { k: 'tome',   t: 'Том',      i: 7 },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">♛</span> Экипировка · 4 из 8 слотов</div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
        {slots.map(s => {
          const rel = s.i != null ? RELICS[s.i] : null;
          const c = rel ? rarityColor(rel.r) : 'var(--metal-dark)';
          return (
            <div key={s.k} style={{ textAlign: 'center' }}>
              <div style={{
                aspectRatio: '1', background: rel ? `radial-gradient(circle, ${c}22, #0a0404)` : 'var(--bg-inset)',
                border: `1px solid ${c}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, color: c, position: 'relative',
                boxShadow: rel ? `inset 0 0 12px ${c}44` : 'inset 0 1px 2px rgba(0,0,0,0.8)',
              }}>{rel ? rel.i : <span style={{ color: 'var(--ink-dim)', fontSize: 10, letterSpacing: '0.15em' }}>—</span>}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.15em', marginTop: 4, fontWeight: 700 }}>{s.t.toUpperCase()}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InventoryGrid({ selected, onSelect }) {
  const COLS = 10, ROWS = 5;
  const cells = Array(COLS * ROWS).fill(null);
  // Place relics at fixed positions
  const placements = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  placements.forEach((id, idx) => {
    const r = Math.floor(idx / COLS);
    const c = idx % COLS;
    cells[r * COLS + c] = id;
  });

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><span className="ornament">◈</span> Сундук · 15 из 50</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {['ВСЕ', 'UNIQUE', 'RARE', 'CURRENCY'].map((f, i) => (
            <span key={f} style={{ padding: '3px 10px', fontFamily: 'var(--font-code)', fontSize: 9, letterSpacing: '0.2em', fontWeight: 700,
              background: i === 0 ? 'linear-gradient(180deg, #3a1a08, #1a0804)' : 'var(--bg-inset)',
              border: `1px solid ${i === 0 ? 'var(--ember)' : 'var(--metal-dark)'}`,
              color: i === 0 ? 'var(--ember-bright)' : 'var(--ink-dim)', cursor: 'pointer' }}>{f}</span>
          ))}
        </div>
      </div>
      <div style={{ padding: 14, background: 'repeating-linear-gradient(90deg, transparent 0, transparent 59px, rgba(122,90,60,0.1) 59px, rgba(122,90,60,0.1) 60px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4 }}>
          {cells.map((id, idx) => {
            const rel = id != null ? RELICS[id] : null;
            const c = rel ? rarityColor(rel.r) : 'var(--metal-dark)';
            const sel = id === selected;
            return (
              <button key={idx} onClick={() => rel && onSelect(id)} disabled={!rel} style={{
                aspectRatio: '1', position: 'relative',
                background: rel ? `linear-gradient(135deg, ${c}15, #0a0404)` : 'var(--bg-inset)',
                border: `1px solid ${sel ? 'var(--ember-bright)' : c}${rel ? '' : '66'}`,
                boxShadow: sel ? `0 0 0 1px var(--ember-bright), inset 0 0 12px ${c}55` : rel ? `inset 0 0 8px ${c}33` : 'inset 0 1px 2px rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, color: c, cursor: rel ? 'pointer' : 'default', padding: 0,
              }}>
                {rel && rel.i}
                {rel && rel.stack && (
                  <span style={{ position: 'absolute', bottom: 2, right: 3, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-bright)', fontWeight: 700, textShadow: '0 1px 2px #000' }}>{rel.stack}</span>
                )}
                {rel && rel.unique && !rel.stack && (
                  <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 7, color: 'var(--rarity-unique)', fontWeight: 700 }}>★</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RelicInspector({ id }) {
  const rel = RELICS[id];
  if (!rel) return <div className="panel" style={{ padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-dim)', fontStyle: 'italic' }}>Выбери реликвию</div>;
  const c = rarityColor(rel.r);
  return (
    <div className="panel" style={{ padding: 0, borderColor: c, boxShadow: `0 0 20px ${c}33` }}>
      <div style={{ padding: '14px 18px 16px', background: `linear-gradient(180deg, ${c}15, transparent)` }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: c, letterSpacing: '0.3em', fontWeight: 700 }}>{rel.r.toUpperCase()}</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 32, color: 'var(--ink-bright)', lineHeight: 1.1, marginTop: 4, textShadow: `0 0 16px ${c}44` }}>{rel.n}</div>
      </div>
      <div style={{ padding: '0 18px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderTop: '1px solid var(--metal-dark)', borderBottom: '1px solid var(--metal-dark)' }}>
          <div style={{ width: 70, height: 70, background: `radial-gradient(circle, ${c}33, #0a0404)`, border: `1px solid ${c}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, color: c, boxShadow: `inset 0 0 16px ${c}55` }}>{rel.i}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>ТРЕБУЕТ</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 600, marginTop: 2 }}>{rel.req}</div>
          </div>
        </div>

        <div style={{ padding: '14px 0' }}>
          {rel.mods.map((m, i) => (
            <div key={i} style={{
              fontFamily: 'var(--font-body)', fontSize: 13, color: c,
              lineHeight: 1.55, marginBottom: 4, fontWeight: 500,
            }}>{m}</div>
          ))}
        </div>

        {rel.flavor && (
          <div style={{ padding: '10px 0', borderTop: '1px solid var(--metal-dark)', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-dim)', fontStyle: 'italic', lineHeight: 1.5 }}>{rel.flavor}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-blood" style={{ flex: 1, padding: '8px 0', fontSize: 10 }}>✚ НАДЕТЬ</button>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10 }}>◈</button>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10, color: 'var(--blood-lit)', borderColor: 'var(--blood-dark, #3a0909)' }}>✕</button>
        </div>
      </div>
    </div>
  );
}

function StashTabs() {
  const tabs = [
    { n: 'Главный сундук', c: 15, cap: 50, active: true },
    { n: 'Валюта', c: 22, cap: 100 },
    { n: 'Свитки', c: 12, cap: 30 },
    { n: 'Tenebræ · сезон', c: 4, cap: 20, season: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⬢</span> Склад</div>
      <div>
        {tabs.map((t, i) => (
          <div key={t.n} style={{
            padding: '10px 14px', borderBottom: i < tabs.length - 1 ? '1px solid var(--metal-dark)' : 'none',
            background: t.active ? 'linear-gradient(90deg, rgba(245,197,107,0.1), transparent)' : 'transparent',
            borderLeft: t.active ? '2px solid var(--ember-bright)' : '2px solid transparent',
            display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10, cursor: 'pointer',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: t.active ? 'var(--ember-bright)' : 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.05em' }}>
                {t.season && <span style={{ color: 'var(--blood-bright)', marginRight: 6 }}>⚡</span>}{t.n}
              </div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 2 }}>{t.c} / {t.cap}</div>
            </div>
            <div style={{ width: 60, height: 4, background: 'var(--bg-inset)' }}>
              <div style={{ width: `${(t.c/t.cap)*100}%`, height: '100%', background: t.c/t.cap > 0.8 ? 'var(--blood-lit)' : 'var(--ember-lit)' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--metal-dark)' }}>
        <button className="btn btn-ghost" style={{ width: '100%', padding: '8px 0', fontSize: 10, color: 'var(--rarity-gem)', borderColor: 'var(--rarity-gem)' }}>+ КУПИТЬ ВКЛАДКУ · 200 ГЕМОВ</button>
      </div>
    </div>
  );
}

Object.assign(window, { RelicsScreen });
