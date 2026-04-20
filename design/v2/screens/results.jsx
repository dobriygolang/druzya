// Results — после реального интервью. 3 режима: offer / loss / autopsy.
function ResultsScreen({ mode = 'autopsy' }) {
  return (
    <div data-stagger style={{ padding: '18px 20px 120px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ResultsHero mode={mode} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <AutopsyTimeline />
          <WhatWentWrong />
          <LikTorVerdict mode={mode} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Loot mode={mode} />
          <NextStep mode={mode} />
          <RitualPanel mode={mode} />
        </div>
      </div>
    </div>
  );
}

function ResultsHero({ mode }) {
  const cfg = {
    offer: { t: 'ОФЕР · ПОБЕДА', sub: 'Ozon · Senior Backend · 480k', c: 'var(--ember-bright)', bg: 'linear-gradient(180deg, #3a2a10 0%, #1a0d04 60%, #0a0605 100%)', glow: 'rgba(245,197,107,0.5)', title: 'VICTORIA', icon: '♛' },
    loss:  { t: 'ПАДЕНИЕ · ПОРАЖЕНИЕ', sub: 'Яндекс · System Design 2 · отказ', c: 'var(--blood-bright)', bg: 'linear-gradient(180deg, #1a0808 0%, #0a0303 100%)', glow: 'rgba(232,56,56,0.4)', title: 'MORS', icon: '☠' },
    autopsy: { t: 'АУТОПСИЯ · РАЗБОР БОЯ', sub: 'VK · Backend Tech · 2 часа назад', c: 'var(--rarity-magic)', bg: 'linear-gradient(180deg, #1a1028 0%, #080410 100%)', glow: 'rgba(136,136,255,0.3)', title: 'POST MORTEM', icon: '☉' },
  }[mode];
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: cfg.bg, border: `1px solid ${cfg.c}`, padding: '24px 28px' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 0%, ${cfg.glow}, transparent 50%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '100px 1fr auto', gap: 20, alignItems: 'center' }}>
        <div style={{ width: 100, height: 100, background: `radial-gradient(circle, ${cfg.c}44, #0a0303)`, border: `2px solid ${cfg.c}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52, color: cfg.c, textShadow: `0 0 20px ${cfg.c}`, clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}>{cfg.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: cfg.c, letterSpacing: '0.35em', fontWeight: 700 }}>{cfg.t}</div>
          <div style={{ fontFamily: 'var(--font-blackletter)', fontSize: 62, color: 'var(--ink-bright)', lineHeight: 1, marginTop: 4, textShadow: `0 0 24px ${cfg.glow}` }}>{cfg.title}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-mid)', letterSpacing: '0.15em', marginTop: 6, fontStyle: 'italic' }}>{cfg.sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <a href="?mode=offer" className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10, color: mode === 'offer' ? 'var(--ember-bright)' : 'var(--ink-dim)', borderColor: mode === 'offer' ? 'var(--ember)' : 'var(--metal)' }}>ОФЕР</a>
          <a href="?mode=loss" className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10, color: mode === 'loss' ? 'var(--blood-bright)' : 'var(--ink-dim)', borderColor: mode === 'loss' ? 'var(--blood)' : 'var(--metal)' }}>ПАДЕНИЕ</a>
          <a href="?mode=autopsy" className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10, color: mode === 'autopsy' ? 'var(--rarity-magic)' : 'var(--ink-dim)', borderColor: mode === 'autopsy' ? 'var(--rarity-magic)' : 'var(--metal)' }}>АУТОПСИЯ</a>
        </div>
      </div>
    </div>
  );
}

function AutopsyTimeline() {
  const events = [
    { t: '00:00', e: 'Вход в бой · приветствие', v: 'ok', note: 'Ликтор: Nikhil K. · 18 лет в VK' },
    { t: '02:14', e: 'Уточнение scope API', v: 'ok', note: 'Спросил про RPS и SLA — правильно' },
    { t: '05:30', e: 'Первый код · neighbor lookup', v: 'ok', note: 'Hash-подход, O(1) — принято' },
    { t: '14:22', e: 'Вопрос про партиционирование', v: 'slip', note: 'Сказал consistent hashing, но путался в replicas' },
    { t: '24:08', e: 'CAP теорема · P-партишен', v: 'fail', note: 'Выбрал AP, когда явно нужен CP — Ликтор кивнул и заметил' },
    { t: '31:50', e: 'Rate limiter · sliding window', v: 'ok', note: 'Описал чисто, нарисовал диаграмму' },
    { t: '42:10', e: 'Follow-up: как тестировать', v: 'slip', note: 'Молчал 14 секунд — замерил сам' },
    { t: '48:30', e: 'Вопросы к Ликтору', v: 'ok', note: 'Спросил про культуру on-call — попал' },
    { t: '52:00', e: 'Конец боя', v: 'end', note: '' },
  ];
  const color = { ok: 'var(--toxic-lit)', slip: 'var(--ember-lit)', fail: 'var(--blood-lit)', end: 'var(--ink-dim)' };
  const icon = { ok: '✓', slip: '⚠', fail: '✕', end: '◆' };
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⟐</span> Хроника Боя · 52 мин</div>
      <div style={{ padding: '10px 0' }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 24px 1fr', gap: 10, padding: '8px 16px', borderBottom: i < events.length - 1 ? '1px solid var(--metal-dark)' : 'none', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.15em' }}>{e.t}</span>
            <span style={{ width: 22, height: 22, background: color[e.v] + '22', border: `1px solid ${color[e.v]}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: color[e.v], fontWeight: 700 }}>{icon[e.v]}</span>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 600, letterSpacing: '0.03em' }}>{e.e}</div>
              {e.note && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', fontStyle: 'italic', marginTop: 2 }}>{e.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatWentWrong() {
  const issues = [
    { t: 'CAP · перепутал AP vs CP', sev: 'критично', c: 'var(--blood-lit)', node: 'CONSISTENCY', fix: '→ Свиток Linearizability (48 мин)' },
    { t: 'Партиционирование · replicas', sev: 'средне',  c: 'var(--ember-lit)', node: 'DISTRIBUTED-PATTERNS', fix: '→ Raft за 20 минут' },
    { t: 'Замолчал под follow-up', sev: 'лёгко',   c: 'var(--toxic-lit)', node: 'STRESS-TONGUE', fix: '→ Каты по думанию вслух' },
  ];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">⚠</span> Что сломалось</div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {issues.map((it, i) => (
          <div key={i} style={{ padding: 12, background: 'var(--bg-inset)', border: `1px solid ${it.c}44`, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.04em' }}>{it.t}</span>
                <span style={{ padding: '1px 8px', fontFamily: 'var(--font-code)', fontSize: 8, color: it.c, background: `${it.c}1a`, border: `1px solid ${it.c}`, letterSpacing: '0.2em', fontWeight: 700 }}>{it.sev.toUpperCase()}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: it.c, letterSpacing: '0.2em', marginTop: 4 }}>УЗЕЛ · {it.node}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ember-lit)', marginTop: 4 }}>{it.fix}</div>
            </div>
            <button className="btn btn-blood" style={{ padding: '8px 12px', fontSize: 10, whiteSpace: 'nowrap' }}>⚡ ЗАКРЫТЬ УЗЕЛ</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LikTorVerdict({ mode }) {
  const text = {
    offer: '« Ты взял бой чисто. Scope уточнил, CAP держал, under follow-up — не замолчал. Ozon увидел Senior. Теперь — held offer 5 дней, без паники. »',
    loss: '« Проиграл не навыку — проиграл под follow-up. Молчание 14 секунд на "как тестировать" — Ликтор услышал неуверенность. Возвращайся через 2 недели. Я подготовил 3 кат на голос. »',
    autopsy: '« Бой ровный, без катастрофы. Два узла — Linearizability и Raft — подсветил как слабые. Три свитка, неделя, повторный заход. Не трать скорбь — трать время. »',
  }[mode];
  return (
    <div className="panel" style={{ padding: 0, borderColor: 'var(--blood)', background: 'linear-gradient(180deg, #1a0808, #0a0303)' }}>
      <div className="panel-head" style={{ borderBottom: '1px solid var(--blood-dark, #3a0909)' }}>
        <span className="ornament" style={{ color: 'var(--blood-lit)' }}>☠</span> Вердикт Ликтора
      </div>
      <div style={{ padding: 18 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-bright)', lineHeight: 1.6, fontStyle: 'italic' }}>{text}</div>
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10 }}>◆ ЗАПИСЬ СЕССИИ</button>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10 }}>◐ ТРАНСКРИПТ</button>
          <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 10 }}>✦ ПОДЕЛИТЬСЯ С ГИЛЬДИЕЙ</button>
        </div>
      </div>
    </div>
  );
}

