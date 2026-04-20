// Settings — как настройки в PoE: плотные секции, без воздуха, всё видно сразу.
function SettingsScreen() {
  const [tab, setTab] = React.useState('combat');
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
      <SideTabs tab={tab} onTab={setTab} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {tab === 'combat' && <CombatSection />}
        {tab === 'liktor' && <LiktorSection />}
        {tab === 'calendar' && <CalendarSection />}
        {tab === 'privacy' && <PrivacySection />}
        {tab === 'audio' && <AudioSection />}
        {tab === 'danger' && <DangerSection />}
      </div>
    </div>
  );
}

function SideTabs({ tab, onTab }) {
  const items = [
    { k: 'combat',   i: '⚔', t: 'Боевой режим',    sub: 'pacing · паника · каты' },
    { k: 'liktor',   i: '☠', t: 'Ликтор',          sub: 'тон · жёсткость · голос' },
    { k: 'calendar', i: '☉', t: 'Календарь',       sub: 'часовой пояс · окна' },
    { k: 'privacy',  i: '◐', t: 'Приватность',     sub: 'резюме · гильдия · запись' },
    { k: 'audio',    i: '♪', t: 'Звук и тема',     sub: 'глухой зал · lanterns' },
    { k: 'danger',   i: '✕', t: 'Опасная зона',    sub: 'удалить · экспорт' },
  ];
  return (
    <div className="panel" style={{ padding: 0, alignSelf: 'flex-start', position: 'sticky', top: 76 }}>
      <div className="panel-head"><span className="ornament">❂</span> Настройки</div>
      <div>
        {items.map(it => {
          const active = it.k === tab;
          return (
            <button key={it.k} onClick={() => onTab(it.k)} style={{
              display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, width: '100%',
              padding: '10px 12px', background: active ? 'linear-gradient(90deg, rgba(138,20,20,0.25), transparent)' : 'transparent',
              border: 'none', borderLeft: active ? '2px solid var(--blood-lit)' : '2px solid transparent',
              borderBottom: '1px solid var(--metal-dark)', textAlign: 'left', cursor: 'pointer',
              color: active ? 'var(--ink-bright)' : 'var(--ink-mid)',
            }}>
              <span style={{ fontSize: 14, color: active ? 'var(--ember-bright)' : 'var(--ink-dim)', textAlign: 'center' }}>{it.i}</span>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>{it.t}</div>
                <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 2 }}>{it.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionCard({ title, ornament = '◈', children }) {
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">{ornament}</span> {title}</div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function Row({ t, d, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, padding: '12px 0', borderBottom: '1px solid var(--metal-dark)', alignItems: 'center' }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.04em' }}>{t}</div>
        {d && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 3, lineHeight: 1.45 }}>{d}</div>}
      </div>
      <div style={{ justifySelf: 'end' }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, onLabel = 'ВКЛ', offLabel = 'ВЫКЛ' }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 90, height: 28, position: 'relative', background: on ? 'linear-gradient(180deg, #2a0808, #5a1414)' : '#0a0605',
      border: `1px solid ${on ? 'var(--blood-lit)' : 'var(--metal)'}`, cursor: 'pointer',
      fontFamily: 'var(--font-code)', fontSize: 9, fontWeight: 700, letterSpacing: '0.25em',
      color: on ? 'var(--ember-bright)' : 'var(--ink-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: on ? 'inset 0 0 10px rgba(194,34,34,0.4)' : 'inset 0 1px 3px rgba(0,0,0,0.8)',
    }}>{on ? onLabel : offLabel}</button>
  );
}

