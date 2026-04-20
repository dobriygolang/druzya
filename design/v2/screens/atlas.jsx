// Company Atlas — карта компаний как боссы в PoE-атласе.
// Узлы-компании с уровнем сложности, модификаторами, наградами.
// Связи = цепочки "если прошёл X, открывается Y".
function AtlasScreen() {
  const [sel, setSel] = React.useState('ozon');
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AtlasIntro />
        <AtlasMap selected={sel} onSelect={setSel} />
        <AtlasLegend />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <BossCard id={sel} />
        <WarCry />
      </div>
    </div>
  );
}

function AtlasIntro() {
  return (
    <div style={{ padding: '14px 18px', background: 'linear-gradient(90deg, #14080a 0%, #0a0605 100%)', border: '1px solid var(--metal)', borderLeft: '3px solid var(--blood-lit)' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-bright)', letterSpacing: '0.3em', fontWeight: 700 }}>АТЛАС КОМПАНИЙ · КАРТА ДРАКОНОВ</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-mid)', marginTop: 6, lineHeight: 1.5 }}>
        47 компаний. Каждая — босс со своим темпераментом, follow-up-паттерном, любимыми вопросами. Убитый дракон открывает соседние узлы и даёт инсайдер-реликвию.
      </div>
    </div>
  );
}

const COMPANIES = {
  ozon: { name: 'Ozon', tier: 'T3', diff: 3, killed: true, pos: [280, 200], color: 'var(--ember-bright)',
    mods: ['+follow-up × 2', 'System Design = 45 мин', 'Live coding на собесе'],
    rounds: ['HR · скрин', 'Tech · coding 2ч', 'System Design · 45 мин', 'Team · culture fit'],
    salary: '380–520к', killDate: '12 окт 2024', boss: 'Архитектура заказа · 50M RPS',
    flavor: '« Спрашивают про consistency в распределённых платежах. Готовиться к саге, outbox, idempotency. »' },
  yandex: { name: 'Яндекс', tier: 'T4', diff: 4, killed: false, pos: [180, 280], color: 'var(--blood-bright)',
    mods: ['Алгоритмы сложные', '3 раунда tech', 'Хитрые follow-up'],
    rounds: ['Скрин · coding', 'Tech-1 · алгоритмы', 'Tech-2 · ML/sys', 'Design', 'Team'],
    salary: '350–600к', lastTry: 'Поражение · 3 фев',
    flavor: '« Дракон с длинной шеей. Убил тебя follow-up-ом по CAP. Вернись через 14 дней. »' },
  vk: { name: 'VK', tier: 'T3', diff: 3, killed: false, pos: [360, 140], color: 'var(--rarity-magic)',
    mods: ['Python-ориентация', 'Backend тяжёлый', 'Вопросы по Django под капотом'],
    rounds: ['HR', 'Tech coding', 'System · 45 мин', 'Lead-взгляд'],
    salary: '320–480к', scheduled: '2 часа назад',
    flavor: '« Проходит сейчас. Ликтор: Nikhil K. Смотрел autopsy — были промахи. »' },
  tinkoff: { name: 'Т-Банк', tier: 'T4', diff: 4, killed: true, pos: [470, 230], color: 'var(--toxic-lit)',
    mods: ['Kotlin/JVM', 'Fintech-специфика', 'Жёсткий bar'],
    rounds: ['HR', 'Coding 1 · lc-medium', 'Coding 2 · lc-hard', 'Design', 'Lead', 'Final'],
    salary: '400–700к', killDate: '4 авг 2024', boss: 'Платёжный свитч · ACID и deadlock',
    flavor: '« Убитый. Дают подарок: инсайдер-вопросы из pool. Все реликвии T-Банка +30% XP. »' },
  avito: { name: 'Avito', tier: 'T2', diff: 2, killed: true, pos: [560, 320], color: 'var(--ember-bright)',
    mods: ['Go-стек', 'Разумные follow-up', 'Быстрый процесс'],
    rounds: ['Скрин', 'Tech · 2ч', 'System', 'Team'],
    salary: '280–420к', killDate: '14 мая 2024',
    flavor: '« Первый убитый. Помнишь как тряслись руки? Теперь T2 для тебя — разминка. »' },
  sber: { name: 'СберТех', tier: 'T5', diff: 5, killed: false, pos: [640, 180], color: 'var(--blood-bright)',
    mods: ['★ BOSS ЛИГИ', '5 раундов', 'Security clearance', 'Следствие по коду'],
    rounds: ['HR', 'Tech-1', 'Tech-2', 'System', 'Architecture', 'Team', 'Final'],
    salary: '500–900к',
    flavor: '« Пятиголовый. Никто из гильдии его не убил. Открывается только после 3 убитых T4. »', locked: true },
  wildberries: { name: 'WB', tier: 'T3', diff: 3, killed: false, pos: [440, 410], color: 'var(--ink-mid)',
    mods: ['Хаотичный процесс', 'Неочевидные вопросы', 'Долгие паузы'],
    rounds: ['Скрин', 'Coding', 'Design', 'Team', 'Final'],
    salary: '300–550к',
    flavor: '« Непредсказуемый. Могут спросить и про LSM-дерево, и про то, как ты пишешь ТЗ коллеге. »' },
  jetbrains: { name: 'JetBrains', tier: 'T4', diff: 4, killed: false, pos: [750, 260], color: 'var(--rarity-gem)',
    mods: ['Амстердам-SPB', 'IDE internals', 'Вопросы по компиляторам'],
    rounds: ['Take-home', 'Tech · 2ч', 'Architecture', 'Team', 'CTO final'],
    salary: '€80–120k',
    flavor: '« Элитный дракон. Требует глубины. Не ходить без прокачанного дерева PL. »' },
  kaspersky: { name: 'Касперский', tier: 'T3', diff: 3, killed: false, pos: [220, 420], color: 'var(--toxic-lit)',
    mods: ['C++ тяжёлый', 'Security-уклон', 'NDA с первого раунда'],
    rounds: ['Скрин', 'Tech', 'Security-design', 'Team'],
    salary: '340–480к',
    flavor: '« Яд вместо огня. Спрашивают про memory safety, UB, sanitizers. »' },
  alfa: { name: 'Альфа', tier: 'T3', diff: 3, killed: false, pos: [380, 500], color: 'var(--ember-bright)',
    mods: ['Быстрый процесс · 7 дней', 'System Design × 2'],
    rounds: ['HR', 'Tech', 'Design-1', 'Design-2', 'Team'],
    salary: '360–550к', scheduled: '6 марта',
    flavor: '« Следующий в очереди. Ликтор уже прописал подготовку по узлам Raft и Linearizability. »' },
};

