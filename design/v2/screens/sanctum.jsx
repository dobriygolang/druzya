// Sanctum — main lobby. PoE2 town screen crossed with Habitica dashboard.
// Layout: left = character doll + equipped gear, center = daily quests + feed,
// right = active missions (upcoming interviews).

function SanctumScreen() {
  return (
    <div data-stagger style={{ padding: '24px 20px 140px', display: 'grid', gridTemplateColumns: '380px 1fr 340px', gap: 20, alignItems: 'flex-start' }}>
      <CharacterPanel />
      <QuestsPanel />
      <MissionsPanel />
    </div>
  );
}

function CharacterPanel() {
  const char = (() => {
    try { return JSON.parse(localStorage.getItem('druz9.character') || '{}'); } catch { return {}; }
  })();
  const CLASS_NAMES = {
    alg: 'АЛГОРИТМИСТ·ЛОВЕЦ', dba: 'ЖРЕЦ·DBA', back: 'БЭКЕНД-ВОИН',
    arch: 'АРХИТЕКТОР БЭКЕНДА', comm: 'БЕХАВ·МАГ', ai: 'AI-АПОСТАТ',
  };
  const displayName = (char.name || 'Алексей Волков').toUpperCase();
  const displayClass = CLASS_NAMES[char.charClass] || 'АРХИТЕКТОР БЭКЕНДА';
  const isInitiate = char.completed && (!char.level || char.level <= 1);
  const xpCur = char.xp || 18420;
  const xpMax = isInitiate ? 500 : 29700;
  const lvl = char.level || 24;

  const stats = [
    { k: 'INT', ru: 'Разум', v: 48, c: 'var(--rarity-magic)' },
    { k: 'STR', ru: 'Сила', v: 32, c: 'var(--blood-lit)' },
    { k: 'DEX', ru: 'Ловкость', v: 27, c: 'var(--toxic-lit)' },
    { k: 'WIL', ru: 'Воля', v: 19, c: 'var(--ember-lit)' },
  ];
  const equipment = [
    { slot: 'Шлем', ru: 'Hood', item: 'Капюшон Рефакторщика', rarity: 'rare', icon: '⛑' },
    { slot: 'Оружие', ru: 'Main', item: 'Клинок Big-O', rarity: 'unique', icon: '⚔' },
    { slot: 'Щит', ru: 'Off', item: 'Зерцало Тестов', rarity: 'magic', icon: '◈' },
    { slot: 'Броня', ru: 'Body', item: 'Латы Микросервиса', rarity: 'rare', icon: '▣' },
    { slot: 'Перчатки', ru: 'Gloves', item: 'Хватка REPL', rarity: 'magic', icon: '✋' },
    { slot: 'Пояс', ru: 'Belt', item: 'Пояс Docker', rarity: 'normal', icon: '═' },
    { slot: 'Сапоги', ru: 'Boots', item: 'Сапоги Легковесности', rarity: 'magic', icon: '⬛' },
    { slot: 'Амулет', ru: 'Amulet', item: 'Кулон CAP', rarity: 'unique', icon: '⬟' },
    { slot: 'Кольцо I', ru: 'Ring', item: 'Пусто', rarity: null, icon: '○' },
    { slot: 'Кольцо II', ru: 'Ring', item: 'Перстень Stack-Traces', rarity: 'rare', icon: '◉' },
  ];
  const rarityColor = (r) => ({
    normal: 'var(--rarity-normal)', magic: 'var(--rarity-magic)',
    rare: 'var(--rarity-rare)', unique: 'var(--rarity-unique)',
  }[r] || 'var(--ink-dim)');

  return (
    <div className="panel panel-foot" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✦</span> Персонаж <span className="ornament">·</span> <span style={{ color: 'var(--ink-dim)', fontSize: 11 }}>CHARACTER</span>
      </div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <CharacterPortrait size={160} level={lvl} />
        {isInitiate && (
          <div style={{ marginTop: 14, padding: '4px 12px', background: 'linear-gradient(90deg, transparent, rgba(245,197,107,0.2), transparent)', border: '1px solid var(--ember)', fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-bright)', letterSpacing: '0.3em', fontWeight: 700 }}>✦ НОВООБРАЩЁННЫЙ ✦</div>
        )}
        <div style={{ marginTop: 22, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ink-bright)', letterSpacing: '0.1em', fontWeight: 700 }}>{displayName}</div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--blood-lit)', letterSpacing: '0.2em', marginTop: 2 }}>{displayClass}</div>
        </div>

        {/* XP bar */}
        <div style={{ width: '100%', marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
            <span className="h-caps" style={{ whiteSpace: 'nowrap' }}>Опыт</span>
            <span className="h-stat" style={{ color: 'var(--ember-lit)', whiteSpace: 'nowrap' }}>{xpCur.toLocaleString('ru-RU')} / {xpMax.toLocaleString('ru-RU')}</span>
          </div>
          <div className="bar"><div className="bar-fill" style={{ width: `${Math.min(100, (xpCur/xpMax)*100)}%` }} /></div>
        </div>

        {/* Stats */}
        <div style={{ width: '100%', marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {stats.map(s => (
            <div key={s.k} className="inset-groove" style={{ textAlign: 'center', padding: '8px 4px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: s.c, fontWeight: 700 }}>{s.v}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-mid)', letterSpacing: '0.15em' }}>{s.k}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--ink-dim)' }}>{s.ru}</div>
            </div>
          ))}
        </div>

        {/* Equipment */}
        <div style={{ width: '100%', marginTop: 20 }}>
          <div className="divider-orn" style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.3em', color: 'var(--blood-lit)' }}>✦ ЭКИПИРОВКА ✦</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {equipment.map((e, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', background: 'var(--bg-inset)',
                border: `1px solid ${e.rarity ? rarityColor(e.rarity) + '66' : 'var(--metal-dark)'}`,
              }}>
                <div style={{
                  width: 28, height: 28, background: '#0a0606',
                  border: '1px solid var(--metal-dark)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, color: e.rarity ? rarityColor(e.rarity) : 'var(--ink-dim)',
                }}>{e.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 10,
                    color: e.rarity ? rarityColor(e.rarity) : 'var(--ink-dim)',
                    fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{e.item}</div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>{e.slot.toUpperCase()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestsPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <HeroBanner />
      <DailyQuestsPanel />
      <GuildFeedPanel />
    </div>
  );
}

function HeroBanner() {
  return (
    <div style={{
      position: 'relative', padding: '28px 32px',
      background:
        'radial-gradient(ellipse at 80% 50%, rgba(194,34,34,0.25), transparent 60%), ' +
        'linear-gradient(180deg, #1a0d0a, #0a0605)',
      border: '1px solid var(--metal)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 2px 0 rgba(0,0,0,0.8)',
      overflow: 'hidden',
    }}>
      {/* decorative glyph */}
      <svg style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 280, opacity: 0.15 }} viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="80" fill="none" stroke="#c22222" strokeWidth="0.5" />
        <circle cx="100" cy="100" r="60" fill="none" stroke="#c22222" strokeWidth="0.5" strokeDasharray="4 4" />
        <polygon points="100,40 140,100 100,160 60,100" fill="none" stroke="#e09b3a" strokeWidth="1" />
        <text x="100" y="110" textAnchor="middle" fontFamily="var(--font-display)" fontSize="60" fill="#e09b3a" fontWeight="900">IX</text>
      </svg>
      <div style={{ position: 'relative', maxWidth: 560 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.3em' }}>ДЕНЬ 28 · СТРИК НЕ СЛОМЛЕН</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--ink-bright)', letterSpacing: '0.08em', marginTop: 8, fontWeight: 700, lineHeight: 1.2 }}>
          Ты вступаешь во мрак архитектурных собеседований, Асцендант.
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-mid)', marginTop: 10, lineHeight: 1.6, fontStyle: 'italic' }}>
          Три трайала ждут твоей крови сегодня. Сломай хотя бы один — и твой свет погаснет до полуночи.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="btn btn-blood">⚔ Войти в трайал</button>
          <button className="btn btn-ghost">Посмотреть календарь</button>
        </div>
      </div>
    </div>
  );
}

