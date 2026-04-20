// Persistence helpers — хранят выборы онбординга, читаются хабом.
const CHAR_KEY = 'druz9.character';
function loadChar() {
  try { return JSON.parse(localStorage.getItem(CHAR_KEY) || '{}'); } catch { return {}; }
}
function saveChar(patch) {
  const next = { ...loadChar(), ...patch, updatedAt: Date.now() };
  try { localStorage.setItem(CHAR_KEY, JSON.stringify(next)); } catch {}
  return next;
}
function clearChar() { try { localStorage.removeItem(CHAR_KEY); } catch {} }

// Onboarding — 5-step character creation + first trial. Grimdark, cinematic.
function Onboarding() {
  const saved = loadChar();
  const [step, setStep] = React.useState(0);
  const [path, setPath] = React.useState(saved.path || null);
  const [answers, setAnswers] = React.useState(saved.answers || {});
  const [name, setName] = React.useState(saved.name || '');
  const [charClass, setCharClass] = React.useState(saved.charClass || 'arch');

  // Autosave every change
  React.useEffect(() => { saveChar({ path, answers, name, charClass, step }); }, [path, answers, name, charClass, step]);

  const steps = ['ПУТЬ', 'ОРАКУЛ', 'ПЕРСОНАЖ', 'КРЕЩЕНИЕ', 'СУДЬБА'];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-void)' }}>
      <OnboardHeader step={step} steps={steps} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 1100 }}>
          {step === 0 && <Step0 path={path} setPath={setPath} onNext={() => setStep(1)} />}
          {step === 1 && <Step1 answers={answers} setAnswers={setAnswers} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
          {step === 2 && <Step2 name={name} setName={setName} charClass={charClass} setCharClass={setCharClass} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <Step3 onNext={() => setStep(4)} />}
          {step === 4 && <Step4 name={name} charClass={charClass} />}
        </div>
      </div>
    </div>
  );
}