const EDGES = [
  ['avito', 'ozon'],
  ['avito', 'wildberries'],
  ['ozon', 'tinkoff'],
  ['ozon', 'vk'],
  ['tinkoff', 'sber'],
  ['vk', 'yandex'],
  ['yandex', 'jetbrains'],
  ['wildberries', 'alfa'],
  ['avito', 'kaspersky'],
  ['tinkoff', 'jetbrains'],
];

function AtlasMap({ selected, onSelect }) {
  const W = 880, H = 560;
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><span className="ornament">⟐</span> Атлас · 4 убиты · 43 живы</span>
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>TIER 1 → TIER 5</span>
      </div>
      <div style={{ position: 'relative', background: 'radial-gradient(ellipse at 50% 50%, #14100a 0%, #0a0605 60%, #050302 100%)', overflow: 'hidden' }}>
        {/* Grid pattern */}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
          <defs>
            <pattern id="atlas-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(122,90,60,0.12)" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="atlas-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#c22222" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#c22222" stopOpacity="0" />
            </radialGradient>
            <filter id="atlas-node-glow"><feGaussianBlur stdDeviation="4" /></filter>
          </defs>
          <rect width={W} height={H} fill="url(#atlas-grid)" />
          <ellipse cx={W/2} cy={H/2} rx={W/3} ry={H/3} fill="url(#atlas-glow)" />

          {/* Edges */}
          {EDGES.map(([a, b], i) => {
            const A = COMPANIES[a], B = COMPANIES[b];
            if (!A || !B) return null;
            const bothKilled = A.killed && B.killed;
            const locked = B.locked || A.locked;
            return (
              <line key={i} x1={A.pos[0]} y1={A.pos[1]} x2={B.pos[0]} y2={B.pos[1]}
                stroke={locked ? '#2a1008' : bothKilled ? 'var(--ember-lit)' : 'var(--metal)'}
                strokeWidth={bothKilled ? 2 : 1}
                strokeDasharray={locked ? '4 4' : 'none'}
                opacity={locked ? 0.4 : 0.6} />
            );
          })}

          {/* Nodes */}
          {Object.entries(COMPANIES).map(([k, c]) => {
            const sel = k === selected;
            const r = 18 + c.diff * 3;
            return (
              <g key={k} onClick={() => onSelect(k)} style={{ cursor: 'pointer' }}>
                {sel && <circle cx={c.pos[0]} cy={c.pos[1]} r={r + 10} fill="none" stroke="var(--ember-bright)" strokeWidth="1" opacity="0.6" />}
                {c.killed && <circle cx={c.pos[0]} cy={c.pos[1]} r={r + 4} fill="none" stroke="var(--ember-lit)" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />}
                <circle cx={c.pos[0]} cy={c.pos[1]} r={r + 6} fill={c.color} opacity={c.killed ? 0.08 : 0.12} filter="url(#atlas-node-glow)" />
                <polygon
                  points={hexPoints(c.pos[0], c.pos[1], r)}
                  fill={c.locked ? '#14080a' : c.killed ? '#1a0808' : '#0a0605'}
                  stroke={c.locked ? 'var(--metal-dark)' : c.color}
                  strokeWidth={sel ? 2 : 1.5} />
                {c.killed && (
                  <text x={c.pos[0]} y={c.pos[1] + 4} textAnchor="middle" fontFamily="serif" fontSize="16" fill="var(--blood-bright)" fontWeight="700">☠</text>
                )}
                {c.locked && (
                  <text x={c.pos[0]} y={c.pos[1] + 4} textAnchor="middle" fontFamily="serif" fontSize="14" fill="var(--metal-lit)">⊘</text>
                )}
                {!c.killed && !c.locked && (
                  <text x={c.pos[0]} y={c.pos[1] + 5} textAnchor="middle" fontFamily="var(--font-blackletter)" fontSize="16" fill={c.color}>{c.tier}</text>
                )}
                <text x={c.pos[0]} y={c.pos[1] + r + 16} textAnchor="middle" fontFamily="var(--font-display)" fontSize="11" fill={sel ? 'var(--ember-bright)' : 'var(--ink-bright)'} fontWeight="700" letterSpacing="0.05em">{c.name}</text>
                {c.scheduled && (
                  <text x={c.pos[0]} y={c.pos[1] + r + 30} textAnchor="middle" fontFamily="var(--font-code)" fontSize="8" fill="var(--ember-lit)" letterSpacing="0.15em">◆ {c.scheduled}</text>
                )}
              </g>
            );
          })}

          {/* Region labels */}
          <text x="80" y="40" fontFamily="var(--font-blackletter)" fontSize="22" fill="var(--ink-dim)" opacity="0.5">Восток · ecom</text>
          <text x="580" y="40" fontFamily="var(--font-blackletter)" fontSize="22" fill="var(--ink-dim)" opacity="0.5">Север · fintech</text>
          <text x="100" y="540" fontFamily="var(--font-blackletter)" fontSize="22" fill="var(--ink-dim)" opacity="0.5">Юг · security</text>
          <text x="580" y="540" fontFamily="var(--font-blackletter)" fontSize="22" fill="var(--ink-dim)" opacity="0.5">Запад · relo</text>
        </svg>
      </div>
    </div>
  );
}

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