function Segmented({ value, onChange, opts }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--metal)', background: 'var(--bg-inset)' }}>
      {opts.map((o, i) => {
        const active = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            padding: '6px 12px', fontFamily: 'var(--font-code)', fontSize: 10, letterSpacing: '0.15em', fontWeight: 700,
            background: active ? 'linear-gradient(180deg, #3a1a08, #1a0804)' : 'transparent',
            border: 'none', borderRight: i < opts.length - 1 ? '1px solid var(--metal)' : 'none',
            color: active ? 'var(--ember-bright)' : 'var(--ink-mid)', cursor: 'pointer',
          }}>{o.l}</button>
        );
      })}
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 100, suffix = '' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 240 }}>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)}
        style={{ flex: 1, accentColor: 'var(--blood-lit)' }} />
      <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-bright)', fontWeight: 700, minWidth: 52, textAlign: 'right' }}>{value}{suffix}</span>
    </div>
  );
}

function CombatSection() {
  const [panic, setPanic] = React.useState(true);
  const [intensity, setIntensity] = React.useState('standard');
  const [katas, setKatas] = React.useState(3);
  const [speed, setSpeed] = React.useState(100);
  return (
    <>
      <SectionCard title="Боевой режим" ornament="⚔">
        <Row t="Детектор паники" d="Отслеживает ускорение речи, молчание >8 сек, заикание. Мягко подсказывает «вдох»."><Toggle on={panic} onChange={setPanic} /></Row>
        <Row t="Жёсткость мок-боя" d="Calm — ровный ликтор. Standard — как в реальном интервью. Nightmare — с follow-up, подначками, прерываниями.">
          <Segmented value={intensity} onChange={setIntensity} opts={[{v:'calm',l:'CALM'},{v:'standard',l:'STD'},{v:'nightmare',l:'★ NIGHTMARE'}]} />
        </Row>
        <Row t="Ежедневная ката" d="Сколько заданий в Daily Kata. Больше — выше прогресс, но и вероятность пропустить."><Slider value={katas} onChange={setKatas} min={1} max={5} suffix=" / день" /></Row>
        <Row t="Скорость Ликтора" d="100% — естественная речь. Увеличить, если тренируешься к быстрым собесам."><Slider value={speed} onChange={setSpeed} min={70} max={150} suffix="%" /></Row>
      </SectionCard>

      <SectionCard title="Автопилот" ornament="◉">
        <Row t="Авто-отклики" d="Ликтор сам шлёт CV на релевантные вакансии из Атласа. Ты одобряешь вручную перед отправкой."><Toggle on={false} onChange={() => {}} /></Row>
        <Row t="Ночной разбор" d="Автоматический autopsy спустя 2 часа после любого реального интервью (если загружена запись)."><Toggle on={true} onChange={() => {}} /></Row>
      </SectionCard>
    </>
  );
}

function LiktorSection() {
  const [tone, setTone] = React.useState('severe');
  const [voice, setVoice] = React.useState('nikhil');
  const [lang, setLang] = React.useState('ru-en');
  return (
    <>
      <SectionCard title="Личность Ликтора" ornament="☠">
        <Row t="Тон голоса" d="Severe — холодно, без жалости. Coach — тепло, но требовательно. Brother — как старший друг.">
          <Segmented value={tone} onChange={setTone} opts={[{v:'severe',l:'SEVERE'},{v:'coach',l:'COACH'},{v:'brother',l:'BROTHER'}]} />
        </Row>
        <Row t="Голос" d="Синтезированные голоса реальных старших инженеров с их разрешения.">
          <select value={voice} onChange={e => setVoice(e.target.value)} style={{
            padding: '6px 10px', background: 'var(--bg-inset)', border: '1px solid var(--metal)',
            color: 'var(--ink-bright)', fontFamily: 'var(--font-code)', fontSize: 11, width: 240
          }}>
            <option value="nikhil">Nikhil K. · VK · 18 лет</option>
            <option value="anna">Анна С. · Тинькофф · 14 лет</option>
            <option value="dima">Дима Л. · Авито · 11 лет</option>
            <option value="custom">✦ Загрузить свой голос</option>
          </select>
        </Row>
        <Row t="Язык боя" d="Ru-En — гибрид: вопросы на русском, термины и код на английском.">
          <Segmented value={lang} onChange={setLang} opts={[{v:'ru',l:'РУС'},{v:'ru-en',l:'RU · EN'},{v:'en',l:'ENG'}]} />
        </Row>
        <Row t="Имя в бою" d="Как Ликтор обращается к тебе в моках.">
          <input defaultValue="Алексей" style={{
            padding: '6px 10px', background: 'var(--bg-inset)', border: '1px solid var(--metal)',
            color: 'var(--ink-bright)', fontFamily: 'var(--font-body)', fontSize: 12, width: 240
          }} />
        </Row>
      </SectionCard>
    </>
  );
}

