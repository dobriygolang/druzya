// Profile — публичный URL /u/alexivanov. Character sheet as resume.
function ProfileScreen() {
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ProfileURLBar />
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 14 }}>
        <CharacterSheet />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <SkillAtlas />
          <StressProfile />
          <WeeklyReport />
          <CareerLine />
          <TrophyWall />
        </div>
      </div>
    </div>
  );
}

function ProfileURLBar() {
  return (
    <div style={{
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 14,
      background: 'linear-gradient(180deg, #14100f, #0a0706)',
      border: '1px solid var(--metal)',
      fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ink-mid)', letterSpacing: '0.12em',
    }}>
      <span style={{ color: 'var(--toxic-lit)' }}>●</span>
      <span style={{ color: 'var(--ink-dim)' }}>druz9.ix / u /</span>
      <span style={{ color: 'var(--ember-bright)', fontWeight: 700 }}>alexivanov</span>
      <div className="grow" />
      <span style={{ color: 'var(--ink-dim)' }}>ПУБЛИЧНО · 247 просмотров · 12 рекрутеров за неделю</span>
      <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 9 }}>⎘ СКОПИРОВАТЬ ССЫЛКУ</button>
      <button className="btn btn-ember" style={{ padding: '4px 12px', fontSize: 9 }}>↓ PDF RESUME</button>
    </div>
  );
}

