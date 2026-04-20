// AI-Mock — code / whiteboard centerpiece. Large work area + compact side rails.

function MockScreen() {
  const [mode, setMode] = React.useState('code'); // 'code' | 'board'
  return (
    <div style={{ padding: '16px 20px 140px', display: 'grid', gridTemplateColumns: '240px 1fr 260px', gap: 16, height: 'calc(100vh - 60px - 32px)' }}>
      <LeftRail />
      <WorkArea mode={mode} setMode={setMode} />
      <RightRail />
    </div>
  );
}

function WorkArea({ mode, setMode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, minWidth: 0 }}>
      <SessionBar mode={mode} setMode={setMode} />
      <div className="panel" style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {mode === 'code' ? <CodeEditor /> : <Whiteboard />}
      </div>
    </div>
  );
}

function SessionBar({ mode, setMode }) {
  return (
    <div className="panel" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--blood-lit)', letterSpacing: '0.3em' }}>● LIVE · РАУНД 2 / 4</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ink-bright)', letterSpacing: '0.05em', marginTop: 2, fontWeight: 700 }}>
          Систем-дизайн: TinyURL at Scale
        </div>
      </div>
      <div className="grow" />
      <div style={{ display: 'flex', border: '1px solid var(--metal)', background: 'var(--bg-inset)' }}>
        {[{k:'code',l:'⌨ Код'},{k:'board',l:'✎ Доска'}].map(t => (
          <button key={t.k} onClick={() => setMode(t.k)} style={{
            padding: '8px 16px',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.15em',
            color: mode === t.k ? 'var(--ember-bright)' : 'var(--ink-mid)',
            background: mode === t.k ? 'linear-gradient(180deg, #2a1a10, #1a0e08)' : 'transparent',
            borderRight: t.k === 'code' ? '1px solid var(--metal)' : 'none',
          }}>{t.l}</button>
        ))}
      </div>
      <div className="inset-groove" style={{ padding: '6px 14px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 8, color: 'var(--ink-dim)', letterSpacing: '0.25em' }}>ТАЙМЕР</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--ember-bright)', fontWeight: 700 }}>27:42</div>
      </div>
      <button className="btn btn-blood">✕ Завершить</button>
    </div>
  );
}

function CodeEditor() {
  const lines = [
    { n: 1, t: '// TinyURL — 100M URL/день, read:write = 100:1', c: 'var(--ink-dim)' },
    { n: 2, t: 'class ShortenerService {', c: 'var(--rarity-magic)' },
    { n: 3, t: '  async generate(longURL: string): Promise<string> {', c: 'var(--ink-bright)' },
    { n: 4, t: '    const hash = base62(sha256(longURL).slice(0, 7))', c: 'var(--ink-bright)' },
    { n: 5, t: '    if (await this.bloom.has(hash)) return this.handleCollision(hash, longURL)', c: 'var(--ink-bright)' },
    { n: 6, t: '    await Promise.all([', c: 'var(--ink-bright)' },
    { n: 7, t: '      this.cache.setex(hash, 86400, longURL),', c: 'var(--ink-bright)' },
    { n: 8, t: '      this.db.insert({ hash, longURL, ts: Date.now() }),', c: 'var(--ink-bright)' },
    { n: 9, t: '      this.bloom.add(hash)', c: 'var(--ink-bright)' },
    { n: 10, t: '    ])', c: 'var(--ink-bright)' },
    { n: 11, t: '    return `druz.ix/${hash}`', c: 'var(--ember-lit)' },
    { n: 12, t: '  }', c: 'var(--ink-bright)' },
    { n: 13, t: '', c: '' },
    { n: 14, t: '  async resolve(hash: string): Promise<string | null> {', c: 'var(--ink-bright)' },
    { n: 15, t: '    // cache-aside — 99.9% hit на hot keys', c: 'var(--sick)' },
    { n: 16, t: '    return (await this.cache.get(hash)) ?? this.db.findByHash(hash)', c: 'var(--ink-bright)' },
    { n: 17, t: '  }', c: 'var(--ink-bright)' },
    { n: 18, t: '', c: '' },
    { n: 19, t: '  private async handleCollision(h: string, url: string) {', c: 'var(--ink-bright)' },
    { n: 20, t: '    const existing = await this.db.findByHash(h)', c: 'var(--ink-bright)' },
    { n: 21, t: '    if (existing?.longURL === url) return `druz.ix/${h}`', c: 'var(--ink-bright)' },
    { n: 22, t: '    return this.generate(url + Date.now())', c: 'var(--ink-bright)' },
    { n: 23, t: '  }', c: 'var(--ink-bright)' },
    { n: 24, t: '}', c: 'var(--rarity-magic)' },
  ];
  return (
    <>
      <div className="panel-head">
        <span className="ornament">⚔</span> shortener.ts
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--toxic-lit)' }}>● TypeScript</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 0', background: 'linear-gradient(180deg, #0a0806, #060404)', fontFamily: 'var(--font-code)', fontSize: 13, lineHeight: 1.7 }}>
        {lines.map(l => (
          <div key={l.n} style={{ display: 'flex', padding: '0 16px 0 0' }}>
            <div style={{ width: 44, textAlign: 'right', color: 'var(--ink-mute)', paddingRight: 14, fontSize: 11, userSelect: 'none' }}>{l.t && l.n}</div>
            <div style={{ color: l.c, whiteSpace: 'pre' }}>{l.t}</div>
          </div>
        ))}
        <div style={{ display: 'flex', padding: '0 16px 0 0' }}>
          <div style={{ width: 44, textAlign: 'right', color: 'var(--ink-mute)', paddingRight: 14, fontSize: 11 }}>25</div>
          <div><span style={{ background: 'var(--ember-lit)', color: '#000', padding: '0 1px', animation: 'blink 1s infinite' }}>▊</span></div>
        </div>
      </div>
      <div style={{ padding: '10px 16px', background: 'var(--bg-inset)', borderTop: '1px solid var(--metal-dark)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>▶ Запустить</button>
        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>✓ Тесты</button>
        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>⌗ Формат</button>
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)' }}>O(1) lookup — O(1) write — 99.9% hit</span>
      </div>
    </>
  );
}