function CalendarSection() {
  return (
    <>
      <SectionCard title="Календарь и Часы" ornament="☉">
        <Row t="Часовой пояс" d="Для расписания интервью и расчёта Дня Падения.">
          <select style={{ padding: '6px 10px', background: 'var(--bg-inset)', border: '1px solid var(--metal)', color: 'var(--ink-bright)', fontFamily: 'var(--font-code)', fontSize: 11, width: 240 }}>
            <option>Europe/Moscow · UTC+3</option>
            <option>Europe/Berlin · UTC+1</option>
            <option>Asia/Almaty · UTC+5</option>
            <option>Asia/Dubai · UTC+4</option>
          </select>
        </Row>
        <Row t="Окна тренировок" d="Когда Ликтор может назначать моки без спроса.">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map((d, i) => (
              <span key={d} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: i < 5 ? 'linear-gradient(180deg, #3a1a08, #1a0804)' : 'var(--bg-inset)',
                border: `1px solid ${i < 5 ? 'var(--ember)' : 'var(--metal-dark)'}`,
                fontFamily: 'var(--font-code)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                color: i < 5 ? 'var(--ember-bright)' : 'var(--ink-dim)', cursor: 'pointer' }}>{d}</span>
            ))}
          </div>
        </Row>
        <Row t="Часы тишины" d="19:00 — 08:00. Ни уведомлений, ни Ликтора.">
          <Toggle on={true} onChange={() => {}} />
        </Row>
        <Row t="Синхронизация" d="iCal / Google / FastMail — двусторонняя.">
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ padding: '4px 10px', background: '#0a1a08', border: '1px solid var(--toxic-lit)', fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--toxic-lit)', letterSpacing: '0.2em', fontWeight: 700 }}>iCAL ✓</span>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 9 }}>+ GOOGLE</button>
          </div>
        </Row>
      </SectionCard>
    </>
  );
}

function PrivacySection() {
  return (
    <>
      <SectionCard title="Приватность и видимость" ornament="◐">
        <Row t="Публичный профиль" d="druz9.com/u/volkov — доступен без регистрации. Виден скиллам, гильдии, убитым драконам."><Toggle on={true} onChange={() => {}} /></Row>
        <Row t="Показывать пораж." d="Кладбище ликторов — 7 падений. Показывать ли миру?"><Toggle on={true} onChange={() => {}} /></Row>
        <Row t="Показывать зарплаты" d="В убитых драконах рядом с компанией. Многие прячут — это нормально."><Toggle on={false} onChange={() => {}} /></Row>
        <Row t="Запись мок-боёв" d="Аудио + транскрипт. Храним 60 дней, потом удаляем."><Toggle on={true} onChange={() => {}} /></Row>
        <Row t="Гильдия видит autopsy" d="Твои разборы собесов доступны гильдии целиком."><Toggle on={false} onChange={() => {}} /></Row>
        <Row t="Анонимизировать компании" d="В публичных autopsy заменить 'VK' на 'FAANG-класса соцсеть РФ'."><Toggle on={false} onChange={() => {}} /></Row>
      </SectionCard>
    </>
  );
}