function DailyQuestsPanel() {
  const quests = [
    { id: 1, ru: 'Ежедневная Ката', en: 'Daily Kata', task: 'Сериализуй бинарное дерево', tag: 'АЛГОРИТМЫ', tagC: 'var(--blood-lit)', diff: 'CURSED', diffC: 'var(--blood-lit)', xp: '×3', time: '12 мин', done: false },
    { id: 2, ru: 'Мок-Интервью', en: 'AI-Mock', task: 'Систем-дизайн: TinyURL at scale', tag: 'СИСТЕМЫ', tagC: 'var(--ember-lit)', diff: 'RARE', diffC: 'var(--rarity-rare)', xp: '+850', time: '45 мин', done: false },
    { id: 3, ru: 'Поведенческий обряд', en: 'Behavioral Rite', task: 'STAR-история о конфликте', tag: 'ПОВЕДЕНИЕ', tagC: 'var(--rarity-magic)', diff: 'NORMAL', diffC: 'var(--rarity-normal)', xp: '+220', time: '8 мин', done: true },
  ];

  return (
    <div className="panel panel-foot" style={{ padding: 0 }}>
      <div className="panel-head" style={{ display: 'flex', alignItems: 'center' }}>
        <span className="ornament">✦</span> Дневные Трайалы 
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-lit)', letterSpacing: '0.15em' }}>1 / 3</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {quests.map(q => (
          <div key={q.id} style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center',
            padding: '14px 16px',
            background: q.done ? 'rgba(90,138,26,0.06)' : 'var(--bg-inset)',
            border: `1px solid ${q.done ? 'rgba(90,138,26,0.4)' : 'var(--metal-dark)'}`,
            position: 'relative',
          }}>
            <div style={{
              width: 38, height: 38,
              background: q.done ? 'linear-gradient(180deg, #2a3a10, #0a1005)' : 'linear-gradient(180deg, #2a0a0a, #0a0303)',
              border: `1px solid ${q.done ? 'var(--toxic-lit)' : 'var(--blood-lit)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: q.done ? 'var(--toxic-lit)' : 'var(--blood-bright)',
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            }}>{q.done ? '✓' : '⚔'}</div>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: q.tagC, letterSpacing: '0.2em', padding: '2px 6px', border: `1px solid ${q.tagC}66` }}>{q.tag}</span>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: q.diffC, letterSpacing: '0.2em', fontWeight: 700 }}>⚠ {q.diff}</span>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)' }}>· {q.time}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: q.done ? 'var(--ink-mid)' : 'var(--ink-bright)', letterSpacing: '0.05em', fontWeight: 600, textDecoration: q.done ? 'line-through' : 'none' }}>
                {q.task}
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, letterSpacing: '0.1em' }}>{q.ru} · <span style={{ fontStyle: 'italic' }}>{q.en}</span></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: q.done ? 'var(--toxic-lit)' : 'var(--ember-bright)', fontWeight: 700 }}>{q.xp}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>XP</div>
              {!q.done && <button className="btn btn-ghost" style={{ marginTop: 8, padding: '4px 10px', fontSize: 10 }}>Войти</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuildFeedPanel() {
  const feed = [
    { who: 'Мария «Шёпот»', lvl: 31, what: 'повергла Eretic of Shards', cls: 'keystone', time: '2 мин' },
    { who: 'Дмитрий «Ворон»', lvl: 27, what: 'вызывает на дуэль в Арене', cls: 'duel', time: '6 мин' },
    { who: 'Гильдия ПОКРОВ', lvl: null, what: 'открыла Raid: Yandex Staff+', cls: 'raid', time: '18 мин' },
    { who: 'Игорь «Пепел»', lvl: 19, what: 'поднялся до Rare после 47 ката', cls: 'rank', time: '1 ч' },
  ];
  return (
    <div className="panel panel-foot" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✦</span> Хроники Гильдии 
      </div>
      <div style={{ padding: '4px 0' }}>
        {feed.map((f, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
            borderBottom: i < feed.length - 1 ? '1px solid var(--metal-dark)' : 'none',
          }}>
            <div style={{
              width: 26, height: 26, flexShrink: 0,
              background: f.cls === 'keystone' ? 'var(--blood-deep)' : f.cls === 'duel' ? 'var(--ember-deep)' : f.cls === 'raid' ? '#08201e' : 'var(--bg-inset)',
              border: `1px solid ${f.cls === 'keystone' ? 'var(--blood-lit)' : f.cls === 'duel' ? 'var(--ember-lit)' : f.cls === 'raid' ? 'var(--rarity-gem)' : 'var(--metal)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, color: 'var(--ink-bright)',
            }}>{f.cls === 'keystone' ? '⬢' : f.cls === 'duel' ? '⚔' : f.cls === 'raid' ? '☠' : '✦'}</div>
            <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)' }}>
              <span style={{ color: 'var(--ink-bright)', fontWeight: 600 }}>{f.who}</span>
              {f.lvl && <span style={{ color: 'var(--ember-lit)', fontFamily: 'var(--font-code)', fontSize: 10, letterSpacing: '0.15em', marginLeft: 6 }}>LVL {f.lvl}</span>}
              <span style={{ marginLeft: 6 }}>{f.what}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)' }}>{f.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissionsPanel() {
  const missions = [
    { c: 'AVITO', role: 'Senior BE', when: 'Втр · 14:00', days: 2, color: 'var(--blood-lit)' },
    { c: 'ЯНДЕКС', role: 'Staff Infra', when: 'Чт · 16:30', days: 4, color: 'var(--ember-lit)' },
    { c: 'T-БАНК', role: 'Tech Lead', when: 'Пн · 11:00', days: 7, color: 'var(--rarity-gem)' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel panel-foot" style={{ padding: 0 }}>
        <div className="panel-head">
          <span className="ornament">✦</span> Миссии 
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {missions.map((m, i) => (
            <div key={i} className="inset-groove" style={{ padding: 12, borderLeft: `3px solid ${m.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-bright)', letterSpacing: '0.08em', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.c}</span>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: m.color, letterSpacing: '0.15em', whiteSpace: 'nowrap' }}>−{m.days}d</span>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 4 }}>{m.role}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', marginTop: 2, letterSpacing: '0.15em' }}>{m.when}</div>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ width: '100%' }}>+ Добавить интервью</button>
        </div>
      </div>

      <StreakPanel />
      <ResourcesPanel />
    </div>
  );
}

function StreakPanel() {
  return (
    <div className="panel panel-foot" style={{ padding: 16, textAlign: 'center' }}>
      <div className="h-caps">Стрик</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 54, color: 'var(--blood-lit)', fontWeight: 900, lineHeight: 1, marginTop: 6, textShadow: '0 0 20px rgba(194,34,34,0.4)' }}>28</div>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-mid)', letterSpacing: '0.25em', marginTop: 4 }}>ДНЕЙ НЕСЛОМЛЕНО</div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 14 }}>
        {['П','В','С','Ч','П','С','В'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>{d}</div>
            <div style={{
              width: 22, height: 22, marginTop: 3,
              background: i < 4 ? 'linear-gradient(180deg, var(--blood-lit), var(--blood))' : 'var(--bg-inset)',
              border: `1px solid ${i === 4 ? 'var(--ember-lit)' : i < 4 ? 'var(--blood-bright)' : 'var(--metal-dark)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: i < 4 ? 'var(--ink-bright)' : 'var(--ink-dim)',
              boxShadow: i < 4 ? '0 0 6px rgba(194,34,34,0.4)' : 'none',
            }}>{i < 4 ? '✦' : i === 4 ? '◉' : ''}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', fontStyle: 'italic' }}>
        ❄ 2 заморозки · До полуночи · 5ч 42м
      </div>
    </div>
  );
}

function ResourcesPanel() {
  const resources = [
    { icon: '❂', ru: 'Свитки мок-сессий', c: 'var(--rarity-rare)', v: 12 },
    { icon: '⬢', ru: 'Скилл-гемы', c: 'var(--rarity-gem)', v: 47 },
    { icon: '☾', ru: 'Жетоны пересдачи', c: 'var(--rarity-divine)', v: 3 },
  ];
  return (
    <div className="panel panel-foot" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✦</span> Реликвии 
      </div>
      <div style={{ padding: '4px 0' }}>
        {resources.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: i < resources.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ fontSize: 20, color: r.c, textShadow: `0 0 8px ${r.c}66` }}>{r.icon}</div>
            <div style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)' }}>{r.ru}</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 14, color: 'var(--ink-bright)', fontWeight: 700 }}>{r.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SanctumScreen });
