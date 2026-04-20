// ===================== Arena 1v1 =====================
function ArenaScreen() {
  const code1 = `func longestPalin(s string) string {
    n := len(s)
    if n < 2 { return s }
    start, max := 0, 1
    for i := 0; i < n; i++ {
        l, r := i, i
        for l >= 0 && r < n && s[l] == s[r] {
            if r - l + 1 > max {
                start = l
                max = r - l + 1
            }
            l--; r++
        }
    }
    return s[start:start+max]
}`;
  const code2 = `func longestPalin(s string) string {
    if s == "" {
        return ""
    }
    longest := ""
    for i := range s {
        for j := i + 1; j <= len(s); j++ {
            sub := s[i:j]
            if isPalin(sub) && len(sub) > len(longest) {
                longest = sub
            }
        }
    }
    return longest
}`;

  const Player = ({ name, elo, me, passing, total }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="hex-wrap">
          <div className="hex" style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CharacterChip size={36} />
          </div>
        </div>
        <div>
          <div className="heraldic" style={{ fontSize: 18, color: me ? 'var(--gold-bright)' : 'var(--text-bright)' }}>{name}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-mid)' }}>
            ELO <span className="gold-bright">{elo}</span> · ALGORITHMS
          </div>
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: 'var(--text-mid)', marginBottom: 4 }}>
          <span>TESTS</span>
          <span className="gold-bright">{passing}/{total}</span>
        </div>
        <div className="bar"><div className="fill" style={{ width: (passing/total*100) + '%', background: passing === total ? 'var(--sec-sql-accent)' : 'var(--gold)' }} /></div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Arena banner */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        gap: 24, padding: '18px 36px',
        background: 'radial-gradient(ellipse at center, rgba(192,57,43,0.08), transparent 60%), var(--bg-surface)',
        borderBottom: '1px solid var(--gold-faint)', alignItems: 'center'
      }}>
        <Player name="alexei.volkov" elo={2498} me passing={4} total={5} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 32px', border: '1px solid var(--gold)', background: 'var(--bg-inset)', position: 'relative' }}>
          <Corners />
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>LONGEST PALINDROME</div>
          <div className="heraldic" style={{ fontSize: 44, color: 'var(--gold-bright)', letterSpacing: '0.08em', lineHeight: 1 }}>07:24</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.22em', color: 'var(--stop-text)' }}>⚔ FIRST TO 5</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Player name="ΣShadowFang" elo={2612} passing={2} total={5} />
        </div>
      </div>

      {/* Split editors */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gold)' }}>
          <CodeEditor code={code1} highlightLine={14} compact />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <CodeEditor code={code2} highlightLine={11} compact />
        </div>
      </div>

      {/* Bottom status */}
      <div style={{ display: 'flex', padding: '14px 36px', borderTop: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', alignItems: 'center', gap: 18 }}>
        <span style={{ color: 'var(--sec-sql-accent)', fontSize: 11, fontFamily: 'var(--font-display)', letterSpacing: '0.2em' }}>● CONNECTED</span>
        <span style={{ color: 'var(--text-mid)', fontSize: 11, fontFamily: 'var(--font-display)', letterSpacing: '0.18em' }}>OPPONENT TYPING · 142 WPM</span>
        <div className="grow" />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.2em', color: 'var(--warn-text)' }}>
          ⚠ PASTE DISABLED · FOCUS LOCKED
        </div>
        <button className="btn btn-sm">⊘&nbsp;FORFEIT</button>
        <button className="btn btn-primary btn-cut btn-sm">◈&nbsp;SUBMIT</button>
      </div>
    </div>
  );
}