function OnboardHeader({ step, steps }) {
  return (
    <div style={{
      padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 20,
      background: 'linear-gradient(180deg, #14100e, #0a0706)',
      borderBottom: '1px solid var(--metal)',
    }}>
      <LogoMark size={26} />
      <div className="grow" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {steps.map((s, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <React.Fragment key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 900,
                  color: done ? '#041008' : active ? '#1a0d00' : 'var(--ink-dim)',
                  background: done ? 'var(--toxic-lit)' : active ? 'var(--ember-lit)' : 'var(--bg-inset)',
                  border: `1px solid ${done ? 'var(--toxic-lit)' : active ? 'var(--ember-bright)' : 'var(--metal)'}`,
                  clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                  boxShadow: active ? '0 0 8px var(--ember-lit)' : 'none',
                }}>{done ? '✓' : i + 1}</span>
                <span style={{
                  fontFamily: 'var(--font-code)', fontSize: 9, letterSpacing: '0.25em', fontWeight: 700,
                  color: done ? 'var(--toxic-lit)' : active ? 'var(--ember-bright)' : 'var(--ink-dim)',
                }}>{s}</span>
              </div>
              {i < steps.length - 1 && <div style={{ width: 20, height: 1, background: done ? 'var(--toxic-lit)' : 'var(--metal-dark)' }} />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="grow" />
      <a href="sanctum.html" style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>ПРОПУСТИТЬ →</a>
    </div>
  );
}

// -------- STEP 0 — path -------
function Step0({ path, setPath, onNext }) {
  const paths = [
    { k: 'hunt',   n: 'ОХОТА',         d: 'Я сейчас на рынке. Через месяц — оферы.', t: 'HUNT MODE', i: '⚔', c: 'var(--blood-lit)', desc: 'Быстрые мок-сражения, календарь интервью, фокус на слабых узлах.' },
    { k: 'train',  n: 'ТРЕНИРОВКА',    d: 'Учусь в долгую, 6-12 месяцев, без спешки.', t: 'LONG GAME', i: '⚙', c: 'var(--ember-lit)', desc: 'Дерево скиллов, ежедневные каты, свитки. Прогресс без дедлайнов.' },
    { k: 'champ',  n: 'ЧЕМПИОН',       d: 'Я хочу топ-10 Арены. Кровь и ELO.', t: 'РАНКЕДЫ', i: '♛', c: 'var(--rarity-rare)', desc: 'Арена 1v1, Война Гильдий, Royale, лидерборды.' },
    { k: 'mentor', n: 'НАСТАВНИК',      d: 'Я уже Senior. Хочу быть Ликтором для других.', t: 'REVIEWER', i: '☉', c: 'var(--rarity-magic)', desc: 'Мок-сессии как интервьюер, рейтинг Ликтора, доход.' },
  ];
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>ИНИЦИАЦИЯ · АКТ I</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 56, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 8, textShadow: '0 0 20px rgba(194,34,34,0.4)' }}>
          Зачем ты пришёл?
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--ember-lit)', letterSpacing: '0.15em', marginTop: 10, fontStyle: 'italic' }}>
          « Четыре двери. За каждой — своя кровь. »
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, maxWidth: 880, margin: '0 auto' }}>
        {paths.map(p => {
          const active = path === p.k;
          return (
            <button key={p.k} onClick={() => setPath(p.k)} style={{
              textAlign: 'left', padding: 20,
              background: active ? `linear-gradient(135deg, ${p.c}22, #0a0605)` : 'linear-gradient(135deg, #14100f, #0a0605)',
              border: `1px solid ${active ? p.c : 'var(--metal)'}`,
              boxShadow: active ? `0 0 20px ${p.c}44` : 'none',
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', gap: 16, alignItems: 'start',
            }}>
              <div style={{
                width: 60, height: 60, flexShrink: 0,
                background: active ? `linear-gradient(180deg, ${p.c}44, #0a0303)` : 'var(--bg-inset)',
                border: `1px solid ${p.c}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, color: p.c,
                clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                textShadow: active ? `0 0 10px ${p.c}` : 'none',
              }}>{p.i}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: p.c, letterSpacing: '0.3em', fontWeight: 700 }}>{p.t}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.08em', marginTop: 2 }}>{p.n}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ember-lit)', fontStyle: 'italic', marginTop: 4 }}>« {p.d} »</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', lineHeight: 1.5, marginTop: 8 }}>{p.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
        <button className="btn btn-blood" disabled={!path}
          onClick={onNext}
          style={{ padding: '14px 36px', fontSize: 13, letterSpacing: '0.2em', opacity: path ? 1 : 0.4, cursor: path ? 'pointer' : 'not-allowed' }}>
          ПРОЙТИ ОРАКУЛ →
        </button>
      </div>
    </div>
  );
}

// -------- STEP 1 — oracle -------
function Step1({ answers, setAnswers, onNext, onBack }) {
  const [qi, setQi] = React.useState(0);
  const questions = [
    {
      q: 'Какого зверя ты встречаешь в первую очередь?',
      hint: 'мы калибруем стартовую сложность',
      opts: [
        { k: 'a', t: 'LeetCode Medium за 25 минут', v: '4/5', c: '#6a9fd4' },
        { k: 'b', t: 'Системный дизайн Twitter', v: '3/5', c: '#7F77DD' },
        { k: 'c', t: 'Behavioral — расскажи о конфликте', v: '4/5', c: '#1D9E75' },
        { k: 'd', t: 'SQL — окна и агрегаты', v: '2/5', c: '#639922' },
      ],
    },
    {
      q: 'Сколько часов в неделю ты готов ковать?',
      hint: 'меньше времени ≠ меньше результат',
      opts: [
        { k: 'a', t: '3-5 часов · мягко', v: 'MEDIC', c: 'var(--toxic-lit)' },
        { k: 'b', t: '7-10 часов · системно', v: 'STANDARD', c: 'var(--ember-lit)' },
        { k: 'c', t: '12+ часов · БЕСПОЩАДНО', v: 'HARDCORE', c: 'var(--blood-lit)' },
        { k: 'd', t: 'Не знаю, пусть Ликтор решит', v: 'ADAPTIVE', c: 'var(--rarity-magic)' },
      ],
    },
    {
      q: 'Где ты падаешь чаще всего?',
      hint: 'честность — снятие заклятия',
      opts: [
        { k: 'a', t: 'Замолкаю под давлением', v: 'ТИШИНА', c: 'var(--blood-lit)' },
        { k: 'b', t: 'Начинаю код, не поняв scope', v: 'СПЕШКА', c: 'var(--ember-lit)' },
        { k: 'c', t: 'Теряюсь в System Design', v: 'ХАОС', c: '#7F77DD' },
        { k: 'd', t: 'Не умею продавать себя', v: 'СМИРЕНИЕ', c: '#1D9E75' },
      ],
    },
    {
      q: 'Какая компания — твой Дракон?',
      hint: 'финальный босс сезона',
      opts: [
        { k: 'a', t: 'FAANG · MAANG', v: 'ЛЕВИАФАН', c: 'var(--rarity-unique)' },
        { k: 'b', t: 'Яндекс · Ozon · VK', v: 'ВОСТОЧНЫЙ ДРАКОН', c: 'var(--blood-lit)' },
        { k: 'c', t: 'Стартап seed-A', v: 'ГРИФОН', c: 'var(--ember-lit)' },
        { k: 'd', t: 'Стабильность > престиж', v: 'СТРАЖ', c: 'var(--ink-bright)' },
      ],
    },
    {
      q: 'Что ты принесёшь в Гильдию?',
      hint: 'ни один ликтор не бьётся в одиночку',
      opts: [
        { k: 'a', t: 'Код-ревью как мечи', v: 'КРИТИК', c: 'var(--blood-lit)' },
        { k: 'b', t: 'Объясняю сложное', v: 'МЕНТОР', c: 'var(--ember-lit)' },
        { k: 'c', t: 'Пишу лучший решебник', v: 'ЛЕТОПИСЕЦ', c: 'var(--rarity-gem)' },
        { k: 'd', t: 'Заражаю мотивацией', v: 'ЗНАМЕНОСЕЦ', c: 'var(--toxic-lit)' },
      ],
    },
  ];
  const q = questions[qi];
  const done = answers[qi];
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>
          ОРАКУЛ · ВОПРОС {qi + 1} / {questions.length}
        </div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 42, color: 'var(--ink-bright)', lineHeight: 1.1, marginTop: 10, maxWidth: 800, margin: '10px auto 0' }}>
          {q.q}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ember-lit)', fontStyle: 'italic', marginTop: 8 }}>« {q.hint} »</div>
      </div>
      {/* Progress beads */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 30 }}>
        {questions.map((_, i) => (
          <div key={i} style={{
            width: 12, height: 12,
            background: i < qi ? 'var(--toxic-lit)' : i === qi ? 'var(--ember-bright)' : 'var(--bg-inset)',
            border: `1px solid ${i <= qi ? 'var(--ember)' : 'var(--metal)'}`,
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 820, margin: '0 auto' }}>
        {q.opts.map(opt => {
          const active = done === opt.k;
          return (
            <button key={opt.k}
              onClick={() => setAnswers({ ...answers, [qi]: opt.k })}
              style={{
                textAlign: 'left', padding: '14px 18px',
                background: active ? `linear-gradient(90deg, ${opt.c}22, #0a0605)` : '#14100f',
                border: `1px solid ${active ? opt.c : 'var(--metal)'}`,
                display: 'flex', alignItems: 'center', gap: 14,
                cursor: 'pointer',
              }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0,
                border: `1px solid ${opt.c}`,
                background: active ? opt.c : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900,
                color: active ? '#000' : opt.c,
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
              }}>{opt.k.toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.04em' }}>{opt.t}</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: opt.c, letterSpacing: '0.2em', marginTop: 2, fontWeight: 700 }}>{opt.v}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32 }}>
        <button className="btn btn-ghost" onClick={qi === 0 ? onBack : () => setQi(qi - 1)} style={{ padding: '12px 22px', fontSize: 11 }}>← НАЗАД</button>
        <button className="btn btn-blood" disabled={!done}
          onClick={() => qi < questions.length - 1 ? setQi(qi + 1) : onNext()}
          style={{ padding: '12px 30px', fontSize: 12, letterSpacing: '0.2em', opacity: done ? 1 : 0.4 }}>
          {qi < questions.length - 1 ? 'ДАЛЕЕ →' : 'СОЗДАТЬ ПЕРСОНАЖА →'}
        </button>
      </div>
    </div>
  );
}

// -------- STEP 2 — character creation -------
function Step2({ name, setName, charClass, setCharClass, onNext, onBack }) {
  const classes = [
    { k: 'alg',  n: 'АЛГОРИТМИСТ', c: '#6a9fd4', t: 'LeetCode · DP · графы', stats: { int: 9, dex: 7, str: 5 }, icon: '⚙' },
    { k: 'dba',  n: 'DBA·ЖРЕЦ',    c: '#639922', t: 'SQL · индексы · планы', stats: { int: 7, dex: 5, str: 9 }, icon: '⊟' },
    { k: 'back', n: 'БЭКЕНД-ВОИН', c: '#EF9F27', t: 'Go · сети · concurrency', stats: { int: 6, dex: 8, str: 8 }, icon: '⬡' },
    { k: 'arch', n: 'АРХИТЕКТОР',  c: '#7F77DD', t: 'Дистриб · CAP · HLD', stats: { int: 10, dex: 6, str: 6 }, icon: '◈' },
    { k: 'comm', n: 'БЕХАВ·МАГ',   c: '#1D9E75', t: 'STAR · narrative · leadership', stats: { int: 7, dex: 10, str: 4 }, icon: '☉' },
    { k: 'ai',   n: 'AI-АПОСТАТ',  c: '#c22222', t: 'LLM · prompts · agents', stats: { int: 10, dex: 8, str: 5 }, icon: '☠' },
  ];
  const selected = classes.find(c => c.k === charClass);
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>АКТ III · СОТВОРЕНИЕ</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 48, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 8, textShadow: '0 0 20px rgba(194,34,34,0.4)' }}>
          Назовись, ликтор.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, maxWidth: 1000, margin: '0 auto' }}>
        {/* Character preview */}
        <div style={{ padding: 20, background: 'linear-gradient(180deg, #1a0808, #0a0303)', border: `1px solid ${selected.c}` }}>
          <div style={{ position: 'relative', width: 220, height: 220, margin: '0 auto' }}>
            <CharacterPortrait size={220} name={name || 'NAMELESS'} cls={selected.n} level={1} />
            <div style={{ position: 'absolute', top: 8, right: 8, padding: '4px 10px', background: `${selected.c}44`, border: `1px solid ${selected.c}`, fontFamily: 'var(--font-code)', fontSize: 9, color: selected.c, letterSpacing: '0.2em', fontWeight: 700 }}>
              {selected.icon} {selected.n}
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.25em', marginBottom: 6 }}>ИМЯ ЛИКТОРА</div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="твоё имя…"
              style={{
                width: '100%', padding: '10px 12px', background: 'var(--bg-inset)',
                border: '1px solid var(--metal-lit)',
                fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--ember-bright)',
                letterSpacing: '0.1em', fontWeight: 700, textAlign: 'center', outline: 'none',
              }} />
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.25em', marginBottom: 6 }}>СТАРТОВЫЕ ХАРАКТЕРИСТИКИ</div>
            {[
              { k: 'int', n: 'ИНТЕЛЛЕКТ', c: '#6a9fd4' },
              { k: 'dex', n: 'ГИБКОСТЬ',  c: '#1D9E75' },
              { k: 'str', n: 'СТОЙКОСТЬ', c: '#c22222' },
            ].map(s => (
              <div key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: s.c, letterSpacing: '0.15em', width: 90, fontWeight: 700 }}>{s.n}</span>
                <div style={{ flex: 1, display: 'flex', gap: 2 }}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} style={{ flex: 1, height: 8, background: i < selected.stats[s.k] ? s.c : 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }} />
                  ))}
                </div>
                <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: s.c, fontWeight: 700, width: 20, textAlign: 'right' }}>{selected.stats[s.k]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Class grid */}
        <div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', letterSpacing: '0.3em', fontWeight: 700, marginBottom: 10 }}>ВЫБЕРИ КЛАСС</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {classes.map(c => {
              const active = c.k === charClass;
              return (
                <button key={c.k} onClick={() => setCharClass(c.k)} style={{
                  padding: 12,
                  background: active ? `linear-gradient(180deg, ${c.c}22, #0a0605)` : '#14100f',
                  border: `1px solid ${active ? c.c : 'var(--metal)'}`,
                  boxShadow: active ? `0 0 14px ${c.c}44` : 'none',
                  textAlign: 'center', cursor: 'pointer',
                }}>
                  <div style={{ fontSize: 28, color: c.c, lineHeight: 1 }}>{c.icon}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: active ? 'var(--ink-bright)' : 'var(--ink-mid)', fontWeight: 700, letterSpacing: '0.08em', marginTop: 6 }}>{c.n}</div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: c.c, letterSpacing: '0.1em', marginTop: 3, fontWeight: 600 }}>{c.t}</div>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>РЕКОМЕНДАЦИЯ ЛИКТОРА</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 6, fontStyle: 'italic' }}>
              « Судя по твоим ответам, <span style={{ color: 'var(--ink-bright)', fontStyle: 'normal', fontWeight: 700 }}>АРХИТЕКТОР</span> близок тебе по крови.
              Но класс — не клетка. Переродиться можно после 10 уровня. »
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 32 }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: '12px 22px', fontSize: 11 }}>← НАЗАД</button>
        <button className="btn btn-blood" disabled={!name.trim()}
          onClick={onNext}
          style={{ padding: '12px 30px', fontSize: 12, letterSpacing: '0.2em', opacity: name.trim() ? 1 : 0.4 }}>
          {name.trim() ? 'В ПЕРВЫЙ БОЙ →' : 'ВВЕДИ ИМЯ'}
        </button>
      </div>
    </div>
  );
}

