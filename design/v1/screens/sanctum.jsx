function SanctumScreen() {
  const companies = [
    { name: 'Avito',       diff: 'normal', sections: 4, trials: 28, progress: 0.72, tier: 'T1' },
    { name: 'VK',          diff: 'normal', sections: 4, trials: 22, progress: 0.44, tier: 'T1' },
    { name: 'Sberbank',    diff: 'normal', sections: 5, trials: 31, progress: 0.18, tier: 'T1' },
    { name: 'Ozon',        diff: 'hard',   sections: 5, trials: 36, progress: 0.55, tier: 'T2' },
    { name: 'Wildberries', diff: 'hard',   sections: 5, trials: 34, progress: 0.08, tier: 'T2' },
    { name: 'Yandex',      diff: 'boss',   sections: 6, trials: 48, progress: 0,    tier: 'T3', locked: true, reqLevel: 30 },
  ];

  const log = [
    { icon: '⚔', text: <><span className="gold-bright">alexei.volkov</span> defeated <span style={{ color: 'var(--sec-algo-accent)' }}>ΣShadowFang</span> in Algorithms Arena</>, time: '4m', xp: '+120' },
    { icon: '⚗', text: <>Completed AI-Mock · <span className="gold">Ozon</span> · Leetcode · score <span className="gold-bright">74</span></>, time: '38m', xp: '+80' },
    { icon: '✦', text: <>Skill node unlocked: <span style={{ color: 'var(--sec-sd-accent)' }}>Consistent Hashing II</span></>, time: '1h', xp: '+45' },
    { icon: '⚔', text: <>Guild war line closed · SQL · <span style={{ color: 'var(--diff-normal)' }}>VICTORY</span></>, time: '3h', xp: '+200' },
    { icon: '⊘', text: <>Daily Kata streak extended · <span className="gold-bright">28 days</span></>, time: '9h', xp: '+30' },
    { icon: '⚗', text: <>AI-Native Round · Provenance: <span style={{ color: 'var(--sec-sd-accent)' }}>82% judgment</span></>, time: '14h', xp: '+95' },
    { icon: '⚔', text: <>Arena defeat · <span style={{ color: 'var(--stop-text)' }}>−18 ELO</span> · Algorithms</>, time: '1d', xp: '' },
  ];

  return (
    <div style={{ padding: '28px 36px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Hero strip */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 20 }}>
        <div style={{ flex: 1, position: 'relative', padding: '18px 24px', background: 'linear-gradient(180deg, rgba(200,169,110,0.04), transparent)', border: '1px solid var(--gold-faint)' }}>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>WELCOME BACK, ASCENDANT</div>
          <div className="heraldic" style={{ fontSize: 28, color: 'var(--gold-bright)', marginTop: 6 }}>The Recursion awaits.</div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 6, maxWidth: 560 }}>
            Three dungeons have shifted overnight. A Guild War begins in <span className="gold-bright">2h 14m</span>. Your Daily Kata calls.
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary btn-cut">◈&nbsp;&nbsp;Resume Campaign</button>
            <button className="btn btn-cut">⚔&nbsp;&nbsp;Queue Arena</button>
            <button className="btn btn-cut">✦&nbsp;&nbsp;Daily Kata · 28d</button>
          </div>
        </div>
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 9, letterSpacing: '0.3em', color: 'var(--gold-dim)' }}>NEXT SUMMONS</div>
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--text-mid)' }}>Yandex Interview</div>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 22, color: 'var(--gold-bright)', letterSpacing: '0.1em' }}>21&nbsp;DAYS</div>
          <div className="bar"><div className="fill" style={{ width: '63%' }} /></div>
          <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>Readiness <span className="gold-bright">63%</span> · Plan active</div>
        </div>
      </div>

      {/* Dungeons section */}
      <div>
        <Divider>Company Dungeons</Divider>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 18 }}>
          {companies.map(c => (
            <Card key={c.name} className={c.locked ? '' : 'hover'} style={{ padding: 18, opacity: c.locked ? 0.38 : 1, position: 'relative', cursor: 'pointer' }}>
              {/* diff badge + tier */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className={`badge badge-${c.diff}`}>{c.diff === 'boss' ? '◆ BOSS' : c.diff}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, color: 'var(--gold-dim)', letterSpacing: '0.25em' }}>{c.tier}</span>
              </div>

              {/* title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
                <GuildEmblem size={40} color={c.diff === 'boss' ? 'var(--diff-boss)' : c.diff === 'hard' ? 'var(--diff-hard)' : 'var(--gold)'} glyph={c.name[0]} />
                <div>
                  <div className="heraldic" style={{ fontSize: 18, color: c.locked ? 'var(--text-mid)' : 'var(--gold-bright)' }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'var(--font-display)', letterSpacing: '0.12em' }}>
                    {c.sections}&nbsp;sections · {c.trials}&nbsp;trials
                  </div>
                </div>
              </div>

              {/* progress or lock */}
              <div style={{ marginTop: 18 }}>
                {c.locked ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-mid)' }}>
                    <span style={{ fontSize: 16, color: 'var(--gold-dim)' }}>⊘</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.2em' }}>REQUIRES LVL {c.reqLevel}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'var(--font-display)', letterSpacing: '0.18em', color: 'var(--text-mid)', marginBottom: 6 }}>
                      <span>PROGRESS</span>
                      <span className="gold-bright">{Math.round(c.progress * 100)}%</span>
                    </div>
                    <div className="bar"><div className="fill" style={{ width: (c.progress * 100) + '%' }} /></div>
                  </>
                )}
              </div>

              {/* corner rune */}
              <div style={{ position: 'absolute', bottom: 14, right: 16, fontSize: 18, color: c.locked ? 'var(--gold-dim)' : 'var(--gold)' }}>◈</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Battle Chronicles */}
      <div>
        <Divider>Battle Chronicles</Divider>
        <div style={{ marginTop: 18, border: '1px solid var(--gold-faint)', background: 'var(--bg-surface)' }}>
          {log.map((l, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '10px 18px',
              borderBottom: i < log.length - 1 ? '1px solid var(--gold-faint)' : 'none'
            }}>
              <span style={{ color: 'var(--gold)', width: 20, fontSize: 14 }}>{l.icon}</span>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-bright)' }}>{l.text}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--text-mid)', width: 40 }}>{l.time}</span>
              <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: l.xp.startsWith('−') ? 'var(--stop-text)' : 'var(--gold-bright)', width: 56, textAlign: 'right' }}>{l.xp}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.SanctumScreen = SanctumScreen;