function AtlasLegend() {
  const L = [
    { i: '☠', t: 'Убит', c: 'var(--ember-lit)' },
    { i: '◆', t: 'Назначен бой', c: 'var(--ember-bright)' },
    { i: '⊘', t: 'Заперт', c: 'var(--metal-lit)' },
    { i: 'T1', t: 'Джун-лайт', c: 'var(--ink-mid)' },
    { i: 'T3', t: 'Middle-Senior', c: 'var(--rarity-magic)' },
    { i: 'T5', t: '★ Босс лиги', c: 'var(--blood-bright)' },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }}>
      {L.map(l => (
        <span key={l.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: l.c, fontFamily: 'var(--font-blackletter)', fontSize: 14, minWidth: 18, textAlign: 'center' }}>{l.i}</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-mid)', letterSpacing: '0.15em' }}>{l.t.toUpperCase()}</span>
        </span>
      ))}
    </div>
  );
}

function BossCard({ id }) {
  const c = COMPANIES[id];
  if (!c) return null;
  return (
    <div className="panel" style={{ padding: 0, borderColor: c.color, boxShadow: `0 0 20px ${c.color}22` }}>
      <div style={{ padding: '16px 18px', background: `linear-gradient(180deg, ${c.color}18, transparent)`, borderBottom: '1px solid var(--metal)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: c.color, letterSpacing: '0.3em', fontWeight: 700 }}>TIER {c.tier.replace('T','')} · СЛОЖНОСТЬ {'◆'.repeat(c.diff)}</div>
          {c.killed && <span style={{ padding: '2px 8px', background: 'var(--ember-lit)22', border: '1px solid var(--ember-lit)', fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ember-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>УБИТ</span>}
          {c.locked && <span style={{ padding: '2px 8px', background: 'var(--metal-dark)', fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.25em', fontWeight: 700 }}>ЗАПЕРТ</span>}
          {c.scheduled && <span style={{ padding: '2px 8px', background: 'var(--ember)22', border: '1px solid var(--ember-bright)', fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ember-bright)', letterSpacing: '0.25em', fontWeight: 700 }}>НАЗНАЧЕН</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 44, color: 'var(--ink-bright)', lineHeight: 1.1, marginTop: 6, textShadow: `0 0 16px ${c.color}44` }}>{c.name}</div>
        {c.boss && <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-mid)', fontStyle: 'italic', marginTop: 4, letterSpacing: '0.06em' }}>«{c.boss}»</div>}
      </div>

      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--metal-dark)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.25em', fontWeight: 700 }}>МОДИФИКАТОРЫ</div>
        <div style={{ marginTop: 6 }}>
          {c.mods.map((m, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: c.color, marginTop: 3 }}>{m}</div>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--metal-dark)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.25em', fontWeight: 700 }}>РАУНДЫ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {c.rounds.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em', fontWeight: 700 }}>0{i+1}</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-bright)' }}>{r}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderBottom: '1px solid var(--metal-dark)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em', fontWeight: 700 }}>ЗАРПЛАТА</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ember-bright)', fontWeight: 700, letterSpacing: '0.03em', marginTop: 2 }}>{c.salary}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em', fontWeight: 700 }}>
            {c.killed ? 'УБИТ' : c.lastTry ? 'ПОСЛЕДНИЙ БОЙ' : c.scheduled ? 'БОЙ ЧЕРЕЗ' : 'СТАТУС'}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: c.killed ? 'var(--ember-lit)' : c.lastTry ? 'var(--blood-lit)' : 'var(--ink-bright)', fontWeight: 600, marginTop: 2, letterSpacing: '0.05em' }}>
            {c.killDate || c.lastTry || c.scheduled || (c.locked ? 'Заперт' : 'Не трогал')}
          </div>
        </div>
      </div>

      {c.flavor && (
        <div style={{ padding: '12px 18px', background: 'var(--bg-inset)', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', fontStyle: 'italic', lineHeight: 1.5, borderBottom: '1px solid var(--metal-dark)' }}>{c.flavor}</div>
      )}

      <div style={{ padding: 12, display: 'flex', gap: 6 }}>
        {c.locked ? (
          <button className="btn btn-ghost" disabled style={{ flex: 1, padding: '10px 0', fontSize: 10, opacity: 0.5 }}>⊘ УБЕЙ 3 × T4</button>
        ) : c.killed ? (
          <>
            <button className="btn btn-ghost" style={{ flex: 1, padding: '10px 0', fontSize: 10 }}>◈ ПОВТОРИТЬ</button>
            <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 10, color: 'var(--rarity-rare)', borderColor: 'var(--rarity-rare)' }}>❂ РЕЛИКВИЯ</button>
          </>
        ) : (
          <>
            <button className="btn btn-blood" style={{ flex: 1, padding: '10px 0', fontSize: 10 }}>⚔ НАЗНАЧИТЬ БОЙ</button>
            <button className="btn btn-ghost" style={{ padding: '10px 12px', fontSize: 10 }}>◈ ПОДГОТОВИТЬСЯ</button>
          </>
        )}
      </div>
    </div>
  );
}

function WarCry() {
  return (
    <div style={{ padding: 16, background: 'linear-gradient(180deg, #1a0303, #0a0101)', border: '1px solid var(--blood)' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-bright)', letterSpacing: '0.3em', fontWeight: 700 }}>ЛИКТОР СКАЗАЛ</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.6, marginTop: 8, fontStyle: 'italic' }}>
        « Атлас не место для коллекции. Это карта планирования. Бери дракона по силе — не по престижу. Ozon убит, VK сейчас в бою, Альфа 6 марта. Больше двух в неделю — сгоришь. »
      </div>
    </div>
  );
}

Object.assign(window, { AtlasScreen });