function Loot({ mode }) {
  const items = {
    offer: [
      { i: '♛', n: 'Корона Победителя', c: 'var(--rarity-unique)', sub: '+5% ELO до конца сезона' },
      { i: '◈', n: '+1 800 XP', c: 'var(--ember-bright)', sub: 'уровень 25 разблокирован' },
      { i: '❂', n: '3 свитка Ozon', c: 'var(--rarity-rare)', sub: 'культура · on-call · миграции' },
      { i: '⬢', n: '50 гемов', c: 'var(--rarity-gem)', sub: 'в казну гильдии' },
    ],
    loss: [
      { i: '☠', n: 'Шрам', c: 'var(--blood-lit)', sub: 'но не слабость — запись узла' },
      { i: '◈', n: '+320 XP', c: 'var(--ember-lit)', sub: 'бой есть бой' },
      { i: '❂', n: '2 свитка', c: 'var(--rarity-magic)', sub: 'Linearizability · Raft' },
      { i: '⏳', n: 'Кулдаун 14 дней', c: 'var(--ink-mid)', sub: 'Яндекс закрыт до 6 марта' },
    ],
    autopsy: [
      { i: '◈', n: '+640 XP', c: 'var(--ember-lit)', sub: 'за участие' },
      { i: '❂', n: '3 свитка по узлам', c: 'var(--rarity-rare)', sub: 'Ликтор прописал' },
      { i: '⬡', n: 'Реликвия · Чёрное Перо', c: 'var(--rarity-magic)', sub: '+2 к голосу в бою' },
    ],
  }[mode];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">❂</span> Добыча</div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-inset)', border: `1px solid ${it.c}44`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20, color: it.c, width: 24, textAlign: 'center', flexShrink: 0 }}>{it.i}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: it.c, fontWeight: 700, letterSpacing: '0.04em' }}>{it.n}</div>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.1em', marginTop: 1 }}>{it.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextStep({ mode }) {
  const steps = {
    offer: [
      { t: 'Принять офер', d: 'или торговаться · 5 дней', c: 'var(--ember-bright)' },
      { t: 'Обновить публичный профиль', d: '+1 убитый дракон', c: 'var(--rarity-gem)' },
      { t: 'Рассказать гильдии', d: '+500 очков захвата', c: 'var(--blood-lit)' },
    ],
    loss: [
      { t: 'Похороны · 24 часа тишины', d: 'ритуал, не депрессия', c: 'var(--blood-lit)' },
      { t: 'Пройти 3 свитка', d: 'Linearizability · Raft · голос', c: 'var(--ember-lit)' },
      { t: 'Перезаказать у Ликтора', d: 'мок-бой через 14 дней', c: 'var(--rarity-magic)' },
    ],
    autopsy: [
      { t: 'Закрыть 2 слабых узла', d: 'дерево не ждёт', c: 'var(--ember-bright)' },
      { t: 'Daily Kata · голос', d: '3 дня подряд', c: 'var(--rarity-gem)' },
      { t: 'Следующий бой назначен', d: '6 марта · Альфа-Банк', c: 'var(--blood-lit)' },
    ],
  }[mode];
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head"><span className="ornament">→</span> Следующий Шаг</div>
      <div style={{ padding: 10 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ padding: 10, borderBottom: i < steps.length - 1 ? '1px solid var(--metal-dark)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ width: 16, height: 16, background: s.c, color: '#0a0404', fontFamily: 'var(--font-display)', fontSize: 9, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }}>{i + 1}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink-bright)', fontWeight: 700, letterSpacing: '0.04em' }}>{s.t}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)', marginTop: 3, paddingLeft: 24 }}>{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RitualPanel({ mode }) {
  if (mode === 'offer') {
    return (
      <div className="panel" style={{ padding: 16, background: 'linear-gradient(180deg, #2a1a08, #0a0605)', borderColor: 'var(--ember)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ember-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>РИТУАЛ ТРИУМФА</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
          « Не отвечай сразу. Офер ждёт 24 часа без ущерба. Выпей воды, пройдись, расскажи близким — потом торгуйся. »
        </div>
      </div>
    );
  }
  if (mode === 'loss') {
    return (
      <div className="panel" style={{ padding: 16, background: 'linear-gradient(180deg, #1a0808, #0a0303)', borderColor: 'var(--blood)' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.3em', fontWeight: 700 }}>ПОХОРОНЫ</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
          « Дай себе 24 часа. Ни кат, ни свитков, ни код-ревью. На кладбище ликторов есть место — это нормально. »
        </div>
        <button className="btn btn-blood" style={{ marginTop: 10, width: '100%', padding: '8px 0', fontSize: 10 }}>⌛ ВКЛЮЧИТЬ ТРАУР</button>
      </div>
    );
  }
  return (
    <div className="panel" style={{ padding: 16, background: 'linear-gradient(180deg, #14102a, #0a0815)', borderColor: 'var(--rarity-magic)' }}>
      <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--rarity-magic)', letterSpacing: '0.3em', fontWeight: 700 }}>РАБОТА НАД ОШИБКАМИ</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', lineHeight: 1.55, marginTop: 8, fontStyle: 'italic' }}>
        « Разбор — не наказание. Смотришь запись, отмечаешь моменты, закрываешь узлы. Работа, не самобичевание. »
      </div>
    </div>
  );
}

const urlMode = new URLSearchParams(location.search).get('mode') || 'autopsy';
Object.assign(window, { ResultsScreen, urlMode });
