// Codex — обучающая библиотека. Grimdark card catalog: podcasts, courses, scrolls, AI recs by weak nodes.
function CodexScreen() {
  const [cat, setCat] = React.useState('all');
  return (
    <div style={{ padding: '18px 20px 120px' }}>
      <CodexHero />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 300px', gap: 14, marginTop: 14 }}>
        <LeftCodex cat={cat} setCat={setCat} />
        <CenterCodex cat={cat} />
        <RightCodex />
      </div>
    </div>
  );
}

function CodexHero() {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(180deg, #14100f 0%, #0a0605 100%)',
      border: '1px solid var(--metal-lit)',
      padding: '18px 24px',
      display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 20, alignItems: 'center',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `
        radial-gradient(ellipse at 80% 50%, rgba(224,155,58,0.1), transparent 50%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.01) 0 1px, transparent 1px 6px)
      ` }} />
      <svg viewBox="0 0 80 80" style={{ width: 80, height: 80, position: 'relative' }}>
        <defs>
          <radialGradient id="tomeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e09b3a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#e09b3a" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="40" cy="40" r="38" fill="url(#tomeGlow)" />
        {/* Open book */}
        <path d="M8 26 L40 32 L72 26 L72 62 L40 68 L8 62 Z" fill="#1a1008" stroke="#8a7258" strokeWidth="1.5" />
        <line x1="40" y1="32" x2="40" y2="68" stroke="#3a2a1a" strokeWidth="1" />
        {/* Text lines */}
        {[38, 44, 50, 56].map((y, i) => (
          <g key={i}>
            <line x1="14" y1={y} x2="36" y2={y + i * 0.6} stroke="#6d5a45" strokeWidth="0.8" />
            <line x1="44" y1={y + i * 0.6} x2="66" y2={y} stroke="#6d5a45" strokeWidth="0.8" />
          </g>
        ))}
        {/* Glowing rune */}
        <text x="40" y="44" textAnchor="middle" fontFamily="var(--font-blackletter)" fontSize="10" fill="#f5c56b" fontWeight="700">IX</text>
      </svg>
      <div style={{ position: 'relative', minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>
          БИБЛИОТЕКА СВИТКОВ · 847 ЗАПИСЕЙ
        </div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 40, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 4, textShadow: '0 0 14px rgba(224,155,58,0.4)' }}>
          Codex·IX
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ember-lit)', letterSpacing: '0.16em', marginTop: 4, fontStyle: 'italic', fontWeight: 500 }}>
          « Каждый свиток — зажимает одну слабость »
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, alignItems: 'stretch', minWidth: 280 }}>
        <div className="inset-groove" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--ink-dim)', fontSize: 13 }}>⚲</span>
          <input placeholder="Искать свиток, кодекс, подкаст…"
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--ink-bright)', fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none' }} />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>⌘K</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="inset-groove" style={{ flex: 1, padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ПРОЧИТАНО</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ember-lit)', fontWeight: 700 }}>142</div>
          </div>
          <div className="inset-groove" style={{ flex: 1, padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>В СПИСКЕ</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--rarity-gem)', fontWeight: 700 }}>7</div>
          </div>
          <div className="inset-groove" style={{ flex: 1, padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ЧАСОВ</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink-bright)', fontWeight: 700 }}>94</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------- LEFT: categories -------------
function LeftCodex({ cat, setCat }) {
  const cats = [
    { k: 'all',  ru: 'ВСЁ',              i: '◈', n: 847 },
    { k: 'pod',  ru: 'Подкасты',         i: '◉', n: 234 },
    { k: 'scr',  ru: 'Свитки',           i: '✦', n: 186 },
    { k: 'cou',  ru: 'Курсы',            i: '☰', n: 42 },
    { k: 'bk',   ru: 'Фолианты',         i: '❏', n: 128 },
    { k: 'vid',  ru: 'Хроники',          i: '▶', n: 312 },
  ];
  const secs = [
    { c: '#6a9fd4', ru: 'Алгоритмы',    n: 84 },
    { c: '#639922', ru: 'SQL · DB',      n: 56 },
    { c: '#EF9F27', ru: 'Backend',       n: 112 },
    { c: '#7F77DD', ru: 'Sys Design',    n: 68 },
    { c: '#1D9E75', ru: 'Behavioral',    n: 34 },
    { c: '#c22222', ru: 'AI · LLM',      n: 47 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">◈</span> Типы</div>
        <div style={{ padding: '6px 0' }}>
          {cats.map(c => {
            const active = c.k === cat;
            return (
              <button key={c.k} onClick={() => setCat(c.k)} style={{
                width: '100%', textAlign: 'left', padding: '8px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
                background: active ? 'linear-gradient(90deg, rgba(138,20,20,0.18), transparent)' : 'transparent',
                borderLeft: active ? '2px solid var(--blood-lit)' : '2px solid transparent',
                color: active ? 'var(--ember-bright)' : 'var(--ink-mid)',
                fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.08em', fontWeight: 600,
              }}>
                <span style={{ fontSize: 14, width: 16 }}>{c.i}</span>
                <span style={{ flex: 1 }}>{c.ru}</span>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: active ? 'var(--ember-lit)' : 'var(--ink-dim)' }}>{c.n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">☉</span> Секции</div>
        <div style={{ padding: '6px 0' }}>
          {secs.map(s => (
            <button key={s.ru} style={{
              width: '100%', textAlign: 'left', padding: '7px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              borderLeft: `3px solid ${s.c}`,
              background: 'transparent',
            }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)' }}>{s.ru}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: s.c, fontWeight: 700 }}>{s.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ padding: 14, borderColor: 'var(--blood)', background: 'linear-gradient(180deg, #1a0908, #0a0605)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>⚠ ДЕФИЦИТНАЯ ЗОНА</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ink-bright)', fontWeight: 700, marginTop: 4, letterSpacing: '0.04em' }}>Consistency · CAP</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', lineHeight: 1.5, marginTop: 4 }}>
          Ликтор отметил узел как слабый в 3 последних мок-боях. Кодекс приготовил 4 свитка.
        </div>
        <button className="btn btn-blood" style={{ marginTop: 10, width: '100%', padding: '8px 0', fontSize: 10 }}>→ ПРИНЯТЬ ПРЕДПИСАНИЕ</button>
      </div>
    </div>
  );
}

// ------------- CENTER: featured + grid -------------
function CenterCodex({ cat }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <FeaturedPodcast />
      <ScrollGrid />
      <CoursePath />
    </div>
  );
}

function FeaturedPodcast() {
  return (
    <div className="panel" style={{ padding: 0, borderColor: 'var(--ember)' }}>
      <div className="panel-head" style={{ background: 'linear-gradient(90deg, rgba(224,155,58,0.12), transparent)' }}>
        <span className="ornament" style={{ color: 'var(--ember-bright)' }}>◉</span> Подкаст Дня · Ликтор рекомендует
      </div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr) 140px', gap: 14, alignItems: 'center' }}>
        <div style={{ width: 88, height: 88, position: 'relative' }}>
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #3a1f08 0%, #14100f 60%, #1a0908 100%)',
            border: '1px solid var(--ember)',
            boxShadow: '0 0 14px rgba(224,155,58,0.25), inset 0 0 20px rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 30% 20%, rgba(224,155,58,0.2), transparent 50%)` }} />
            <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 34, color: 'var(--ember-bright)', textShadow: '0 0 10px rgba(224,155,58,0.6)' }}>CAP</div>
            {/* Equalizer */}
            <div style={{ position: 'absolute', bottom: 6, left: 8, right: 8, display: 'flex', gap: 1, alignItems: 'end', height: 10 }}>
              {[8, 12, 6, 14, 10, 5, 11, 13, 7, 9, 12, 5, 10, 8, 13].map((h, i) => (
                <div key={i} style={{ flex: 1, height: h, background: 'var(--ember-lit)', opacity: 0.7, animation: `pulse ${1 + (i % 5) * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ padding: '2px 8px', fontFamily: 'var(--font-code)', fontSize: 8, color: '#7F77DD', letterSpacing: '0.2em', background: 'rgba(127,119,221,0.12)', border: '1px solid #7F77DD', fontWeight: 700 }}>SYS DESIGN</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--rarity-rare)', letterSpacing: '0.2em' }}>★★★★★ · 847</span>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.04em', textWrap: 'pretty' }}>
            Теорема CAP, когда она врёт
          </div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-mid)', letterSpacing: '0.1em', marginTop: 2 }}>
            Мартин Клеппман · 48 мин · Свиток SYSD-047
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
            « В реальности нет P-партишенов. Но когда они приходят — CAP решает не архитектор, а человек с пейджером в 3 часа ночи. »
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)' }}>⚡ +180 XP</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--rarity-gem)' }}>🜚 узел Consistency</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)' }}>42 из гильдии прослушали</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', flexShrink: 0 }}>
          <button className="btn btn-ember" style={{ padding: '12px 14px', fontSize: 12, fontWeight: 800, letterSpacing: '0.15em' }}>▶ СЛУШАТЬ</button>
          <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 9 }}>+ в список</button>
          <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 9 }}>◆ Транскрипт</button>
        </div>
      </div>
      {/* Progress bar of playback */}
      <div style={{ padding: '0 18px 14px' }}>
        <div style={{ height: 3, background: 'var(--bg-inset)', position: 'relative' }}>
          <div style={{ width: '34%', height: '100%', background: 'var(--ember-lit)', boxShadow: '0 0 6px var(--ember-lit)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>
          <span>16:22 · BASE CASE</span>
          <span>прослушано 34% · осталось 31:38</span>
        </div>
      </div>
    </div>
  );
}

function ScrollGrid() {
  const scrolls = [
    { t: 'Two Pointers — танец без оружия', a: 'Цезарь Лукшин', d: '24 мин', r: 'R', sec: 'АЛГОРИТМЫ', c: '#6a9fd4', xp: 60, unique: false, progress: 100, kind: 'pod' },
    { t: 'Индексы B-tree vs Hash', a: 'root_priest', d: '12 мин', r: 'M', sec: 'SQL', c: '#639922', xp: 40, progress: 0, kind: 'scr' },
    { t: 'Event Sourcing для смертных', a: 'Анатолий Востр.', d: '38 мин', r: 'U', sec: 'SYS DESIGN', c: '#7F77DD', xp: 120, unique: true, progress: 14, kind: 'pod' },
    { t: 'Goroutine leaks — отладка', a: 'BitReaper', d: '28 стр', r: 'M', sec: 'BACKEND', c: '#EF9F27', xp: 50, progress: 0, kind: 'scr' },
    { t: 'STAR, который не пахнет', a: 'Дарья Ковалёва', d: '16 мин', r: 'N', sec: 'BEHAVIORAL', c: '#1D9E75', xp: 30, progress: 100, kind: 'pod' },
    { t: 'Transformer в 200 строк', a: 'А.Карпатый', d: '1ч 32м', r: 'U', sec: 'AI · LLM', c: '#c22222', xp: 200, unique: true, progress: 62, kind: 'vid' },
    { t: 'Consistent Hashing на пальцах', a: 'Нихил', d: '8 мин', r: 'R', sec: 'SYS DESIGN', c: '#7F77DD', xp: 80, progress: 0, kind: 'scr' },
    { t: 'Окна и рамки: SQL OVER()', a: 'queen_query', d: '22 мин', r: 'R', sec: 'SQL', c: '#639922', xp: 70, progress: 0, kind: 'pod' },
    { t: 'Dynamic Programming · мантры', a: 'Нихил', d: '54 мин', r: 'M', sec: 'АЛГОРИТМЫ', c: '#6a9fd4', xp: 90, progress: 38, kind: 'cou' },
  ];
  const rarityColor = { N: 'var(--rarity-normal)', M: 'var(--rarity-magic)', R: 'var(--rarity-rare)', U: 'var(--rarity-unique)' };
  const rarityLabel = { N: 'ОБЫЧНЫЙ', M: 'МАГИЧЕСКИЙ', R: 'РЕДКИЙ', U: 'УНИКАЛЬНЫЙ' };
  const kindIcon = { pod: '◉', scr: '✦', vid: '▶', cou: '☰', bk: '❏' };

  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">❏</span> Полка Свитков
        <div className="grow" />
        <div style={{ display: 'flex', gap: 0 }}>
          {['ВСЕ', 'НОВЫЕ', 'В СПИСКЕ', 'ПРОЙДЕНО'].map((t, i) => (
            <button key={t} style={{
              padding: '3px 10px', fontFamily: 'var(--font-code)', fontSize: 9,
              letterSpacing: '0.2em', fontWeight: 700,
              color: i === 0 ? 'var(--ember-bright)' : 'var(--ink-dim)',
              borderBottom: i === 0 ? '1px solid var(--ember-lit)' : '1px solid transparent',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {scrolls.map((s, i) => (
          <div key={i} style={{
            position: 'relative', padding: 10,
            background: 'linear-gradient(180deg, #14100f, #0a0706)',
            border: `1px solid ${rarityColor[s.r]}44`,
            boxShadow: s.unique ? '0 0 10px rgba(175,96,37,0.3)' : 'none',
            cursor: 'pointer',
          }}>
            {/* Kind + rarity corner */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14, color: s.c, width: 16 }}>{kindIcon[s.kind]}</span>
              <span style={{ padding: '1px 6px', fontFamily: 'var(--font-code)', fontSize: 7, color: s.c, letterSpacing: '0.2em', background: `${s.c}1a`, fontWeight: 700 }}>{s.sec}</span>
              <div className="grow" />
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: rarityColor[s.r], letterSpacing: '0.2em', fontWeight: 700 }}>{rarityLabel[s.r]}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: rarityColor[s.r], fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1.2, textWrap: 'pretty', minHeight: 34 }}>
              {s.t}
            </div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 6 }}>
              {s.a} · {s.d}
            </div>
            {/* Progress */}
            <div style={{ marginTop: 8, height: 3, background: 'var(--bg-inset)', position: 'relative' }}>
              <div style={{ width: `${s.progress}%`, height: '100%', background: s.progress === 100 ? 'var(--toxic-lit)' : s.c }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', fontWeight: 700 }}>+{s.xp} XP</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: s.progress === 100 ? 'var(--toxic-lit)' : s.progress > 0 ? 'var(--ember-lit)' : 'var(--ink-dim)', letterSpacing: '0.15em' }}>
                {s.progress === 100 ? '✓ ПРОЙДЕНО' : s.progress > 0 ? `${s.progress}%` : 'НЕ НАЧАТО'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoursePath() {
  const steps = [
    { n: 1, t: 'Fundamentals', d: 'TCP/IP · HTTP · RPC', done: true, c: 'var(--toxic-lit)' },
    { n: 2, t: 'Databases', d: 'ACID · isolation · indexing', done: true, c: 'var(--toxic-lit)' },
    { n: 3, t: 'Distributed', d: 'CAP · PACELC · quorum', done: false, active: true, c: 'var(--ember-lit)' },
    { n: 4, t: 'Patterns', d: 'CQRS · Saga · Outbox', done: false, c: 'var(--ink-dim)' },
    { n: 5, t: 'Case Studies', d: 'Twitter · Uber · YouTube', done: false, c: 'var(--ink-dim)' },
    { n: 6, t: 'Master Trial', d: 'финальный бой', done: false, c: 'var(--blood-lit)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">☰</span> Великий Путь · System Design
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>2 / 6 · 34%</span>
      </div>
      <div style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0, position: 'relative' }}>
          {/* Connecting line */}
          <div style={{ position: 'absolute', top: 20, left: '8%', right: '8%', height: 2, background: 'var(--metal-dark)' }} />
          <div style={{ position: 'absolute', top: 20, left: '8%', width: '34%', height: 2, background: 'linear-gradient(90deg, var(--toxic-lit), var(--ember-lit))', boxShadow: '0 0 6px var(--ember-lit)' }} />
          {steps.map(s => (
            <div key={s.n} style={{ textAlign: 'center', position: 'relative' }}>
              <div style={{
                width: 42, height: 42, margin: '0 auto',
                background: s.done ? 'linear-gradient(180deg, #2a4a10, #0d1a04)' : s.active ? 'linear-gradient(180deg, #3a2a10, #1a0d04)' : 'linear-gradient(180deg, #14100f, #0a0706)',
                border: `2px solid ${s.c}`,
                boxShadow: s.active ? `0 0 12px ${s.c}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 900,
                color: s.c,
                clipPath: 'polygon(50% 0, 100% 30%, 100% 70%, 50% 100%, 0 70%, 0 30%)',
                position: 'relative', zIndex: 2,
              }}>{s.done ? '✓' : s.n}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: s.done || s.active ? 'var(--ink-bright)' : 'var(--ink-dim)', fontWeight: 700, letterSpacing: '0.05em', marginTop: 8, textTransform: 'uppercase' }}>{s.t}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.08em', marginTop: 2 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------- RIGHT: AI Advisor, continue, guild reads -------------
function RightCodex() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <AIAdvisor />
      <ContinueList />
      <GuildShelf />
    </div>
  );
}

function AIAdvisor() {
  return (
    <div className="panel" style={{ padding: 0, borderColor: 'var(--blood)', background: 'linear-gradient(180deg, #1a0808, #0a0404)' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid var(--blood-dark, #3a0909)' }}>
        <span className="ornament" style={{ color: 'var(--blood-lit)' }}>☠</span> Голос Ликтора
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, fontStyle: 'italic' }}>
          « Три мок-боя подряд ты путал <span style={{ color: 'var(--blood-lit)', fontStyle: 'normal', fontWeight: 700 }}>strong vs eventual</span>.
          Заклятие снимается одним свитком. »
        </div>
        <div style={{ marginTop: 12, padding: 10, border: '1px solid var(--ember)', background: 'var(--bg-inset)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--ember-bright)' }}>⚕</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.04em' }}>Lecture 7 · Linearizability</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>M. Kleppmann · 48 мин · 9 упражнений</div>
            </div>
          </div>
          <button className="btn btn-blood" style={{ marginTop: 10, width: '100%', padding: '7px 0', fontSize: 10 }}>⚡ ОТКРЫТЬ СВИТОК</button>
        </div>
        <div style={{ marginTop: 10, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>ТАКЖЕ ОТ ЛИКТОРА ·</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {['Raft за 20 минут', 'Google Spanner · TrueTime', 'Свиток PACELC'].map((t, i) => (
            <a key={i} href="#" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ember-lit)', padding: '2px 0', borderBottom: '1px dashed var(--metal-dark)' }}>→ {t}</a>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContinueList() {
  const items = [
    { t: 'Transformer в 200 строк', p: 62, c: '#c22222' },
    { t: 'Event Sourcing для смертных', p: 14, c: '#7F77DD' },
    { t: 'Dynamic Programming · мантры', p: 38, c: '#6a9fd4' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">▶</span> Продолжить</div>
      <div style={{ padding: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '8px 4px', borderBottom: i < items.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.03em', textWrap: 'pretty' }}>{it.t}</div>
            <div style={{ marginTop: 6, height: 3, background: 'var(--bg-inset)' }}>
              <div style={{ width: `${it.p}%`, height: '100%', background: it.c }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>{it.p}%</span>
              <button style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: it.c, letterSpacing: '0.15em', fontWeight: 700 }}>▶ ДАЛЕЕ</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuildShelf() {
  const reads = [
    { who: 'Нихил', t: 'Raft в деталях', c: 'var(--rarity-magic)' },
    { who: 'root_priest', t: 'Isolation Levels · MySQL', c: 'var(--rarity-rare)' },
    { who: 'BitReaper', t: 'io_uring для смертных', c: 'var(--rarity-rare)' },
    { who: 'Серый·Маг', t: 'Негативная обратная связь', c: 'var(--ink-bright)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⚯</span> Читает Гильдия</div>
      <div style={{ padding: '8px 0' }}>
        {reads.map((r, i) => (
          <div key={i} style={{ padding: '7px 14px', borderBottom: i < reads.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: r.c, letterSpacing: '0.2em', fontWeight: 700 }}>{r.who.toUpperCase()}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 1 }}>{r.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { CodexScreen });
