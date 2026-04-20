function ProfileScreen() {
  const heat = [
    [0,2,4,1,3,2,1],
    [3,2,0,4,1,2,3],
    [1,4,2,3,4,0,2],
    [2,3,1,4,3,2,4],
  ].flat();

  const careerStages = [
    { name: 'Junior', done: true },
    { name: 'Middle', done: true },
    { name: 'Senior', done: true, current: true },
    { name: 'Staff',  done: false },
    { name: 'Principal', done: false, big: true },
  ];

  const metrics = [
    { label: 'TRIALS CLEARED', val: '47', delta: '+12', sub: 'vs last week' },
    { label: 'ARENA W/L',       val: '19 / 8', delta: '+7', sub: '70% winrate' },
    { label: 'RATING Δ',        val: '+84', delta: 'ELO 2498', sub: 'Algorithms' },
    { label: 'XP EARNED',       val: '3,840', delta: '+920', sub: 'Tier 18' },
  ];

  const recs = [
    { icon: '◈', title: 'Weak Node — Consistent Hashing', body: 'Your SysDesign is at 54%. 3 trials this week will bring it to 67%.', cta: 'Begin Path' },
    { icon: '⚗', title: 'Stress Pattern Detected', body: 'You degrade 40% after minute 28. Try longer mocks to build endurance.', cta: 'Queue 60m Mock' },
    { icon: '⚔', title: 'Arena Matchup Favorable', body: 'ΣShadowFang dropped 80 ELO. Next Algorithms queue is prime time.', cta: 'Queue Arena' },
  ];

  return (
    <div style={{ padding: '28px 36px 48px', display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Hero */}
      <div style={{ display: 'flex', gap: 28, alignItems: 'stretch' }}>
        <div style={{
          display: 'flex', gap: 28, alignItems: 'center',
          padding: '24px 32px', flex: 1,
          background: 'radial-gradient(ellipse at 30% 50%, rgba(200,169,110,0.05), transparent 60%), var(--bg-surface)',
          border: '1px solid var(--gold-faint)', position: 'relative'
        }}>
          <CharacterPortrait size={220} level={24} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: '0.35em' }}>
              SEASON II · THE RECURSION
            </div>
            <div className="heraldic" style={{ fontSize: 38, color: 'var(--gold-bright)', marginTop: 6, lineHeight: 1 }}>Alexei Volkov</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--gold)', letterSpacing: '0.22em', marginTop: 10 }}>
              ASCENDANT · BACKEND ARCHITECT · LVL 24
            </div>
            <div style={{ marginTop: 20, maxWidth: 440 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: '0.2em', color: 'var(--text-mid)', marginBottom: 5 }}>
                <span>EXPERIENCE</span>
                <span className="gold-bright">18,420 / 29,700</span>
              </div>
              <div className="bar bar-tall"><div className="fill" style={{ width: '62%' }} /></div>
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
              {[
                { n: 'Intellect', v: 14 }, { n: 'Strength', v: 11 },
                { n: 'Dexterity', v: 9 }, { n: 'Will', v: 8 },
              ].map(a => (
                <div key={a.n}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--text-mid)', letterSpacing: '0.2em' }}>{a.n.toUpperCase()}</div>
                  <div className="heraldic" style={{ fontSize: 22, color: 'var(--gold-bright)' }}>{a.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--gold-faint)' }}>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>COSMETICS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['Ember Aura', 'Wolf Frame', 'Recursion Title', 'Guild Emblem'].map(x => (
              <div key={x} style={{ border: '1px solid var(--gold-faint)', padding: 10, textAlign: 'center' }}>
                <div style={{ color: 'var(--gold)', fontSize: 20 }}>⚜</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.15em', color: 'var(--text-mid)', marginTop: 4 }}>{x.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly AI Report */}
      <div>
        <Divider>Weekly Report</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 18 }}>
          {metrics.map(m => (
            <Card key={m.label} style={{ padding: 16 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--text-mid)', letterSpacing: '0.22em' }}>{m.label}</div>
              <div className="heraldic" style={{ fontSize: 30, color: 'var(--gold-bright)', marginTop: 8, lineHeight: 1 }}>{m.val}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10 }}>
                <span style={{ color: 'var(--sec-sql-accent)', fontFamily: 'var(--font-code)' }}>{m.delta}</span>
                <span style={{ color: 'var(--text-mid)' }}>{m.sub}</span>
              </div>
            </Card>
          ))}
        </div>

        {/* Heatmap + recs side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 16, marginTop: 20 }}>
          <Card style={{ padding: 18 }}>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold)' }}>ACTIVITY HEATMAP</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>Last 4 weeks · gold intensity = XP earned that day</div>
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px repeat(7, 1fr)', gap: 4 }}>
                <span />
                {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d => (
                  <div key={d} style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.2em', color: 'var(--gold-dim)', textAlign: 'center' }}>{d}</div>
                ))}
                {Array.from({ length: 4 }).map((_, wi) => (
                  <React.Fragment key={wi}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 8, letterSpacing: '0.18em', color: 'var(--gold-dim)' }}>W{4 - wi}</div>
                    {Array.from({ length: 7 }).map((_, di) => {
                      const v = heat[wi * 7 + di];
                      const op = v === 0 ? 0.05 : 0.2 + v * 0.2;
                      return (
                        <div key={di} style={{
                          aspectRatio: '1', background: `rgba(200, 169, 110, ${op})`,
                          border: '1px solid var(--gold-faint)'
                        }} />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.18em', color: 'var(--text-mid)' }}>
              <span>LESS</span>
              <div style={{ display: 'flex', gap: 3 }}>
                {[0.05, 0.25, 0.45, 0.65, 0.85].map((o, i) => (
                  <span key={i} style={{ width: 12, height: 12, background: `rgba(200,169,110,${o})`, border: '1px solid var(--gold-faint)' }} />
                ))}
              </div>
              <span>MORE</span>
            </div>
          </Card>

          <Card style={{ padding: 18 }}>
            <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold)' }}>AI RECOMMENDATIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {recs.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, padding: 12, border: '1px solid var(--gold-faint)', background: 'var(--bg-inset)' }}>
                  <div style={{ width: 36, height: 36, border: '1px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontSize: 18, flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', color: 'var(--gold-bright)' }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 3 }}>{r.body}</div>
                  </div>
                  <button className="btn btn-sm">{r.cta}</button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Career line */}
      <div>
        <Divider>Career Path</Divider>
        <div style={{ marginTop: 24, padding: '18px 24px', border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ position: 'absolute', top: '50%', left: 8, right: 8, height: 1, background: 'var(--gold-dim)', zIndex: 0 }} />
            {careerStages.map((s, i) => (
              <div key={s.name} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', padding: '0 14px' }}>
                <div style={{
                  width: s.big ? 24 : 18, height: s.big ? 24 : 18,
                  transform: 'rotate(45deg)',
                  background: s.current ? 'var(--gold)' : s.done ? 'var(--gold-dim)' : 'var(--bg-inset)',
                  border: `1px solid ${s.current ? 'var(--gold-bright)' : 'var(--gold-dim)'}`,
                  boxShadow: s.current ? '0 0 0 4px rgba(200,169,110,0.15)' : 'none'
                }} />
                <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 11, letterSpacing: '0.22em',
                  color: s.current ? 'var(--gold-bright)' : s.done ? 'var(--text-bright)' : 'var(--text-dim)'
                }}>{s.name}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 16, fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.2em', color: 'var(--text-mid)' }}>
            ON THE PATH TO <span className="gold-bright">STAFF ENGINEER</span> · 3 TRIALS REMAIN
          </div>
        </div>
      </div>
    </div>
  );
}

window.ProfileScreen = ProfileScreen;
