// Forge of Trials — hub of mock modes. PoE2 "map device" / "atlas of worlds" vibe.
// Dark altar at center, mode-cards arrayed around it, each a different trial.

function ForgeScreen() {
  const [selected, setSelected] = React.useState('classic');
  const [filter, setFilter] = React.useState('all');
  const mode = MODES.find(m => m.id === selected);

  const filtered = filter === 'all' ? MODES : MODES.filter(m => m.tier === filter);

  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <ForgeHeader filter={filter} setFilter={setFilter} />
        <ModeGrid modes={filtered} selected={selected} onSelect={setSelected} />
        <Chronicle />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ModeDetail mode={mode} />
        <DailyKata />
        <InterviewCountdown />
      </div>
    </div>
  );
}

function ForgeHeader({ filter, setFilter }) {
  const tiers = [
    { k: 'all', l: 'Все', n: 15 },
    { k: 'normal', l: 'Обычные', n: 6, c: 'var(--toxic-lit)' },
    { k: 'hard', l: 'Тяжёлые', n: 5, c: 'var(--ember-lit)' },
    { k: 'boss', l: 'Босс', n: 3, c: 'var(--blood-lit)' },
    { k: 'cursed', l: 'Проклятые', n: 1, c: 'var(--rarity-magic)' },
  ];
  return (
    <div className="panel" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 56, height: 56, position: 'relative', flexShrink: 0 }}>
        <svg viewBox="0 0 60 60" style={{ width: '100%', height: '100%' }}>
          <defs>
            <radialGradient id="forgeGlow" cx="50%" cy="60%" r="50%">
              <stop offset="0%" stopColor="#e09b3a" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#e09b3a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="28" fill="url(#forgeGlow)" />
          <polygon points="30,6 50,20 50,40 30,54 10,40 10,20" fill="#0a0403" stroke="#8a1414" strokeWidth="1.5" />
          <polygon points="30,14 44,22 44,38 30,46 16,38 16,22" fill="none" stroke="#e09b3a" strokeWidth="0.8" />
          <text x="30" y="36" textAnchor="middle" fontFamily="var(--font-display)" fontSize="16" fontWeight="900" fill="#f5c56b">⚒</text>
        </svg>
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.3em' }}>ПОДГОТОВКА · КУЗНИ</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--ink-bright)', letterSpacing: '0.08em', marginTop: 2, fontWeight: 700 }}>
          КУЗНЯ ИСПЫТАНИЙ
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic', marginTop: 2 }}>
          Выбери испытание. Каждое ломает тебя иначе.
        </div>
      </div>
      <div className="grow" />
      <div style={{ display: 'flex', border: '1px solid var(--metal)', background: 'var(--bg-inset)' }}>
        {tiers.map((t, i) => (
          <button key={t.k} onClick={() => setFilter(t.k)} style={{
            padding: '8px 14px', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.15em',
            color: filter === t.k ? (t.c || 'var(--ember-bright)') : 'var(--ink-mid)',
            background: filter === t.k ? 'linear-gradient(180deg, #2a1a10, #1a0e08)' : 'transparent',
            borderRight: i < tiers.length - 1 ? '1px solid var(--metal-dark)' : 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.l} <span style={{ fontFamily: 'var(--font-code)', color: 'var(--ink-dim)', fontSize: 9 }}>{t.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeGrid({ modes, selected, onSelect }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      {modes.map(m => <ModeCard key={m.id} mode={m} active={m.id === selected} onClick={() => onSelect(m.id)} />)}
    </div>
  );
}

function ModeCard({ mode, active, onClick }) {
  const tierColor = {
    normal: 'var(--toxic-lit)', hard: 'var(--ember-lit)',
    boss: 'var(--blood-lit)', cursed: 'var(--rarity-magic)',
  }[mode.tier];
  return (
    <button onClick={onClick} style={{
      padding: 0, textAlign: 'left', cursor: 'pointer',
      background: active
        ? 'linear-gradient(180deg, #1f1410, #0f0804)'
        : 'linear-gradient(180deg, #14100e, #0a0706)',
      border: `1px solid ${active ? tierColor : 'var(--metal-dark)'}`,
      boxShadow: active ? `0 0 20px ${tierColor}44, inset 0 0 30px rgba(0,0,0,0.6)` : 'inset 0 0 20px rgba(0,0,0,0.5)',
      position: 'relative', transition: 'all 0.15s',
    }}>
      {/* Corner ornaments */}
      <span style={{ position: 'absolute', top: 4, left: 4, width: 10, height: 10, borderTop: `1px solid ${active ? tierColor : 'var(--metal)'}`, borderLeft: `1px solid ${active ? tierColor : 'var(--metal)'}` }} />
      <span style={{ position: 'absolute', top: 4, right: 4, width: 10, height: 10, borderTop: `1px solid ${active ? tierColor : 'var(--metal)'}`, borderRight: `1px solid ${active ? tierColor : 'var(--metal)'}` }} />
      <span style={{ position: 'absolute', bottom: 4, left: 4, width: 10, height: 10, borderBottom: `1px solid ${active ? tierColor : 'var(--metal)'}`, borderLeft: `1px solid ${active ? tierColor : 'var(--metal)'}` }} />
      <span style={{ position: 'absolute', bottom: 4, right: 4, width: 10, height: 10, borderBottom: `1px solid ${active ? tierColor : 'var(--metal)'}`, borderRight: `1px solid ${active ? tierColor : 'var(--metal)'}` }} />

      {/* Rune header */}
      <div style={{
        padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${active ? tierColor + '44' : 'var(--metal-dark)'}`,
        background: active ? `linear-gradient(180deg, ${tierColor}15, transparent)` : 'transparent',
      }}>
        <div style={{
          width: 34, height: 34, flexShrink: 0,
          background: 'var(--bg-inset)', border: `1px solid ${tierColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: tierColor,
          boxShadow: `0 0 8px ${tierColor}66`,
        }}>{mode.rune}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: tierColor, letterSpacing: '0.25em', fontWeight: 700 }}>
            {mode.tierLabel}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-bright)', letterSpacing: '0.05em', fontWeight: 700, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {mode.name}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px 12px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', lineHeight: 1.45, fontStyle: 'italic', minHeight: 48 }}>
          « {mode.flavor} »
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--metal-dark)' }}>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{mode.duration}</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} style={{
                width: 5, height: 10,
                background: i < mode.difficulty ? tierColor : 'var(--metal-dark)',
                transform: 'skewX(-15deg)',
              }} />
            ))}
          </div>
          <div className="grow" />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', fontWeight: 700 }}>+{mode.xp} XP</span>
        </div>
      </div>

      {/* Lock overlay */}
      {mode.locked && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(6, 4, 3, 0.82)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          <span style={{ fontSize: 24, color: 'var(--metal-lit)' }}>⚿</span>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{mode.locked}</div>
        </div>
      )}
    </button>
  );
}