function Whiteboard() {
  return (
    <>
      <div className="panel-head">
        <span className="ornament">✎</span> Пергамент Архитектора
        <div className="grow" />
        <div style={{ display: 'flex', gap: 6 }}>
          {['◻','○','⬟','→','T','✎'].map((t,i) => (
            <button key={i} style={{
              width: 28, height: 28, background: i === 3 ? 'var(--bg-glow)' : 'var(--bg-inset)',
              border: `1px solid ${i === 3 ? 'var(--ember-lit)' : 'var(--metal-dark)'}`,
              color: i === 3 ? 'var(--ember-bright)' : 'var(--ink-mid)', fontSize: 13,
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden',
        background: 'radial-gradient(ellipse at center, #1a1512 0%, #0a0605 80%)',
        backgroundImage: `
          radial-gradient(ellipse at center, #1a1512 0%, #0a0605 80%),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 24px),
          repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 24px)` }}>
        <svg viewBox="0 0 900 560" style={{ width: '100%', height: '100%' }}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#e09b3a" />
            </marker>
          </defs>
          {/* Client */}
          <g>
            <rect x="40" y="250" width="110" height="60" fill="#1a1208" stroke="#e09b3a" strokeWidth="1.5" />
            <text x="95" y="275" textAnchor="middle" fontFamily="var(--font-display)" fontSize="13" fill="#e8dccb" letterSpacing="1">КЛИЕНТ</text>
            <text x="95" y="295" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#a8998a">100M req/d</text>
          </g>
          {/* LB */}
          <g>
            <polygon points="220,250 310,250 325,280 310,310 220,310 205,280" fill="#1a1208" stroke="#c22222" strokeWidth="1.5" />
            <text x="265" y="275" textAnchor="middle" fontFamily="var(--font-display)" fontSize="12" fill="#e8dccb">L7 LB</text>
            <text x="265" y="293" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#a8998a">nginx</text>
          </g>
          {/* App cluster */}
          <g>
            {[0,1,2].map(i => (
              <g key={i}>
                <rect x={400} y={200 + i*40} width="120" height="32" fill="#140c08" stroke="#b5721f" strokeWidth="1" />
                <text x={460} y={221 + i*40} textAnchor="middle" fontFamily="var(--font-code)" fontSize="11" fill="#e09b3a">api-{i+1}</text>
              </g>
            ))}
            <text x="460" y="195" textAnchor="middle" fontFamily="var(--font-display)" fontSize="10" fill="#a8998a" letterSpacing="2">APP · 3 INSTANCES</text>
          </g>
          {/* Cache */}
          <g>
            <ellipse cx="720" cy="160" rx="70" ry="40" fill="#0d2020" stroke="#1ba29b" strokeWidth="1.5" />
            <text x="720" y="158" textAnchor="middle" fontFamily="var(--font-display)" fontSize="13" fill="#3dd4cc">REDIS</text>
            <text x="720" y="176" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#a8998a">TTL 24h · 99.9%</text>
          </g>
          {/* DB */}
          <g>
            <path d="M650 340 Q650 325 720 325 Q790 325 790 340 L790 410 Q790 425 720 425 Q650 425 650 410 Z" fill="#1a0808" stroke="#c22222" strokeWidth="1.5" />
            <ellipse cx="720" cy="340" rx="70" ry="15" fill="none" stroke="#8a1414" strokeWidth="1" />
            <text x="720" y="370" textAnchor="middle" fontFamily="var(--font-display)" fontSize="13" fill="#e8dccb">POSTGRES</text>
            <text x="720" y="388" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#a8998a">sharded by hash[0:2]</text>
            <text x="720" y="402" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#6b5f54">256 shards</text>
          </g>
          {/* Bloom */}
          <g>
            <polygon points="100,440 170,420 200,465 160,505 100,490" fill="#080820" stroke="#8888ff" strokeWidth="1" />
            <text x="140" y="465" textAnchor="middle" fontFamily="var(--font-display)" fontSize="11" fill="#b0b0ff">BLOOM</text>
            <text x="140" y="482" textAnchor="middle" fontFamily="var(--font-code)" fontSize="9" fill="#a8998a">collision</text>
          </g>
          {/* CDN */}
          <g>
            <circle cx="265" cy="120" r="38" fill="#1a0808" stroke="#e09b3a" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x="265" y="118" textAnchor="middle" fontFamily="var(--font-display)" fontSize="12" fill="#f5c56b">CDN</text>
            <text x="265" y="134" textAnchor="middle" fontFamily="var(--font-code)" fontSize="8" fill="#a8998a">read hot</text>
          </g>
          {/* Arrows */}
          <g stroke="#e09b3a" strokeWidth="1.5" fill="none" markerEnd="url(#arr)">
            <path d="M150 280 L200 280" />
            <path d="M325 270 L395 220" />
            <path d="M325 280 L395 250" />
            <path d="M325 290 L395 280" />
            <path d="M520 215 Q620 180 655 165" />
            <path d="M520 255 Q620 310 655 340" />
            <path d="M460 310 L200 440" opacity="0.5" strokeDasharray="4 4" />
            <path d="M265 250 L265 160" opacity="0.6" strokeDasharray="3 3" />
          </g>
          {/* Notes */}
          <g fontFamily="var(--font-body)" fontSize="10" fill="#e83838" fontStyle="italic">
            <text x="350" y="175">CAP: AP, eventual</text>
            <text x="560" y="145">write-through</text>
            <text x="560" y="340">cold path</text>
          </g>
          {/* RPS labels */}
          <g fontFamily="var(--font-code)" fontSize="9" fill="#f5c56b">
            <text x="170" y="270">10k RPS</text>
            <text x="340" y="210">3.3k × 3</text>
            <text x="580" y="210">p99 2ms</text>
          </g>
        </svg>

        {/* Participant cursors */}
        <div style={{ position: 'absolute', top: '35%', left: '55%', pointerEvents: 'none' }}>
          <svg width="18" height="18" viewBox="0 0 20 20"><path d="M2 2 L2 16 L6 12 L9 18 L11 17 L8 11 L14 10 Z" fill="#b0b0ff" stroke="#fff" strokeWidth="0.5" /></svg>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: '#fff', background: '#8888ff', padding: '1px 6px', marginLeft: 4 }}>Ликтор</span>
        </div>
      </div>
      <div style={{ padding: '10px 16px', background: 'var(--bg-inset)', borderTop: '1px solid var(--metal-dark)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>↶ Отмена</button>
        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}>⎘ Экспорт</button>
        <div className="grow" />
        <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)' }}>◐ Синхронизировано</span>
      </div>
    </>
  );
}

function LeftRail() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">◈</span> Ликтор</div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 120, height: 120, position: 'relative' }}>
            <svg viewBox="-100 -100 200 200" style={{ width: '100%', height: '100%' }}>
              <defs>
                <radialGradient id="ether2" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#b0b0ff" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#8888ff" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="0" cy="0" r="90" fill="url(#ether2)"><animate attributeName="r" values="85;92;85" dur="3s" repeatCount="indefinite" /></circle>
              <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="30s" repeatCount="indefinite" />
                <circle cx="0" cy="0" r="70" fill="none" stroke="#8888ff" strokeWidth="0.5" strokeDasharray="3 8" />
                {[0, 90, 180, 270].map(a => (<text key={a} x={Math.cos(a * Math.PI / 180) * 70} y={Math.sin(a * Math.PI / 180) * 70 + 4} textAnchor="middle" fontSize="10" fill="#b0b0ff" fontFamily="var(--font-display)">✦</text>))}
              </g>
              <circle cx="0" cy="0" r="50" fill="#0a0a2a" stroke="#b0b0ff" strokeWidth="1" />
              <ellipse cx="0" cy="0" rx="20" ry="10" fill="#000" />
              <circle cx="0" cy="0" r="6" fill="#b0b0ff"><animate attributeName="cx" values="-6;6;-6" dur="4s" repeatCount="indefinite" /></circle>
            </svg>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--rarity-magic)', letterSpacing: '0.15em', marginTop: 8, fontWeight: 600 }}>ГОВОРИТ…</div>
        </div>
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--metal-dark)', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-bright)', fontStyle: 'italic', lineHeight: 1.5, background: 'rgba(136,136,255,0.04)' }}>
          « А если 10M RPS? Твой кэш разорвётся. Спаси её, смертный. »
        </div>
        <div style={{ padding: 10, display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost" style={{ flex: 1, padding: '6px', fontSize: 10 }}>◎ Пауза</button>
          <button className="btn btn-blood" style={{ flex: 1, padding: '6px', fontSize: 10 }}>◉ Ответ</button>
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">⚺</span> Подсказки</div>
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { c: 'var(--rarity-rare)', t: 'Обсуди consistent hashing' },
            { c: 'var(--ember-lit)', t: 'Назови trade-off CAP' },
            { c: 'var(--ink-dim)', t: 'Упомяни rate limiting' },
          ].map((h, i) => (
            <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-inset)', borderLeft: `2px solid ${h.c}`, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-mid)' }}>{h.t}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RightRail() {
  const msgs = [
    { who: 'ЛИКТОР', c: 'var(--rarity-magic)', t: 'Опиши схему. Почему base62?' },
    { who: 'ТЫ', c: 'var(--ember-lit)', t: 'base62^7 ≈ 3.5T, UUID избыточен.' },
    { who: 'ЛИКТОР', c: 'var(--rarity-magic)', t: 'А коллизии?' },
    { who: 'ТЫ', c: 'var(--ember-lit)', t: 'Bloom filter + counter fallback.' },
    { who: 'СИСТЕМА', c: 'var(--toxic-lit)', t: '+12 XP · отличное обоснование hash' },
  ];
  const metrics = [
    { k: 'Глубина', v: 78, c: 'var(--ember-lit)' },
    { k: 'Чистота', v: 85, c: 'var(--toxic-lit)' },
    { k: 'Trade-offs', v: 62, c: 'var(--blood-lit)' },
    { k: 'Комм.', v: 90, c: 'var(--rarity-gem)' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div className="panel" style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="panel-head"><span className="ornament">✦</span> Летопись</div>
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: m.c, letterSpacing: '0.25em', fontWeight: 700 }}>{m.who}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: m.who === 'СИСТЕМА' ? 'var(--toxic-lit)' : 'var(--ink-mid)', marginTop: 2, lineHeight: 1.5, fontStyle: m.who === 'СИСТЕМА' ? 'italic' : 'normal' }}>{m.t}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head"><span className="ornament">◈</span> Оценка</div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {metrics.map(m => (
            <div key={m.k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ fontFamily: 'var(--font-body)', color: 'var(--ink-mid)' }}>{m.k}</span>
                <span style={{ fontFamily: 'var(--font-code)', color: m.c, fontWeight: 700 }}>{m.v}</span>
              </div>
              <div className="bar" style={{ marginTop: 3, height: 5 }}>
                <div className="bar-fill" style={{ width: `${m.v}%`, background: `linear-gradient(180deg, ${m.c}, ${m.c}88)`, boxShadow: `0 0 6px ${m.c}66` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MockScreen });