// -------- STEP 3 — first trial -------
function Step3({ onNext }) {
  const [stage, setStage] = React.useState(0); // 0 intro, 1 combat (fake running), 2 complete
  React.useEffect(() => {
    if (stage === 1) {
      const t = setTimeout(() => setStage(2), 3000);
      return () => clearTimeout(t);
    }
  }, [stage]);

  if (stage === 0) {
    return (
      <div>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--blood-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>АКТ IV · КРЕЩЕНИЕ КРОВЬЮ</div>
          <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 48, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 8, textShadow: '0 0 24px rgba(194,34,34,0.5)' }}>
            Первое Подземелье
          </div>
        </div>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: 24, background: 'linear-gradient(180deg, #1a0808, #0a0303)', border: '1px solid var(--blood)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 18, alignItems: 'center' }}>
            <div style={{ width: 140, height: 140, background: 'radial-gradient(circle, #3a0909, #0a0303)', border: '2px solid var(--blood-lit)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72, color: 'var(--blood-bright)', textShadow: '0 0 20px var(--blood-bright)', clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}>☠</div>
            <div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>ТУТОРИАЛ-МОК · 20 МИНУТ</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.05em', marginTop: 4 }}>Двуглавый Массив</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
                « Ликтор-Нулевой задаст один вопрос: <span style={{ color: 'var(--ink-bright)', fontStyle: 'normal', fontWeight: 700 }}>two-sum</span>.
                Не главное — решить. Главное — <span style={{ color: 'var(--ember-bright)', fontStyle: 'normal', fontWeight: 700 }}>думать вслух</span>. Он всё услышит. »
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 12, fontFamily: 'var(--font-code)', fontSize: 10 }}>
                <span style={{ color: 'var(--ember-lit)' }}>+80 XP гарантировано</span>
                <span style={{ color: 'var(--rarity-gem)' }}>+1 свиток</span>
                <span style={{ color: 'var(--blood-lit)' }}>нельзя провалить</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
          <button className="btn btn-blood" onClick={() => setStage(1)} style={{ padding: '16px 44px', fontSize: 14, letterSpacing: '0.25em', fontWeight: 800 }}>
            ⚔ ВОЙТИ В ПОДЗЕМЕЛЬЕ
          </button>
        </div>
      </div>
    );
  }

  if (stage === 1) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 32, color: 'var(--blood-lit)', textShadow: '0 0 20px var(--blood-bright)', animation: 'pulse 1s infinite' }}>
          ⚔ БОЙ ИДЁТ ⚔
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ember-lit)', letterSpacing: '0.2em', marginTop: 20, fontStyle: 'italic' }}>
          « Ликтор слушает твой голос… »
        </div>
        <div style={{ width: 400, margin: '30px auto 0', height: 8, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, var(--blood-bright), transparent)', animation: 'slide 1.5s linear infinite' }} />
        </div>
        <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--toxic-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>ПОДЗЕМЕЛЬЕ ПРОЙДЕНО</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 56, color: 'var(--ember-bright)', textShadow: '0 0 24px rgba(245,197,107,0.5)', marginTop: 6 }}>
          ✦ VICTORIA ✦
        </div>
      </div>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 20, background: 'linear-gradient(180deg, #14100f, #0a0605)', border: '1px solid var(--ember)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>ВЕРДИКТ ЛИКТОРА-НУЛЕВОГО</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-mid)', lineHeight: 1.6, marginTop: 10, fontStyle: 'italic' }}>
          « Ты <span style={{ color: 'var(--toxic-lit)', fontStyle: 'normal', fontWeight: 700 }}>думал вслух</span> на 72%.
          Hash-подход нашёл за 2 минуты — сильная интуиция. Пропустил уточнение про дубликаты.
          Это <span style={{ color: 'var(--blood-lit)', fontStyle: 'normal', fontWeight: 700 }}>известная слабость</span> —
          уже записал её в твоё дерево. »
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
          {[
            { l: 'ТОЧНОСТЬ', v: '88%', c: 'var(--toxic-lit)' },
            { l: 'ТЕМП', v: '9/10', c: 'var(--ember-lit)' },
            { l: 'ГОЛОС', v: '72%', c: 'var(--ember-lit)' },
            { l: 'XP', v: '+120', c: 'var(--ember-bright)' },
          ].map(s => (
            <div key={s.l} className="inset-groove" style={{ padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.2em' }}>{s.l}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: s.c, fontWeight: 700 }}>{s.v}</div>
            </div>
          ))}
        </div>
        {/* Loot */}
        <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)' }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--rarity-rare)', letterSpacing: '0.25em', fontWeight: 700 }}>ДОБЫЧА</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {[
              { i: '◈', n: 'Перо Ликтора', c: 'var(--rarity-magic)', sub: '+2 к Голосу' },
              { i: '✦', n: 'Свиток Two-Pointers', c: 'var(--rarity-rare)', sub: 'в Кодекс' },
              { i: '⬢', n: '3 гема', c: 'var(--rarity-gem)', sub: 'казна' },
            ].map((it, i) => (
              <div key={i} style={{ flex: 1, padding: 10, background: '#14100f', border: `1px solid ${it.c}`, textAlign: 'center' }}>
                <div style={{ fontSize: 22, color: it.c }}>{it.i}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: it.c, fontWeight: 700, marginTop: 4 }}>{it.n}</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 2 }}>{it.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
        <button className="btn btn-ember" onClick={onNext} style={{ padding: '14px 36px', fontSize: 13, letterSpacing: '0.2em', fontWeight: 800 }}>
          ПРИНЯТЬ СУДЬБУ →
        </button>
      </div>
    </div>
  );
}