function ModeDetail({ mode }) {
  if (!mode) return null;
  const tierColor = {
    normal: 'var(--toxic-lit)', hard: 'var(--ember-lit)',
    boss: 'var(--blood-lit)', cursed: 'var(--rarity-magic)',
  }[mode.tier];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head" style={{ borderBottom: `1px solid ${tierColor}55` }}>
        <span className="ornament" style={{ color: tierColor }}>{mode.rune}</span> {mode.name}
      </div>
      <div style={{ padding: '14px 18px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-bright)', fontStyle: 'italic', lineHeight: 1.55, paddingBottom: 12, borderBottom: '1px solid var(--metal-dark)' }}>
          « {mode.flavor} »
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="h-caps" style={{ color: 'var(--ink-dim)' }}>Модификаторы</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {mode.mods.map((mod, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--rarity-magic)', lineHeight: 1.4 }}>
                <span style={{ color: tierColor, flexShrink: 0 }}>◈</span>
                <span>{mod}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Stat label="Длительность" value={mode.duration} />
          <Stat label="Сложность" value={mode.difficultyLabel} c={tierColor} />
          <Stat label="XP за успех" value={`+${mode.xp}`} c="var(--ember-lit)" />
          <Stat label="Штраф провала" value={mode.penalty} c="var(--blood-lit)" />
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--metal-dark)' }}>
          <div className="h-caps" style={{ color: 'var(--ink-dim)' }}>Компании в пуле</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {mode.companies.map(c => (
              <span key={c} style={{
                padding: '3px 8px', fontFamily: 'var(--font-code)', fontSize: 9,
                color: 'var(--ink-mid)', background: 'var(--bg-inset)',
                border: '1px solid var(--metal-dark)', letterSpacing: '0.1em',
              }}>{c}</span>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-blood" style={{ flex: 1, padding: '10px', fontSize: 11 }}>
            ▶ Войти в Испытание
          </button>
          <button className="btn btn-ghost" style={{ padding: '10px 14px', fontSize: 11 }}>⚙</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, c = 'var(--ink-bright)' }) {
  return (
    <div className="inset-groove" style={{ padding: '6px 10px' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: c, fontWeight: 700, marginTop: 1 }}>{value}</div>
    </div>
  );
}

function DailyKata() {
  return (
    <div className="panel" style={{ padding: 0, position: 'relative' }}>
      <div className="panel-head">
        <span className="ornament">☀</span> Ежедневная Ката
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--toxic-lit)', letterSpacing: '0.2em' }}>СТРИК · 17 ДНЕЙ</span>
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ember-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>
          Обход дерева с состоянием
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 4, fontStyle: 'italic' }}>
          Адаптирована под твоё слабое место — Trees.
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {Array.from({ length: 17 }).map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 6,
              background: i < 16 ? 'linear-gradient(180deg, var(--ember-lit), #8a5a1a)' : 'var(--toxic-lit)',
              boxShadow: i === 16 ? '0 0 8px var(--toxic-lit)' : 'none',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)' }}>
          <span>7 мин · +40 XP</span>
          <span style={{ color: 'var(--blood-lit)' }}>Истекает через 8ч 12м</span>
        </div>
        <button className="btn btn-blood" style={{ width: '100%', marginTop: 10, padding: '8px', fontSize: 11 }}>
          ⚔ Принять
        </button>
      </div>
    </div>
  );
}