// ===================== Daily Kata =====================
function KataScreen() {
  const week = ['M','T','W','T','F','S','S'];
  const done = [true, true, true, true, false, false, false];
  const today = 4; // friday

  return (
    <div style={{ padding: '48px 36px', display: 'flex', flexDirection: 'column', gap: 36, alignItems: 'stretch', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.4em', color: 'var(--gold-dim)' }}>DAILY KATA</div>
        <div className="heraldic" style={{ fontSize: 28, color: 'var(--gold-bright)', marginTop: 4 }}>Unbroken Resolve</div>
      </div>

      {/* Streak hero */}
      <div style={{ position: 'relative', padding: '40px 20px', textAlign: 'center',
        background: 'radial-gradient(ellipse at center, rgba(239,159,39,0.08), transparent 60%), var(--bg-surface)',
        border: '1px solid var(--gold)' }}>
        <Corners />
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 11, letterSpacing: '0.4em', color: 'var(--gold)' }}>STREAK</div>
        <div className="heraldic" style={{ fontSize: 92, color: 'var(--gold-bright)', lineHeight: 1, margin: '8px 0' }}>28</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.3em', color: 'var(--gold)' }}>DAYS UNBROKEN</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 18, fontSize: 11, color: 'var(--text-mid)', fontFamily: 'var(--font-display)', letterSpacing: '0.18em' }}>
          <span>❄ FREEZE TOKENS <span className="gold-bright">2</span></span>
          <span style={{ color: 'var(--gold-dim)' }}>·</span>
          <span>⚜ RECORD <span className="gold-bright">47</span></span>
          <span style={{ color: 'var(--gold-dim)' }}>·</span>
          <span>◈ THIS WEEK <span className="gold-bright">4/7</span></span>
        </div>
      </div>

      {/* Today's Kata */}
      <Card large style={{ padding: 28, background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>TODAY · FRIDAY</div>
          <span className="badge badge-hard">⚠ CURSED — ×3 XP</span>
        </div>
        <div className="heraldic" style={{ fontSize: 26, color: 'var(--gold-bright)', marginTop: 10 }}>Serialize Binary Tree</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 6 }}>
          Algorithms · Trees · Medium · ~12 minutes · Cursed: no delete key
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 20, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.18em' }}>
          <span className="muted">TIME&nbsp;<span className="gold-bright">12 MIN</span></span>
          <span className="muted">XP&nbsp;<span className="gold-bright">+270</span></span>
          <span className="muted">WEAK NODE&nbsp;<span style={{ color: 'var(--sec-algo-accent)' }}>TREE LORD</span></span>
        </div>
        <button className="btn btn-primary btn-cut" style={{ marginTop: 22, padding: '14px 28px' }}>✦&nbsp;&nbsp;BEGIN KATA</button>
      </Card>

      {/* Week view */}
      <div>
        <Divider style={{ fontSize: 10 }}>This Week</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10, marginTop: 18 }}>
          {week.map((d, i) => {
            const isDone = done[i];
            const isToday = i === today;
            const future = i > today;
            return (
              <div key={i} style={{
                aspectRatio: '1',
                border: `1px solid ${isToday ? 'var(--gold)' : 'var(--gold-faint)'}`,
                background: isDone ? 'rgba(200,169,110,0.12)' : 'var(--bg-inset)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                position: 'relative'
              }}>
                <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: '0.2em' }}>{d}</div>
                <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 22, color: isDone ? 'var(--gold-bright)' : isToday ? 'var(--gold)' : future ? 'var(--text-dim)' : 'var(--text-mid)' }}>
                  {isDone ? '✓' : isToday ? '◆' : '◇'}
                </div>
                {isToday && (
                  <div style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', padding: '1px 8px', fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: '0.2em', background: 'var(--gold)', color: 'var(--bg-base)' }}>TODAY</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ===================== Interview Calendar =====================
function CalendarScreen() {
  const days = Array.from({ length: 7 });
  const plan = [
    ['Tree DP × 2', 'AI-Mock SQL', 'Arena 1v1', 'Rest', 'AI-Mock SD', 'Cursed Kata', 'Review'],
    ['Easy Arrays', 'Medium DP',   'Hard Graph', 'Daily Kata', 'Behavioral drill', 'Rest', 'Stress Mock'],
  ].flat();
  const priorities = [
    { name: 'Consistent Hashing', section: 'sd',   level: 54, prio: 'HIGH' },
    { name: 'Window Functions',   section: 'sql',  level: 42, prio: 'HIGH' },
    { name: 'STAR Storytelling',  section: 'beh',  level: 38, prio: 'MEDIUM' },
    { name: 'Dynamic Programming', section: 'algo', level: 61, prio: 'MEDIUM' },
  ];

  return (
    <div style={{ padding: '28px 36px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Countdown hero */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
        <div style={{ padding: '36px 32px', border: '1px solid var(--gold)', position: 'relative',
          background: 'radial-gradient(ellipse at 20% 100%, rgba(192,57,43,0.06), transparent 60%), var(--bg-surface)' }}>
          <Corners />
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.4em', color: 'var(--gold-dim)' }}>UNTIL SUMMONS</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6 }}>
            <div className="heraldic" style={{ fontSize: 88, color: 'var(--gold-bright)', lineHeight: 1 }}>21</div>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 26, color: 'var(--gold)', letterSpacing: '0.2em' }}>DAYS</div>
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-bright)', marginTop: 14 }}>
            <span className="heraldic" style={{ color: 'var(--gold-bright)' }}>Yandex</span> · Staff Backend · May 11, 14:00 MSK
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 6 }}>Boss Dungeon · Algorithms, SysDesign, Behavioral</div>
        </div>

        <div style={{ padding: '24px 28px', border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 22 }}>
          <svg width="130" height="130" viewBox="0 0 130 130">
            <circle cx="65" cy="65" r="56" fill="none" stroke="var(--gold-faint)" strokeWidth="4" />
            <circle cx="65" cy="65" r="56" fill="none" stroke="var(--gold)" strokeWidth="4"
              strokeDasharray={2 * Math.PI * 56} strokeDashoffset={(2 * Math.PI * 56) * 0.37} transform="rotate(-90 65 65)" />
            <text x="65" y="68" textAnchor="middle" fill="var(--gold-bright)" fontFamily="var(--font-heraldic)" fontSize="28" fontWeight="700">63%</text>
            <text x="65" y="86" textAnchor="middle" fill="var(--text-mid)" fontFamily="var(--font-display)" fontSize="8" letterSpacing="3">READY</text>
          </svg>
          <div>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>READINESS</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>
              +9% this week. Close 2 weak nodes to reach <span className="gold-bright">80%</span>.
            </div>
            <button className="btn btn-sm" style={{ marginTop: 12 }}>◈&nbsp;Re-assess</button>
          </div>
        </div>
      </div>

      {/* Today's plan */}
      <div>
        <Divider>Today's Plan</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18 }}>
          {[
            { check: true, label: 'Tree DP · 2 problems', time: '30m', sec: 'algo' },
            { check: false, label: 'AI-Mock · Yandex SysDesign', time: '45m', sec: 'sd' },
            { check: false, label: 'Behavioral drill · Conflict', time: '15m', sec: 'beh' },
          ].map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
              <div style={{
                width: 22, height: 22,
                border: `1px solid ${t.check ? 'var(--gold)' : 'var(--gold-dim)'}`,
                background: t.check ? 'var(--gold)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--bg-base)', fontFamily: 'var(--font-heraldic)', fontSize: 12
              }}>{t.check ? '✓' : ''}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.1em', color: t.check ? 'var(--text-mid)' : 'var(--gold-bright)', textDecoration: t.check ? 'line-through' : 'none' }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'var(--font-code)', marginTop: 3 }}>{t.time}</div>
              </div>
              <div style={{ width: 6, height: 36, background: `var(--sec-${t.sec}-accent)` }} />
            </div>
          ))}
        </div>
      </div>

      {/* 2-week plan grid */}
      <div>
        <Divider>14-Day Campaign</Divider>
        <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d => (
            <div key={d} style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.25em', color: 'var(--gold-dim)', padding: '4px 6px' }}>{d}</div>
          ))}
          {plan.map((p, i) => (
            <div key={i} style={{
              minHeight: 64, padding: '8px 10px',
              border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)',
              position: 'relative'
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.2em', color: 'var(--gold-dim)' }}>D{i + 1}</div>
              <div style={{ fontSize: 10, color: 'var(--text-bright)', marginTop: 4, lineHeight: 1.35 }}>{p}</div>
              {i === 20 && <div style={{ position: 'absolute', inset: 0, border: '1px solid var(--stop-text)', pointerEvents: 'none' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Priorities */}
      <div>
        <Divider>Weak Nodes to Close</Divider>
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {priorities.map(p => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 18px', border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
              <div style={{ width: 6, height: 32, background: `var(--sec-${p.section}-accent)` }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 12, letterSpacing: '0.12em', color: 'var(--gold-bright)' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>at {p.level}% — needs 3 trials</div>
              </div>
              <div style={{ width: 180 }}>
                <div className="bar"><div className="fill" style={{ width: p.level + '%', background: `var(--sec-${p.section}-accent)` }} /></div>
              </div>
              <span className={`badge ${p.prio === 'HIGH' ? 'badge-boss' : 'badge-hard'}`}>{p.prio}</span>
              <button className="btn btn-sm">◈&nbsp;Plan</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===================== Guild War =====================
function GuildWarScreen() {
  const lines = [
    { name: 'ALGORITHMS', a: 68, b: 42, color: 'var(--sec-algo-accent)' },
    { name: 'SQL',        a: 44, b: 56, color: 'var(--sec-sql-accent)' },
    { name: 'GO',         a: 72, b: 38, color: 'var(--sec-go-accent)' },
    { name: 'SYSDESIGN',  a: 31, b: 65, color: 'var(--sec-sd-accent)' },
    { name: 'BEHAVIORAL', a: 51, b: 49, color: 'var(--sec-beh-accent)' },
  ];
  const members = [
    { name: 'alexei.volkov',  pts: 480, line: 'GO',         me: true },
    { name: 'moira.quinn',    pts: 412, line: 'ALGORITHMS' },
    { name: 'kovac',          pts: 388, line: 'SQL' },
    { name: 'ΣΛnton',         pts: 360, line: 'SYSDESIGN' },
    { name: 'varya.k',        pts: 280, line: 'BEHAVIORAL' },
    { name: 'dima.gorelov',   pts: 244, line: 'ALGORITHMS' },
    { name: 'nightowl',       pts: 210, line: 'GO' },
  ];

  return (
    <div style={{ padding: '28px 36px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, padding: '20px 28px', border: '1px solid var(--gold)', background: 'radial-gradient(ellipse at center, rgba(200,169,110,0.04), transparent), var(--bg-surface)', position: 'relative' }}>
        <Corners />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <GuildEmblem size={64} color="var(--gold)" glyph="⚔" />
          <div>
            <div className="heraldic" style={{ fontSize: 20, color: 'var(--gold-bright)' }}>The Ember Wolves</div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: '0.22em', color: 'var(--text-mid)' }}>GUILD ELO <span className="gold-bright">2,140</span> · 8 MEMBERS</div>
          </div>
        </div>
        <div className="grow" />
        <div style={{ textAlign: 'center' }}>
          <div className="heraldic" style={{ color: 'var(--gold-dim)', fontSize: 11, letterSpacing: '0.3em' }}>VS</div>
          <div className="heraldic" style={{ fontSize: 18, color: 'var(--gold)', marginTop: 4 }}>WEEK III</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: 'var(--stop-text)', marginTop: 2 }}>2 DAYS 14H REMAIN</div>
        </div>
        <div className="grow" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexDirection: 'row-reverse' }}>
          <GuildEmblem size={64} color="var(--stop-text)" glyph="◆" />
          <div style={{ textAlign: 'right' }}>
            <div className="heraldic" style={{ fontSize: 20, color: 'var(--text-bright)' }}>Void Seekers</div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: '0.22em', color: 'var(--text-mid)' }}>GUILD ELO <span className="gold-bright">2,201</span> · 10 MEMBERS</div>
          </div>
        </div>
      </div>

      {/* Line summary */}
      <div style={{ padding: '12px 20px', border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 11, letterSpacing: '0.25em', color: 'var(--gold)' }}>LINES WON <span style={{ color: 'var(--gold-bright)', fontSize: 16 }}>2</span></div>
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 11, letterSpacing: '0.25em', color: 'var(--text-mid)' }}>1 CONTESTED · 2 LOSING</div>
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 11, letterSpacing: '0.25em', color: 'var(--stop-text)' }}>LINES WON <span style={{ fontSize: 16 }}>2</span></div>
      </div>

      {/* War lines */}
      <div>
        <Divider>Battle Lines</Divider>
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lines.map(l => {
            const total = l.a + l.b;
            const aPct = l.a / total * 100;
            const aWin = l.a > l.b;
            return (
              <div key={l.name} style={{ padding: 16, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 140, fontFamily: 'var(--font-heraldic)', fontSize: 12, letterSpacing: '0.2em', color: l.color }}>
                    ✦ {l.name}
                  </div>
                  <span className="gold-bright" style={{ fontFamily: 'var(--font-code)', fontSize: 14, width: 40, textAlign: 'right' }}>{l.a}</span>
                  <div style={{ flex: 1, height: 14, background: 'var(--bg-inset)', border: '1px solid var(--gold-faint)', display: 'flex', position: 'relative' }}>
                    <div style={{ width: aPct + '%', background: 'var(--gold)', opacity: 0.85 }} />
                    <div style={{ flex: 1, background: 'var(--stop-text)', opacity: 0.75 }} />
                    <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--gold-bright)' }} />
                  </div>
                  <span style={{ color: 'var(--stop-text)', fontFamily: 'var(--font-code)', fontSize: 14, width: 40 }}>{l.b}</span>
                  <span className={`badge ${aWin ? 'badge-normal' : 'badge-boss'}`} style={{ width: 80, justifyContent: 'center' }}>{aWin ? 'WINNING' : 'LOSING'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingLeft: 154 }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="hex" style={{ width: 22, height: 22, background: i < 3 ? 'var(--gold-dim)' : 'var(--bg-inset)', border: `1px solid ${i < 3 ? 'var(--gold)' : 'var(--gold-faint)'}` }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contributions */}
      <div>
        <Divider>Contributions</Divider>
        <div style={{ marginTop: 18, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
          {members.map((m, i) => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px', borderBottom: i < members.length - 1 ? '1px solid var(--gold-faint)' : 'none', background: m.me ? 'rgba(200,169,110,0.06)' : 'transparent' }}>
              <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold-dim)', width: 20 }}>{String(i + 1).padStart(2, '0')}</span>
              <div className="hex" style={{ width: 24, height: 24, background: 'var(--bg-panel)', border: '1px solid var(--gold-dim)' }} />
              <span style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.08em', color: m.me ? 'var(--gold-bright)' : 'var(--text-bright)' }}>{m.name}</span>
              <span style={{ width: 120, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-mid)' }}>{m.line}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--gold-bright)', width: 60, textAlign: 'right' }}>{m.pts} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===================== Interview Autopsy =====================
function AutopsyScreen() {
  return (
    <div style={{ padding: '28px 36px 48px', display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 24 }}>
      {/* Form */}
      <div style={{ padding: 24, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.4em', color: 'var(--gold-dim)' }}>INVESTIGATION PROTOCOL</div>
        <div className="heraldic" style={{ fontSize: 22, color: 'var(--gold-bright)', marginTop: 6 }}>Interview Autopsy</div>
        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 8 }}>Report the scene. The AI will examine the body.</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 22 }}>
          <Field label="COMPANY">
            <select style={fieldStyle}><option>Yandex</option><option>Ozon</option><option>Tinkoff</option></select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="SECTION">
              <select style={fieldStyle}><option>System Design</option><option>Algorithms</option></select>
            </Field>
            <Field label="DATE">
              <input defaultValue="2026-04-14" style={fieldStyle} />
            </Field>
          </div>
          <Field label="WHAT THEY ASKED">
            <textarea rows={4} defaultValue="Design a notification service for 50M users with mixed channels (push, email, SMS). Must handle bursts of 200k/sec during live events." style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-ui)', fontSize: 11 }} />
          </Field>
          <Field label="WHAT YOU ANSWERED">
            <textarea rows={4} defaultValue="Proposed a Kafka-backed fanout with per-channel worker pools. Missed dedup and quiet hours per user. Stumbled on SMS rate limit math." style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'var(--font-ui)', fontSize: 11 }} />
          </Field>
          <Field label="OUTCOME">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'offer', c: 'var(--sec-sql-accent)', l: '✓ OFFER' },
                { v: 'reject', c: 'var(--stop-text)', l: '✗ REJECT', active: true },
                { v: 'wait', c: 'var(--gold)', l: '⋯ WAITING' },
              ].map(o => (
                <div key={o.v} style={{
                  flex: 1, padding: '10px', textAlign: 'center',
                  border: `1px solid ${o.active ? o.c : 'var(--gold-faint)'}`,
                  background: o.active ? `color-mix(in oklab, ${o.c} 10%, transparent)` : 'var(--bg-inset)',
                  color: o.active ? o.c : 'var(--text-mid)',
                  fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.2em',
                  cursor: 'pointer'
                }}>{o.l}</div>
              ))}
            </div>
          </Field>
          <button className="btn btn-primary btn-cut" style={{ marginTop: 8 }}>⚗&nbsp;SUBMIT FOR AUTOPSY</button>
        </div>
      </div>

      {/* AI Autopsy Result */}
      <div style={{ padding: 24, border: '1px solid var(--stop-border)', background: 'linear-gradient(180deg, rgba(192,57,43,0.06), transparent 40%), var(--bg-surface)', position: 'relative' }}>
        <Corners />
        <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.4em', color: 'var(--stop-text)' }}>CAUSE OF DEATH</div>
        <div className="heraldic" style={{ fontSize: 26, color: 'var(--gold-bright)', marginTop: 6 }}>Autopsy: The Notification Collapse</div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-mid)', marginTop: 4 }}>YANDEX · SYSTEM DESIGN · APR 14 · DECEASED</div>

        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Section title="PRIMARY CAUSE" color="var(--stop-text)">
            You optimized for throughput but failed user-visible requirements. Deduplication and quiet-hours are <span className="gold-bright">not optional</span> at this scale — they're table stakes. The interviewer was waiting for you to name them.
          </Section>

          <Section title="WHAT YOU SHOULD HAVE SAID" color="var(--gold)">
            "Before I design, three constraints: idempotency keys for dedup, a per-user preference & quiet-hours store, and per-channel rate limiters backed by token buckets. After that — Kafka fanout is fine."
          </Section>

          <Section title="WEAK ATLAS NODES EXPOSED" color="var(--sec-sd-accent)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {[
                { n: 'Back-Pressure & Rate Limiting', pct: 41 },
                { n: 'User Preference Stores', pct: 28 },
                { n: 'Capacity Math Under Load', pct: 53 },
              ].map(x => (
                <div key={x.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, fontSize: 11 }}>{x.n}</span>
                  <div style={{ width: 120 }} className="bar"><div className="fill" style={{ width: x.pct + '%', background: 'var(--sec-sd-accent)' }} /></div>
                  <span style={{ width: 36, textAlign: 'right', fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-mid)' }}>{x.pct}%</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="RECOVERY PATH" color="var(--sec-sql-accent)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
              <div>◈ 3 trials: <span className="gold-bright">Rate Limiter Bucket</span> — 2h total</div>
              <div>◈ 1 AI-Mock: <span className="gold-bright">User Preference System</span> — 45m</div>
              <div>◈ 1 Boss-prep: <span className="gold-bright">Yandex Notification Redux</span> — unlocks at 80% ready</div>
            </div>
            <button className="btn btn-primary btn-cut btn-sm" style={{ marginTop: 12 }}>◈&nbsp;Begin Recovery</button>
          </Section>
        </div>
      </div>
    </div>
  );
}

const fieldStyle = {
  width: '100%', background: 'var(--bg-inset)', border: '1px solid var(--gold-faint)',
  padding: '10px 12px', color: 'var(--text-bright)', outline: 'none',
  fontFamily: 'var(--font-code)', fontSize: 11
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.25em', color: 'var(--gold-dim)' }}>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, color, children }) {
  return (
    <div style={{ borderLeft: `2px solid ${color}`, paddingLeft: 14 }}>
      <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color }}>✦ {title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-bright)', marginTop: 8, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

Object.assign(window, { ArenaScreen, KataScreen, CalendarScreen, GuildWarScreen, AutopsyScreen });