// -------- STEP 4 — fate -------
function Step4({ name, charClass }) {
  const displayName = name || 'Безымянный';
  // Mark onboarding complete + stash XP/loot from trial
  React.useEffect(() => {
    saveChar({
      completed: true,
      level: 1,
      xp: 120,
      scrolls: ['two-pointers'],
      gems: 3,
      relics: ['pero-liktora'],
      joinedAt: Date.now(),
    });
  }, []);
  const nextActs = [
    { k: 'sanctum', n: 'Святилище', d: 'твой хаб · экипировка · трайалы', href: 'sanctum.html', c: 'var(--ember-bright)', i: '⬢' },
    { k: 'skills',  n: 'Дерево Скиллов', d: '218 узлов · 1 на старт', href: 'skills.html', c: '#7F77DD', i: '◈' },
    { k: 'forge',   n: 'Кузня Испытаний', d: '15 режимов мок-боя', href: 'forge.html', c: '#EF9F27', i: '⚔' },
    { k: 'guild',   n: 'Найти Гильдию', d: 'один ликтор — мёртвый ликтор', href: 'guild.html', c: 'var(--blood-lit)', i: '⚯' },
  ];
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ember-lit)', letterSpacing: '0.4em', fontWeight: 700 }}>АКТ V · СУДЬБА ОТКРЫТА</div>
        <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 52, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 8, textShadow: '0 0 20px rgba(224,155,58,0.5)' }}>
          Добро пожаловать, <span style={{ color: 'var(--ember-bright)' }}>{displayName}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--blood-lit)', letterSpacing: '0.2em', marginTop: 10, fontStyle: 'italic' }}>
          « Ты в Кровь·IX. Сезон II. 147 дней до финала. »
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {nextActs.map(a => (
          <a key={a.k} href={a.href} style={{
            padding: 16, display: 'flex', alignItems: 'center', gap: 14,
            background: 'linear-gradient(90deg, #14100f, #0a0605)',
            border: `1px solid ${a.c}44`, textDecoration: 'none',
          }}>
            <div style={{
              width: 48, height: 48, flexShrink: 0,
              background: `linear-gradient(180deg, ${a.c}22, #0a0303)`,
              border: `1px solid ${a.c}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: a.c,
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            }}>{a.i}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.05em' }}>{a.n}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 2 }}>{a.d}</div>
            </div>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 16, color: a.c }}>→</span>
          </a>
        ))}
      </div>

      <div style={{ maxWidth: 820, margin: '30px auto 0', padding: 16, background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.25em', fontWeight: 700 }}>⏳ ЕЖЕДНЕВНОЕ ОБЕЩАНИЕ</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-bright)', lineHeight: 1.5, marginTop: 8, fontStyle: 'italic' }}>
          « 1 мок-бой в день. 15 минут. Этого достаточно, чтобы дерево не умерло. »
        </div>
        <button className="btn btn-ember" style={{ marginTop: 12, padding: '10px 24px', fontSize: 11, letterSpacing: '0.2em' }}>⊕ ПРИНЯТЬ ОБЕЩАНИЕ</button>
      </div>
    </div>
  );
}

Object.assign(window, { Onboarding });