function AudioSection() {
  const [vol, setVol] = React.useState(70);
  const [theme, setTheme] = React.useState('obsidian');
  return (
    <>
      <SectionCard title="Звук" ornament="♪">
        <Row t="Громкость Ликтора" d=""><Slider value={vol} onChange={setVol} /></Row>
        <Row t="Глухой зал" d="Эмбиент катакомб во время мок-боёв. Глуховато, сыро, далёкие капли."><Toggle on={true} onChange={() => {}} /></Row>
        <Row t="Звуки интерфейса" d="Удары, лязг, зажигание свечей. Можно выключить в опен-спейсе."><Toggle on={true} onChange={() => {}} /></Row>
      </SectionCard>
      <SectionCard title="Тема" ornament="◆">
        <Row t="Фитиль" d="Obsidian — чёрный с углями. Crypt — пыльный серый с кровью. Ember Dawn — тёплый закат.">
          <Segmented value={theme} onChange={setTheme} opts={[{v:'obsidian',l:'OBSIDIAN'},{v:'crypt',l:'CRYPT'},{v:'ember',l:'EMBER'}]} />
        </Row>
        <Row t="Уменьшить движение" d="Меньше свечей-мерцаний, парящих пылинок. Для эпилепсии и производительности."><Toggle on={(()=>{try{return localStorage.getItem('druz9.motion')==='off'}catch{return false}})()} onChange={(v) => { try { localStorage.setItem('druz9.motion', v ? 'off' : 'on'); document.documentElement.dataset.motion = v ? 'off' : ''; } catch {} }} /></Row>
        <Row t="Плотность интерфейса" d="Compact — всё на экране, как в PoE. Relaxed — больше воздуха.">
          <Segmented value="compact" onChange={() => {}} opts={[{v:'compact',l:'COMPACT'},{v:'relaxed',l:'RELAXED'}]} />
        </Row>
      </SectionCard>
    </>
  );
}

function DangerSection() {
  return (
    <>
      <SectionCard title="Опасная Зона" ornament="✕">
        <Row t="Экспорт всего" d="Скиллы, autopsy, записи, резюме — в .zip. Имеешь право знать, что мы о тебе храним.">
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10 }}>◈ СКАЧАТЬ АРХИВ</button>
        </Row>
        <Row t="Сбросить навыки" d="Переразложить points в дереве. Один раз бесплатно, потом 50 гемов.">
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10, color: 'var(--ember-bright)', borderColor: 'var(--ember)' }}>⚡ РЕСПЕК</button>
        </Row>
        <Row t="Выйти из гильдии" d="Гильдия «Цитадель Севера» · 47 бойцов. Кулдаун 14 дней на вступление в новую.">
          <button className="btn btn-blood" style={{ padding: '8px 14px', fontSize: 10 }}>✕ ПОКИНУТЬ</button>
        </Row>
        <Row t="Удалить аккаунт" d="Навсегда. Публичный профиль, autopsy, гильдийный вклад — всё уходит. 30 дней grace period.">
          <button style={{
            padding: '8px 14px', background: 'linear-gradient(180deg, #5a0808, #2a0303)',
            border: '1px solid var(--blood-bright)', color: 'var(--ink-bright)',
            fontFamily: 'var(--font-code)', fontSize: 10, letterSpacing: '0.25em', fontWeight: 700, cursor: 'pointer',
            boxShadow: 'inset 0 0 12px rgba(232,56,56,0.3)',
          }}>☠ УДАЛИТЬ НАВСЕГДА</button>
        </Row>
      </SectionCard>

      <div style={{ padding: '12px 14px', background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-dim)', fontStyle: 'italic', lineHeight: 1.5 }}>
        « Договор с DRUZ·IX — добровольный. Ты в любой момент можешь забрать свои данные и уйти. Мы не заложник твоего страха собесов. »
      </div>
    </>
  );
}

Object.assign(window, { SettingsScreen });