function InterviewCountdown() {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">⏲</span> Календарь Собесов
      </div>
      <div style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--blood-lit)', fontWeight: 900, lineHeight: 1 }}>12</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ДНЕЙ</div>
          <div className="grow" />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 700 }}>ЯНДЕКС</div>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.15em' }}>BOSS · SYSTEM DESIGN</div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-inset)', borderLeft: '2px solid var(--ember-lit)' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.2em' }}>ПЛАН · СЕГОДНЯ</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-bright)', marginTop: 4, lineHeight: 1.5 }}>
            Мок System Design: TinyURL at Scale → разбор Consistent Hashing.
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 4 }}>
          {Array.from({ length: 21 }).map((_, i) => {
            const done = i < 9;
            const today = i === 9;
            const boss = i === 20;
            return (
              <div key={i} style={{
                flex: 1, height: 20,
                background: boss ? 'var(--blood-lit)' : done ? 'var(--toxic-lit)' : today ? 'var(--ember-lit)' : 'var(--bg-inset)',
                border: `1px solid ${boss ? 'var(--blood-bright)' : done ? 'var(--toxic-bright)' : today ? 'var(--ember-bright)' : 'var(--metal-dark)'}`,
                boxShadow: today ? '0 0 6px var(--ember-lit)' : 'none',
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
              }} />
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
          <span>Готовность: <span style={{ color: 'var(--toxic-lit)', fontWeight: 700 }}>64%</span></span>
          <span>→ FINAL MOCK / 3 дня</span>
        </div>
      </div>
    </div>
  );
}

function Chronicle() {
  const entries = [
    { who: 'Ликтор', c: 'var(--rarity-magic)', t: 'завершил мок System Design · +120 XP · оценка 78/100', when: '2ч назад' },
    { who: 'Адвокат', c: 'var(--blood-lit)', t: 'сломил твою защиту в секции Behavioral — стресс-профиль обновлён', when: '1д назад' },
    { who: 'Некромант', c: 'var(--toxic-lit)', t: 'ты нашёл баг в чужом решении «Two Sum» · +45 XP', when: '1д назад' },
    { who: 'Призрак', c: 'var(--rarity-gem)', t: 'твой ghost run обогнал медианный на 00:42', when: '3д назад' },
    { who: 'Режиссёр', c: 'var(--ember-lit)', t: 'Offer Simulator · ты выторговал +18% к окладу', when: '4д назад' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head">
        <span className="ornament">✦</span> Хроника Испытаний
      </div>
      <div style={{ padding: '10px 16px' }}>
        {entries.map((e, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 0', borderBottom: i < entries.length - 1 ? '1px solid var(--metal-dark)' : 'none',
          }}>
            <span style={{
              fontFamily: 'var(--font-code)', fontSize: 9, color: e.c, letterSpacing: '0.2em',
              fontWeight: 700, width: 90, flexShrink: 0,
            }}>{e.who.toUpperCase()}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', flex: 1, minWidth: 0 }}>
              {e.t}
            </span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', flexShrink: 0 }}>{e.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- DATA ----------------
const MODES = [
  {
    id: 'classic', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · CLASSIC',
    rune: '⚔', name: 'Классический Мок',
    flavor: 'Ликтор задаёт вопросы. Ты решаешь. Как на настоящем собесе.',
    duration: '45 МИН', difficulty: 2, difficultyLabel: 'Средняя',
    xp: 120, penalty: '—',
    companies: ['AVITO', 'VK', 'SBER', 'OZON'],
    mods: [
      'Ликтор наводит если молчишь > 2 минут',
      'Проверка решения автотестами + AI-анализом',
      'Follow-up вопросы после решения',
    ],
  },
  {
    id: 'ai-native', tier: 'hard', tierLabel: 'ТЯЖЁЛОЕ · AI-NATIVE',
    rune: '◈', name: 'AI-Native Раунд',
    flavor: 'AI-ассистент разрешён. Но он лжёт. Найди ложь — или утони в ней.',
    duration: '60 МИН', difficulty: 3, difficultyLabel: 'Высокая',
    xp: 180, penalty: 'Стресс-штамп',
    companies: ['ЯНДЕКС', 'TINKOFF', 'OZON'],
    mods: [
      'Встроенные Hallucination Traps — правдоподобные но неверные советы',
      'Оценивается Context / Verification / Judgment / Delivery',
      'Нельзя завершить без Verification Gate',
      'Provenance Graph: видно что написал ты, что AI',
    ],
  },
  {
    id: 'advocate', tier: 'hard', tierLabel: 'ТЯЖЁЛОЕ · ADVOCATE',
    rune: '☠', name: 'Адвокат Дьявола',
    flavor: 'Ликтор давит. Сбивает с толку. Ломает твою логику провокациями.',
    duration: '30 МИН', difficulty: 4, difficultyLabel: 'Жестокая',
    xp: 200, penalty: 'Деградация Воли',
    companies: ['ЯНДЕКС', 'TINKOFF'],
    mods: [
      'Ликтор сомневается в каждом твоём решении',
      'Внезапные смены требований на лету',
      'Провокационные follow-up вопросы',
    ],
  },
  {
    id: 'paired', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · PAIRED',
    rune: '⚯', name: 'Парный Мок',
    flavor: 'Двое смертных — один Ликтор. После — взаимный фидбек от живого человека.',
    duration: '60 МИН', difficulty: 2, difficultyLabel: 'Средняя',
    xp: 150, penalty: '—',
    companies: ['AVITO', 'VK', 'MAIL'],
    mods: [
      'Оба проходят одну задачу параллельно',
      'AI — интервьюер для обоих',
      'После — взаимный peer-фидбек',
      '+50 XP за качественный отзыв сопернику',
    ],
  },
  {
    id: 'necromancy', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · NECROMANCY',
    rune: '☥', name: 'Некромантия',
    flavor: 'Восстань над гробом чужого решения. Найди баг — воскресни с опытом.',
    duration: '15 МИН', difficulty: 2, difficultyLabel: 'Средняя',
    xp: 60, penalty: '—',
    companies: ['АРХИВ МЁРТВЫХ'],
    mods: [
      'Анонимное чужое неправильное решение',
      'Найди баг — получишь XP',
      'Пропусти — ничего не потеряешь',
    ],
  },
  {
    id: 'hardcore', tier: 'boss', tierLabel: 'БОСС · HARDCORE',
    rune: '✝', name: 'Хардкор',
    flavor: 'Провал — не просто провал. Ты теряешь часть прокачки. Не для слабых.',
    duration: '45 МИН', difficulty: 5, difficultyLabel: 'Смертельная',
    xp: 360, penalty: '−80 XP + узел',
    companies: ['ЯНДЕКС', 'TINKOFF'],
    locked: null,
    mods: [
      'Провал = потеря части прогресса в skill atlas',
      'Один случайный узел теряет 15% прогресса',
      'Тройной XP за прохождение',
      'Нет второго шанса — таймер не останавливается',
    ],
  },
  {
    id: 'cursed', tier: 'cursed', tierLabel: 'ПРОКЛЯТОЕ · CURSED',
    rune: '✱', name: 'Проклятая Задача',
    flavor: 'Дебафф на твоей крови. Но награда — тройная. Выдержишь?',
    duration: '40 МИН', difficulty: 4, difficultyLabel: 'Хаотичная',
    xp: 300, penalty: '−40 XP',
    companies: ['АРЕНА РАНДОМА'],
    mods: [
      'Случайный дебафф: нет backspace / таймер ×2 / нет комментариев',
      'Тройной XP за успех',
      'Проклятие меняется каждую пятницу',
    ],
  },
  {
    id: 'autopsy', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · AUTOPSY',
    rune: '☤', name: 'Вскрытие Собеса',
    flavor: 'Расскажи что сломало тебя на реальном собесе. AI проведёт вскрытие.',
    duration: '20 МИН', difficulty: 1, difficultyLabel: 'Лёгкая',
    xp: 80, penalty: '—',
    companies: ['ЛЮБАЯ'],
    mods: [
      'Ввод: компания, секция, вопросы, твои ответы, исход',
      'AI строит карту где именно ты потерял',
      'Связывается с узлами skill atlas — твоими слабыми зонами',
      'Можно поделиться анонимно как разбор',
    ],
  },
  {
    id: 'offer', tier: 'hard', tierLabel: 'ТЯЖЁЛОЕ · OFFER',
    rune: '⚖', name: 'Симулятор Оффера',
    flavor: 'Тебе дают оффер. Ниже рынка. Торгуйся — или подписывай и плачь.',
    duration: '25 МИН', difficulty: 3, difficultyLabel: 'Высокая',
    xp: 160, penalty: '—',
    companies: ['ГИЛЬДИЯ HR'],
    mods: [
      'AI играет HR + hiring manager',
      'Зарплата ниже рынка, equity, испытательный',
      'Оценивается: агрессия / обоснование / удержание оффера',
      'Конкретные фразы и стратегии в финальном отчёте',
    ],
  },
  {
    id: 'ghost', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · GHOST',
    rune: '☽', name: 'Забег с Призраком',
    flavor: 'Рядом — полупрозрачный ты. Или топ-игрок. Или эталон. Обгоняй.',
    duration: '30 МИН', difficulty: 2, difficultyLabel: 'Средняя',
    xp: 100, penalty: '—',
    companies: ['ТАБЛИЦЫ РЕКОРДОВ'],
    mods: [
      'Призрак: твой прошлый забег / топ-игрок / AI-эталон',
      'Видно его курсор, паузы, откаты в реальном времени',
      'Бонус XP за обгон',
      'Твой лучший забег идёт в таблицу рекордов',
    ],
  },
  {
    id: 'warroom', tier: 'boss', tierLabel: 'БОСС · WAR ROOM',
    rune: '☼', name: 'Комната Войны',
    flavor: '« Продакшн упал. У вас 30 минут. » Вся гильдия — в огне.',
    duration: '30 МИН', difficulty: 5, difficultyLabel: 'Командная',
    xp: 400, penalty: 'Позор гильдии',
    companies: ['ОНКОЛЛ'],
    locked: 'ГИЛЬДИЯ LVL 3',
    mods: [
      'Каждый участник получает свой кусок инцидента',
      'Один — дебажит Go; другой — SQL; третий — архитектуру',
      'Оценивается командная коммуникация + скорость',
      'Провал отражается на рейтинге ВСЕЙ гильдии',
    ],
  },
  {
    id: 'cognitive', tier: 'hard', tierLabel: 'ТЯЖЁЛОЕ · COGNITIVE',
    rune: '✥', name: 'Когнитивная Нагрузка',
    flavor: 'Таймер сжимается. Ликтор задаёт вопросы пока пишешь. Требования меняются.',
    duration: '45 МИН', difficulty: 4, difficultyLabel: 'Жестокая',
    xp: 220, penalty: '—',
    companies: ['FAANG-СТИЛЬ'],
    mods: [
      'Нарастающие помехи по фазам',
      'Фаза 2: таймер ×½',
      'Фаза 3: параллельные вопросы от Ликтора',
      'Фаза 4: требования задачи меняются на ходу',
      'Итог: Cognitive Resilience Score',
    ],
  },
  {
    id: 'spectator', tier: 'normal', tierLabel: 'ОБЫЧНОЕ · SPECTATOR',
    rune: '◉', name: 'Режим Наблюдателя',
    flavor: 'Смотри как другой падает. Учись на его ошибках. Без риска.',
    duration: 'LIVE', difficulty: 1, difficultyLabel: 'Пассивная',
    xp: 20, penalty: '—',
    companies: ['ЛЮБАЯ ЛАЙВ'],
    mods: [
      'Смотри live-сессию другого игрока (с его разрешения)',
      'Можешь комментировать в чат после финала',
      'Понравилось — тип реакция идёт игроку в репутацию',
    ],
  },
  {
    id: 'boss-yandex', tier: 'boss', tierLabel: 'БОСС · YANDEX',
    rune: '♛', name: 'Башня Яндекса',
    flavor: 'Финальный босс. Три секции, один Ликтор. Без пауз. Без пощады.',
    duration: '90 МИН', difficulty: 5, difficultyLabel: 'Экстрим',
    xp: 600, penalty: 'Усталость 24ч',
    companies: ['ЯНДЕКС'],
    locked: 'LVL 30',
    mods: [
      'Три секции подряд: Algorithms → System Design → Behavioral',
      'Один Ликтор-Босс — с максимальным давлением',
      'Между секциями — только 5 минут',
      'Завершение разблокирует титул «Покоритель Башни»',
    ],
  },
  {
    id: 'dark-horse', tier: 'cursed', tierLabel: 'ПРОКЛЯТОЕ · DARK HORSE',
    rune: '☾', name: 'Тёмная Лошадка',
    flavor: 'Ты — без имени. Без ранга. Только твой код говорит за тебя.',
    duration: '45 МИН', difficulty: 3, difficultyLabel: 'Высокая',
    xp: 180, penalty: '—',
    companies: ['АНОНИМНАЯ АРЕНА'],
    locked: null,
    mods: [
      'Анонимный рейтинг параллельно основному',
      'Ни имени, ни гильдии — только код и ответы',
      'Если войдёшь в топ-100 — раскрытие = виральный момент',
      'Не влияет на основной ELO',
    ],
  },
];

Object.assign(window, { ForgeScreen });