// ------------- CHARACTER SHEET -------------
function CharacterSheet() {
  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Banner */}
      <div style={{
        position: 'relative', padding: '20px 18px 14px',
        background: 'linear-gradient(180deg, #1a0808 0%, #0a0303 100%)',
        borderBottom: '1px solid var(--blood-dark, #3a0909)',
      }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `
          radial-gradient(ellipse at 50% 120%, rgba(224,155,58,0.2), transparent 60%),
          radial-gradient(ellipse at 50% -20%, rgba(194,34,34,0.15), transparent 50%)
        ` }} />
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.35em', fontWeight: 700 }}>
            ⚔ · АРХИТЕКТОР · ⚔
          </div>
          <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 36, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 6, textShadow: '0 0 18px rgba(194,34,34,0.4)' }}>
            Alekseí Volkov
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ember-lit)', letterSpacing: '0.25em', marginTop: 4, fontWeight: 600 }}>
            УРОВЕНЬ 24 · ASCEND II
          </div>
          <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic' }}>
            « 147 дней сезона · 23 победы · 11 падений »
          </div>
        </div>
      </div>

      {/* Portrait */}
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div style={{ position: 'relative' }}>
          <CharacterPortrait size={220} name="АЛЕКСЕЙ" cls="АРХИТЕКТОР" level={24} />
          {/* Aura ring */}
          <div style={{
            position: 'absolute', inset: -8, border: '1px solid var(--ember)',
            clipPath: 'polygon(20px 0, calc(100% - 20px) 0, 100% 20px, 100% calc(100% - 20px), calc(100% - 20px) 100%, 20px 100%, 0 calc(100% - 20px), 0 20px)',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Class badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { t: 'АРХИТЕКТОР', c: '#7F77DD', r: 'PRIMARY' },
            { t: 'АЛГОРИТМИСТ', c: '#6a9fd4', r: 'SECONDARY' },
            { t: 'ЛИКТОР', c: '#c22222', r: 'МАЛЫЙ ТИТУЛ' },
          ].map((b, i) => (
            <div key={i} style={{
              padding: '4px 10px', background: `${b.c}1a`, border: `1px solid ${b.c}`,
              fontFamily: 'var(--font-code)', fontSize: 9, color: b.c, letterSpacing: '0.15em', fontWeight: 700,
            }}>{b.t}</div>
          ))}
        </div>

        {/* Core stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' }}>
          {[
            { l: 'ELO', v: '1,847', c: 'var(--ember-bright)' },
            { l: 'РАНГ', v: '#142', c: 'var(--ember-lit)' },
            { l: 'W/L', v: '23-11', c: 'var(--toxic-lit)' },
            { l: 'STREAK', v: '🔥5', c: 'var(--blood-lit)' },
            { l: 'MOCK', v: '87', c: 'var(--ink-bright)' },
            { l: 'ЧАСОВ', v: '214', c: 'var(--rarity-gem)' },
          ].map((s, i) => (
            <div key={i} className="inset-groove" style={{ padding: '6px 8px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{s.l}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Identity */}
        <div style={{ width: '100%', padding: 10, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.25em', marginBottom: 6 }}>ПУТЬ ИСТИННЫЙ</div>
          {[
            { k: 'ИЩУ', v: 'Senior / Staff Backend · дистр. системы' },
            { k: 'ВИЗА', v: 'RU, EU, готов к релокации' },
            { k: 'СТЕК', v: 'Go · PostgreSQL · Kafka · k8s' },
            { k: 'ИЗБЕГАЮ', v: 'фронт, мобильное, legacy Java' },
          ].map(r => (
            <div key={r.k} style={{ display: 'flex', gap: 10, padding: '3px 0', fontFamily: 'var(--font-code)', fontSize: 10 }}>
              <span style={{ color: 'var(--blood-lit)', letterSpacing: '0.2em', width: 64, fontWeight: 700 }}>{r.k}</span>
              <span style={{ color: 'var(--ink-bright)', flex: 1 }}>{r.v}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, width: '100%' }}>
          <button className="btn btn-blood" style={{ flex: 1, padding: '10px 0', fontSize: 11 }}>⚔ ВЫЗВАТЬ НА ДУЭЛЬ</button>
          <button className="btn btn-ghost" style={{ padding: '10px 14px', fontSize: 11 }}>✉</button>
          <button className="btn btn-ghost" style={{ padding: '10px 14px', fontSize: 11 }}>★</button>
        </div>
      </div>
    </div>
  );
}

// ------------- SKILL ATLAS -------------
function SkillAtlas() {
  const skills = [
    { n: 'АЛГОРИТМЫ',     c: '#6a9fd4', v: 78, nodes: 34, total: 42 },
    { n: 'SQL · DB',       c: '#639922', v: 62, nodes: 21, total: 38 },
    { n: 'BACKEND',        c: '#EF9F27', v: 84, nodes: 41, total: 48 },
    { n: 'SYS DESIGN',     c: '#7F77DD', v: 47, nodes: 18, total: 46 },
    { n: 'BEHAVIORAL',     c: '#1D9E75', v: 71, nodes: 12, total: 20 },
    { n: 'AI · LLM',       c: '#c22222', v: 35, nodes: 8,  total: 24 },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">⚙</span> Атлас Навыков · Skill Fingerprint
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>134 / 218 узлов</span>
      </div>
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'center' }}>
        {/* Radar */}
        <div style={{ position: 'relative', width: 220, height: 220, margin: '0 auto' }}>
          <svg viewBox="-120 -120 240 240" style={{ width: '100%', height: '100%' }}>
            <defs>
              <radialGradient id="skillFill" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#e09b3a" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#c22222" stopOpacity="0.25" />
              </radialGradient>
            </defs>
            {/* Hex rings */}
            {[30, 55, 80, 100].map((r, i) => (
              <polygon key={i} points={Array.from({ length: 6 }, (_, k) => {
                const a = (k * 60 - 90) * Math.PI / 180;
                return `${Math.cos(a) * r},${Math.sin(a) * r}`;
              }).join(' ')} fill="none" stroke="#2a221b" strokeWidth={i === 3 ? 1 : 0.5} />
            ))}
            {/* Spokes */}
            {skills.map((_, k) => {
              const a = (k * 60 - 90) * Math.PI / 180;
              return <line key={k} x1="0" y1="0" x2={Math.cos(a) * 100} y2={Math.sin(a) * 100} stroke="#2a221b" strokeWidth="0.5" />;
            })}
            {/* Data polygon */}
            <polygon points={skills.map((s, k) => {
              const a = (k * 60 - 90) * Math.PI / 180;
              const r = s.v;
              return `${Math.cos(a) * r},${Math.sin(a) * r}`;
            }).join(' ')} fill="url(#skillFill)" stroke="#e09b3a" strokeWidth="1.5" />
            {/* Data points */}
            {skills.map((s, k) => {
              const a = (k * 60 - 90) * Math.PI / 180;
              const r = s.v;
              return <circle key={k} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r="3" fill={s.c} stroke="#000" strokeWidth="1" />;
            })}
            {/* Labels */}
            {skills.map((s, k) => {
              const a = (k * 60 - 90) * Math.PI / 180;
              const r = 115;
              return (
                <text key={k} x={Math.cos(a) * r} y={Math.sin(a) * r + 3}
                      textAnchor="middle" fontFamily="var(--font-code)" fontSize="7"
                      fill={s.c} fontWeight="700" letterSpacing="1">{s.n.split(' ')[0]}</text>
              );
            })}
            {/* Center */}
            <circle cx="0" cy="0" r="4" fill="#e09b3a" />
            <text x="0" y="15" textAnchor="middle" fontFamily="var(--font-display)" fontSize="8" fill="#6b5f54" letterSpacing="2">IX</text>
          </svg>
        </div>
        {/* Skill bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {skills.map(s => (
            <div key={s.n}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: s.c, fontWeight: 700, letterSpacing: '0.08em', width: 140 }}>{s.n}</span>
                <div className="grow" />
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>{s.nodes}/{s.total} узлов</span>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: s.c, fontWeight: 700, marginLeft: 10, width: 30, textAlign: 'right' }}>{s.v}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', position: 'relative' }}>
                <div style={{ width: `${s.v}%`, height: '100%', background: `linear-gradient(90deg, ${s.c}88, ${s.c})`, boxShadow: `0 0 4px ${s.c}` }} />
                {/* Tier markers */}
                {[25, 50, 75].map(t => (
                  <div key={t} style={{ position: 'absolute', left: `${t}%`, top: 0, bottom: 0, width: 1, background: '#000', opacity: 0.5 }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------- STRESS PROFILE -------------
function StressProfile() {
  const bars = [
    { l: 'мысли вслух',        v: 92, c: 'var(--toxic-lit)' },
    { l: 'уточняет scope',     v: 78, c: 'var(--toxic-lit)' },
    { l: 'темп под цейтнотом', v: 64, c: 'var(--ember-lit)' },
    { l: 'исправляет ошибки',  v: 71, c: 'var(--ember-lit)' },
    { l: 'работает с фидбеком',v: 82, c: 'var(--toxic-lit)' },
    { l: 'держит тишину',      v: 34, c: 'var(--blood-lit)' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">☠</span> Стресс-Профиль · Поведение в бою</div>
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 220px', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bars.map(b => (
            <div key={b.l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', width: 160 }}>{b.l}</span>
              <div style={{ flex: 1, height: 10, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', position: 'relative' }}>
                <div style={{ width: `${b.v}%`, height: '100%', background: `linear-gradient(90deg, ${b.c}aa, ${b.c})` }} />
              </div>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: b.c, fontWeight: 700, width: 28, textAlign: 'right' }}>{b.v}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--bg-inset)', padding: 12, border: '1px solid var(--metal-dark)' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>ВЕРДИКТ ЛИКТОРА</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-bright)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
            « Думает вслух ровно, фидбек принимает без обороны.
            Под цейтнотом — <span style={{ color: 'var(--blood-lit)', fontStyle: 'normal', fontWeight: 700 }}>замолкает</span>.
            Тренируй: объявлять гипотезу до кода. »
          </div>
          <div style={{ marginTop: 10, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>ИЗ 87 МОК-БОЁВ · σ = 0.12</div>
        </div>
      </div>
    </div>
  );
}

// ------------- WEEKLY REPORT -------------
function WeeklyReport() {
  const days = [
    { d: 'ПН', xp: 120, mock: 1 },
    { d: 'ВТ', xp: 260, mock: 2 },
    { d: 'СР', xp: 410, mock: 3 },
    { d: 'ЧТ', xp: 180, mock: 1 },
    { d: 'ПТ', xp: 340, mock: 2 },
    { d: 'СБ', xp: 90,  mock: 0 },
    { d: 'ВС', xp: 520, mock: 2 },
  ];
  const maxXp = Math.max(...days.map(d => d.xp));
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✧</span> Свиток Недели · 14-20 февраля
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>+1 920 XP · 11 БОЁВ</span>
      </div>
      <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Chart */}
        <div>
          <div style={{ display: 'flex', alignItems: 'end', gap: 6, height: 100, padding: '0 4px 4px', borderBottom: '1px solid var(--metal-dark)' }}>
            {days.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ember-lit)', fontWeight: 700 }}>{d.xp}</span>
                <div style={{
                  width: '100%', height: (d.xp / maxXp) * 80,
                  background: `linear-gradient(180deg, ${d.xp === maxXp ? 'var(--ember-bright)' : 'var(--ember)'}, var(--ember-deep))`,
                  border: '1px solid var(--ember)',
                  boxShadow: d.xp === maxXp ? '0 0 8px var(--ember-lit)' : 'none',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '4px 4px 0' }}>
            {days.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>{d.d}</div>
            ))}
          </div>
        </div>
        {/* Narrative */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.6, fontStyle: 'italic' }}>
            « Лучший день — <span style={{ color: 'var(--ember-bright)', fontStyle: 'normal', fontWeight: 700 }}>воскресенье</span>.
            Побил <span style={{ color: 'var(--blood-lit)', fontStyle: 'normal', fontWeight: 700 }}>Axiom·42</span> в Арене 3:1.
            Слабое место — суббота: 0 мок-боёв. Риск падения привычки. »
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
            {[
              { l: 'ELO Δ', v: '+47',  c: 'var(--toxic-lit)' },
              { l: 'Узлы',  v: '+6',   c: 'var(--ember-lit)' },
              { l: 'Побед', v: '7-4',  c: 'var(--ink-bright)' },
              { l: 'Свитки',v: '4',    c: 'var(--rarity-gem)' },
            ].map(s => (
              <div key={s.l} className="inset-groove" style={{ padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{s.l}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: s.c, fontWeight: 700 }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------- CAREER LINE -------------
function CareerLine() {
  const timeline = [
    { y: '2017', t: 'Junior Go · Банк', d: '2 года', c: 'var(--ink-mid)' },
    { y: '2019', t: 'Middle Backend · Ozon', d: '3 года', c: 'var(--ink-mid)' },
    { y: '2022', t: 'Senior · Яндекс', d: '2 года', c: 'var(--ink-bright)' },
    { y: '2024', t: 'Tech Lead · Стартап', d: '1.5 года', c: 'var(--ember-lit)' },
    { y: '2026', t: 'Сейчас · охота Staff', d: 'активно', c: 'var(--blood-lit)', current: true },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⟐</span> Карьерная Линия</div>
      <div style={{ padding: 18 }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ position: 'absolute', top: 14, left: 10, right: 10, height: 1, background: 'linear-gradient(90deg, var(--metal), var(--ember), var(--blood-lit))' }} />
          {timeline.map((t, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', position: 'relative', paddingTop: 0 }}>
              <div style={{
                width: 18, height: 18, margin: '0 auto', background: t.current ? 'var(--blood-lit)' : '#14100f',
                border: `2px solid ${t.c}`,
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                boxShadow: t.current ? '0 0 8px var(--blood-lit)' : 'none',
                position: 'relative', zIndex: 2,
              }} />
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: t.c, letterSpacing: '0.2em', fontWeight: 700, marginTop: 6 }}>{t.y}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.03em', marginTop: 3, textWrap: 'pretty' }}>{t.t}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 2 }}>{t.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------- TROPHY WALL -------------
function TrophyWall() {
  const trophies = [
    { n: 'Победитель Лиги ELO 1800+', i: '♛', c: 'var(--rarity-unique)', sub: 'Сезон I' },
    { n: 'Убийца Дракона: Ozon×3', i: '☠', c: 'var(--blood-bright)', sub: '3 офера' },
    { n: 'Серия 10 побед подряд', i: '🔥', c: 'var(--ember-bright)', sub: 'январь' },
    { n: 'Обучение 100 часов', i: '❏', c: 'var(--rarity-gem)', sub: 'тысячник' },
    { n: 'Осаждающий · ОЗОН', i: '⚔', c: 'var(--rarity-magic)', sub: 'гильдия' },
    { n: 'Ликтор месяца', i: '☉', c: 'var(--ember-lit)', sub: 'рецензент #3' },
    { n: 'Ранний Игрок · Сезон I', i: '✦', c: 'var(--rarity-rare)', sub: 'founder' },
    { n: '5 000 узлов дерева', i: '◈', c: 'var(--ink-bright)', sub: 'атлас' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">♛</span> Стена Трофеев · 23 из 68</div>
      <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {trophies.map((t, i) => (
          <div key={i} style={{
            padding: '10px 8px', textAlign: 'center',
            background: 'linear-gradient(180deg, #14100f, #0a0706)',
            border: `1px solid ${t.c}44`,
            boxShadow: t.c.includes('unique') ? '0 0 8px rgba(175,96,37,0.2)' : 'none',
          }}>
            <div style={{ fontSize: 24, color: t.c, textShadow: `0 0 8px ${t.c}66` }}>{t.i}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: t.c, fontWeight: 700, letterSpacing: '0.04em', marginTop: 4, lineHeight: 1.2, textWrap: 'pretty' }}>{t.n}</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.15em', marginTop: 3 }}>{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ProfileScreen });
