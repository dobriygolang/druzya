function MobileKataScreen() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
      padding: '36px 24px 48px', gap: 32, flexWrap: 'wrap'
    }}>
      {/* Phone frame */}
      <div style={{ width: 340, height: 680, background: '#000', border: '1px solid var(--gold-dim)', padding: 8, position: 'relative' }}>
        <Corners />
        <div style={{ width: '100%', height: '100%', background: 'var(--bg-base)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* status bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px 6px', fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--gold-dim)' }}>
            <span>9:42</span>
            <span>● ● ● 5G</span>
          </div>
          {/* topbar */}
          <div style={{ padding: '6px 16px 12px', borderBottom: '1px solid var(--gold-faint)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 22 22">
              <polygon points="11,1 20,6 20,16 11,21 2,16 2,6" fill="none" stroke="#c8a96e" strokeWidth="1.2" />
              <polygon points="11,6 15,8.5 15,13.5 11,16 7,13.5 7,8.5" fill="#c8a96e" />
            </svg>
            <span className="heraldic" style={{ fontSize: 12, color: 'var(--gold-bright)' }}>DRUZ9</span>
            <div className="grow" />
            <span style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, color: 'var(--gold)', letterSpacing: '0.2em' }}>LVL 24</span>
          </div>

          {/* Streak block */}
          <div style={{ padding: '22px 16px', textAlign: 'center', background: 'radial-gradient(ellipse at center, rgba(239,159,39,0.08), transparent 60%)', borderBottom: '1px solid var(--gold-faint)' }}>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.4em', color: 'var(--gold)' }}>STREAK</div>
            <div className="heraldic" style={{ fontSize: 64, color: 'var(--gold-bright)', lineHeight: 1 }}>28</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold-dim)', marginTop: 4 }}>DAYS UNBROKEN</div>
          </div>

          {/* Week dots */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--gold-faint)' }}>
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 8, color: 'var(--gold-dim)', letterSpacing: '0.2em' }}>{d}</div>
                <div style={{
                  width: 18, height: 18, margin: '4px auto', transform: 'rotate(45deg)',
                  background: i < 4 ? 'var(--gold)' : 'var(--bg-inset)',
                  border: `1px solid ${i === 4 ? 'var(--gold-bright)' : 'var(--gold-dim)'}`
                }} />
              </div>
            ))}
          </div>

          {/* Today's task */}
          <div style={{ padding: 16, flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>TODAY'S KATA</div>
            <div className="heraldic" style={{ fontSize: 18, color: 'var(--gold-bright)', marginTop: 4 }}>Serialize Tree</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <span className="badge badge-hard">⚠ CURSED</span>
              <span className="badge badge-dim">12 MIN</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 12, lineHeight: 1.5 }}>
              Design serialize/deserialize for a binary tree. Cursed: delete key disabled. <span className="gold-bright">×3 XP</span>.
            </div>

            {/* Telegram-style notif */}
            <div style={{ marginTop: 20, padding: 12, border: '1px solid var(--gold-faint)', background: 'var(--bg-inset)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, background: 'var(--sec-algo-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'serif' }}>✈</div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--gold-bright)' }}>@druz9_bot</div>
                  <div style={{ fontSize: 9, color: 'var(--text-mid)' }}>9:02 · Telegram</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-bright)', marginTop: 8, lineHeight: 1.45 }}>
                ⚜ Your Kata for today is ready, Ascendant. Miss it and your streak burns at 21:00.
              </div>
            </div>

            <button className="btn btn-primary btn-cut" style={{ width: '100%', marginTop: 20, padding: '14px' }}>✦&nbsp;&nbsp;BEGIN KATA</button>
          </div>
        </div>
      </div>

      {/* Mobile Profile summary */}
      <div style={{ width: 340, height: 680, background: '#000', border: '1px solid var(--gold-dim)', padding: 8, position: 'relative' }}>
        <Corners />
        <div style={{ width: '100%', height: '100%', background: 'var(--bg-base)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px 6px', fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--gold-dim)' }}>
            <span>9:42</span><span>● ● ● 5G</span>
          </div>
          <div style={{ padding: '20px 16px', textAlign: 'center', borderBottom: '1px solid var(--gold-faint)' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <CharacterPortrait size={130} level={24} />
            </div>
            <div className="heraldic" style={{ fontSize: 18, color: 'var(--gold-bright)', marginTop: 8 }}>Alexei Volkov</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--gold)', letterSpacing: '0.22em', marginTop: 3 }}>ASCENDANT · LVL 24</div>
            <div style={{ marginTop: 14 }}>
              <div className="bar"><div className="fill" style={{ width: '62%' }} /></div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-code)', color: 'var(--text-mid)', marginTop: 4 }}>18,420 / 29,700 XP</div>
            </div>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { l: 'THIS WEEK', v: '47', s: 'trials cleared' },
              { l: 'ARENA RATING', v: '2,498', s: 'Algorithms' },
              { l: 'GUILD WAR', v: '2 — 2', s: '1 line contested' },
              { l: 'STREAK', v: '28 days', s: '❄ 2 freeze' },
            ].map(s => (
              <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px', border: '1px solid var(--gold-faint)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.25em', color: 'var(--gold-dim)' }}>{s.l}</div>
                  <div className="heraldic" style={{ fontSize: 16, color: 'var(--gold-bright)' }}>{s.v}</div>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{s.s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ================== Onboarding (5 compact panels) ==================
function OnboardingScreen() {
  const panels = [
    { n: 1, t: 'CHOOSE YOUR PATH', children: (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
        {[
          { i: '◈', l: 'PREPARE', d: 'I have a real interview soon', sel: true },
          { i: '⚔', l: 'COMPETE', d: 'I want the top of the ladder' },
          { i: '✦', l: 'PRACTICE', d: 'Steady growth, daily drills' },
        ].map(p => (
          <div key={p.l} style={{ padding: 18, border: `1px solid ${p.sel ? 'var(--gold)' : 'var(--gold-faint)'}`, background: p.sel ? 'rgba(200,169,110,0.05)' : 'var(--bg-inset)', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: 28, color: p.sel ? 'var(--gold-bright)' : 'var(--gold)' }}>{p.i}</div>
            <div className="heraldic" style={{ fontSize: 13, color: p.sel ? 'var(--gold-bright)' : 'var(--text-bright)', marginTop: 10 }}>{p.l}</div>
            <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 4 }}>{p.d}</div>
          </div>
        ))}
      </div>
    )},
    { n: 2, t: 'QUICK ASSESSMENT', children: (
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.22em', color: 'var(--text-mid)' }}>
          <span>QUESTION 3 OF 5</span>
          <span className="gold-bright">ALGORITHMS · MEDIUM</span>
        </div>
        <div className="bar" style={{ marginTop: 6 }}><div className="fill" style={{ width: '60%' }} /></div>
        <div style={{ fontSize: 12, color: 'var(--text-bright)', marginTop: 18, lineHeight: 1.6 }}>
          Given a sorted array with duplicates, what's the best way to find the first occurrence of a value?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          {['Linear scan from left', 'Binary search with left-bias', 'Hash set', 'Recursive partition'].map((x, i) => (
            <div key={x} style={{ padding: 10, border: `1px solid ${i === 1 ? 'var(--gold)' : 'var(--gold-faint)'}`, background: i === 1 ? 'rgba(200,169,110,0.06)' : 'var(--bg-inset)', fontSize: 11, color: i === 1 ? 'var(--gold-bright)' : 'var(--text-bright)' }}>
              <span style={{ color: i === 1 ? 'var(--gold)' : 'var(--gold-dim)', marginRight: 10 }}>◆</span>{x}
            </div>
          ))}
        </div>
      </div>
    )},
    { n: 3, t: 'YOUR CHARACTER', children: (
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginTop: 14 }}>
        <CharacterPortrait size={150} level={1} aura={false} />
        <div>
          <div className="heraldic" style={{ fontSize: 22, color: 'var(--gold-bright)' }}>Backend Initiate</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.22em', color: 'var(--gold)', marginTop: 4 }}>STARTING CLASS</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 10, maxWidth: 260, lineHeight: 1.5 }}>
            Strong start in Go, weak in Behavioral. Specialize toward <span className="gold-bright">Architect</span> or <span className="gold-bright">Algorithmist</span> by Lvl 10.
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            {[{n:'INT',v:7},{n:'STR',v:5},{n:'DEX',v:6},{n:'WIL',v:3}].map(a => (
              <div key={a.n}><div style={{ fontSize: 8, fontFamily: 'var(--font-display)', letterSpacing: '0.22em', color: 'var(--text-mid)' }}>{a.n}</div><div className="heraldic" style={{ fontSize: 18, color: 'var(--gold-bright)' }}>{a.v}</div></div>
            ))}
          </div>
        </div>
      </div>
    )},
    { n: 4, t: 'FIRST DUNGEON', children: (
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.5 }}>
            Your first trial awaits in <span className="gold-bright">Avito</span>. One Easy task. Clear it to earn your first XP and unlock the Arena.
          </div>
          <button className="btn btn-primary btn-cut" style={{ marginTop: 14 }}>◈&nbsp;Enter Dungeon</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 24, color: 'var(--gold)' }}>→</div>
          <div style={{ padding: 14, border: '1px solid var(--gold)', background: 'var(--bg-inset)', width: 140, textAlign: 'center' }}>
            <GuildEmblem size={36} color="var(--gold)" glyph="A" />
            <div className="heraldic" style={{ fontSize: 13, color: 'var(--gold-bright)', marginTop: 8 }}>AVITO</div>
            <span className="badge badge-normal" style={{ marginTop: 6 }}>NORMAL</span>
          </div>
        </div>
      </div>
    )},
    { n: 5, t: "WHAT'S NEXT", children: (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
        {['◈ AI-MOCK', '⚔ QUEUE ARENA', '✦ INVITE FRIEND'].map(b => (
          <button key={b} className="btn btn-cut" style={{ padding: '18px 10px', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 22, color: 'var(--gold)' }}>{b.charAt(0)}</span>
            <span>{b.slice(2)}</span>
          </button>
        ))}
      </div>
    )},
  ];

  return (
    <div style={{ padding: '28px 36px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {panels.map(p => (
        <div key={p.n} style={{ padding: 24, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 32, height: 32, transform: 'rotate(45deg)', border: '1px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ transform: 'rotate(-45deg)', fontFamily: 'var(--font-heraldic)', fontSize: 12, color: 'var(--gold-bright)' }}>{p.n}</span>
            </div>
            <div className="heraldic" style={{ fontSize: 14, color: 'var(--gold)', letterSpacing: '0.3em' }}>✦ {p.t}</div>
          </div>
          {p.children}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { MobileKataScreen, OnboardingScreen });
