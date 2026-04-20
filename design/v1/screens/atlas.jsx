function AtlasScreen() {
  // Center + 5 branches radiating out
  const CX = 600, CY = 420;
  const branches = [
    { name: 'ALGORITHMS', color: 'var(--sec-algo-accent)', fill: 'var(--sec-algo-fill)', angle: -90 },
    { name: 'SQL',        color: 'var(--sec-sql-accent)',  fill: 'var(--sec-sql-fill)',  angle: -18 },
    { name: 'GO',         color: 'var(--sec-go-accent)',   fill: 'var(--sec-go-fill)',   angle: 54 },
    { name: 'SYSDESIGN',  color: 'var(--sec-sd-accent)',   fill: 'var(--sec-sd-fill)',   angle: 126 },
    { name: 'BEHAVIORAL', color: 'var(--sec-beh-accent)',  fill: 'var(--sec-beh-fill)',  angle: 198 },
  ];

  // build a small constellation for each branch
  const nodes = [];
  const edges = [];
  branches.forEach((b, bi) => {
    const rad = b.angle * Math.PI / 180;
    // spine nodes at distances 90, 160, 230, 300
    const dists = [90, 160, 230, 300];
    const states = ['done', 'done', bi < 2 ? 'done' : 'current', 'locked'];
    let prev = { x: CX, y: CY, id: 'center' };
    dists.forEach((d, di) => {
      const x = CX + Math.cos(rad) * d;
      const y = CY + Math.sin(rad) * d;
      const keystone = di === 1 || di === 3;
      const id = `${bi}-${di}`;
      nodes.push({ id, x, y, color: b.color, fill: b.fill, state: states[di], keystone, name: nodeName(b.name, di) });
      edges.push({ from: prev, to: { x, y }, dashed: states[di] === 'locked' });
      prev = { x, y, id };

      // offshoots off the second spine node
      if (di === 1) {
        const perp = rad + Math.PI / 2;
        [-1, 1].forEach((side, si) => {
          const ox = x + Math.cos(perp) * 50 * side;
          const oy = y + Math.sin(perp) * 50 * side;
          const oState = bi < 2 ? (si === 0 ? 'done' : 'current') : 'locked';
          nodes.push({ id: `${bi}-${di}-${si}`, x: ox, y: oy, color: b.color, fill: b.fill, state: oState, keystone: false, name: nodeName(b.name, di + 5 + si) });
          edges.push({ from: { x, y }, to: { x: ox, y: oy }, dashed: oState === 'locked' });
        });
      }
    });
  });

  // Ascendant node — top-right, special
  const ascX = CX + 360, ascY = CY - 200;
  nodes.push({ id: 'asc', x: ascX, y: ascY, ascendant: true, name: 'ASCENDANT — Pyre of the Architect' });
  edges.push({ from: { x: CX + Math.cos(branches[2].angle * Math.PI/180)*160, y: CY + Math.sin(branches[2].angle * Math.PI/180)*160 }, to: { x: ascX, y: ascY }, ascendant: true });

  function nodeName(branch, i) {
    const names = {
      ALGORITHMS: ['Big-O Literate', 'Tree Lord', 'DP Initiate', 'Graph Weaver', 'Bitmask Savant', 'Amortized Mind'],
      SQL: ['Query Planner', 'Index Whisperer', 'CTE Architect', 'Window Mage', 'Sharded Vision'],
      GO: ['Goroutine Oath', 'Context Keeper', 'Channel Smith', 'Zero-Alloc Rune', 'Profiler Sigil'],
      SYSDESIGN: ['CAP Triad', 'Consistent Hashing', 'Event Streams', 'Back-Pressure', 'Sharding Seal'],
      BEHAVIORAL: ['STAR Recall', 'Silent Confidence', 'Conflict Harmony', 'Leadership Aura'],
    };
    return names[branch][i % names[branch].length];
  }

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 48px)', background: 'var(--bg-base)', overflow: 'hidden' }}>
      {/* dotted grid bg */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(74, 60, 40, 0.35) 1px, transparent 1px)',
        backgroundSize: '28px 28px'
      }} />

      {/* Top toolbar */}
      <div style={{ position: 'absolute', top: 16, left: 20, right: 20, display: 'flex', alignItems: 'center', gap: 18, zIndex: 5 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heraldic)', fontSize: 10, color: 'var(--gold-dim)', letterSpacing: '0.35em' }}>SKILL ATLAS · SEASON II</div>
          <div className="heraldic" style={{ fontSize: 22, color: 'var(--gold-bright)' }}>Your Woven Path</div>
        </div>
        <div className="grow" />
        <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.18em' }}>
          <div className="card corners" style={{ padding: '6px 12px' }}><Corners /><span className="muted">POINTS&nbsp;</span><span className="gold-bright">14 / 60</span></div>
          <div className="card corners" style={{ padding: '6px 12px' }}><Corners /><span className="muted">NODES&nbsp;</span><span className="gold-bright">38 / 94</span></div>
        </div>
      </div>

      {/* SVG canvas */}
      <svg viewBox="0 0 1200 840" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {/* edges */}
        {edges.map((e, i) => (
          <line key={i} x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y}
            stroke={e.ascendant ? '#c8a96e' : e.dashed ? '#2a2d38' : '#4a3c28'}
            strokeWidth={e.ascendant ? 1.5 : 1}
            strokeDasharray={e.dashed ? '3 4' : e.ascendant ? '6 4' : 'none'} />
        ))}

        {/* branch labels */}
        {branches.map((b, i) => {
          const rad = b.angle * Math.PI / 180;
          const lx = CX + Math.cos(rad) * 340;
          const ly = CY + Math.sin(rad) * 340;
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle"
              fill={b.color} fontFamily="var(--font-heraldic)" fontSize="11" letterSpacing="4" fontWeight="700">
              ✦ {b.name} ✦
            </text>
          );
        })}

        {/* nodes */}
        {nodes.map(n => {
          if (n.ascendant) {
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <circle r="38" fill="rgba(200,169,110,0.06)" stroke="#4a3c28" strokeDasharray="2 3" />
                <polygon points="0,-24 24,0 0,24 -24,0" fill="#12141a" stroke="#e8c87a" strokeWidth="1.5" />
                <polygon points="0,-14 14,0 0,14 -14,0" fill="#c8a96e" opacity="0.3" />
                <text y="4" textAnchor="middle" fill="#e8c87a" fontSize="14" fontFamily="serif">⚜</text>
              </g>
            );
          }
          const r = n.keystone ? 14 : 9;
          const isDone = n.state === 'done';
          const isCur = n.state === 'current';
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              {isDone && <circle r={r + 4} fill="none" stroke={n.color} strokeOpacity="0.3" />}
              <circle r={r}
                fill={isDone ? n.fill : '#12141a'}
                stroke={isDone || isCur ? n.color : '#2a2d38'}
                strokeWidth={n.keystone ? 1.5 : 1} />
              {isDone && <text y="3" textAnchor="middle" fill={n.color} fontSize="10">✓</text>}
              {isCur && <circle r={r - 3} fill={n.color} opacity="0.5" />}
            </g>
          );
        })}

        {/* center node */}
        <g transform={`translate(${CX},${CY})`}>
          <circle r="32" fill="none" stroke="#4a3c28" strokeDasharray="2 3" />
          <circle r="20" fill="#181c24" stroke="#e8c87a" strokeWidth="1.5" />
          <polygon points="0,-12 10,0 0,12 -10,0" fill="#c8a96e" />
          <text y="30" textAnchor="middle" fill="#e8c87a" fontSize="8" fontFamily="var(--font-heraldic)" letterSpacing="2">ARCHITECT</text>
        </g>

        {/* hover tooltip example — hardcoded for static demo */}
        <g transform="translate(690,420)">
          <rect x="0" y="-50" width="180" height="72" fill="#0a0c10" stroke="#c8a96e" />
          <polygon points="0,-50 8,-50 8,-42 0,-42" fill="#c8a96e" />
          <polygon points="180,-50 172,-50 172,-42 180,-42" fill="#c8a96e" />
          <text x="10" y="-32" fill="#e8c87a" fontSize="10" fontFamily="var(--font-heraldic)" letterSpacing="2">CONSISTENT HASHING</text>
          <text x="10" y="-16" fill="#9a8c76" fontSize="9" fontFamily="var(--font-ui)">Keystone · System Design</text>
          <text x="10" y="0" fill="#e8dcc8" fontSize="9" fontFamily="var(--font-ui)">Reduce rebalance cost in shard</text>
          <text x="10" y="12" fill="#e8dcc8" fontSize="9" fontFamily="var(--font-ui)">rings. +8% SysDesign ELO cap.</text>
        </g>
      </svg>

      {/* Bottom legend */}
      <div style={{ position: 'absolute', bottom: 18, left: 20, right: 20, display: 'flex', gap: 16, zIndex: 5 }}>
        <div className="card corners" style={{ padding: '10px 16px', background: 'var(--bg-surface)', display: 'flex', gap: 22 }}>
          <Corners />
          {[
            { c: 'var(--sec-algo-accent)', n: 'Algorithms' },
            { c: 'var(--sec-sql-accent)',  n: 'SQL' },
            { c: 'var(--sec-go-accent)',   n: 'Go / Backend' },
            { c: 'var(--sec-sd-accent)',   n: 'System Design' },
            { c: 'var(--sec-beh-accent)',  n: 'Behavioral' },
          ].map(s => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, background: s.c, display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-mid)' }}>{s.n.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div className="grow" />
        <div className="card corners" style={{ padding: '10px 16px', background: 'var(--bg-surface)', display: 'flex', gap: 16, alignItems: 'center' }}>
          <Corners />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.25em', color: 'var(--gold-dim)' }}>LEGEND</span>
          <span style={{ color: 'var(--gold)' }}>◆ Keystone</span>
          <span style={{ color: 'var(--gold-bright)' }}>⚜ Ascendancy</span>
          <span style={{ color: 'var(--text-dim)' }}>◇ Locked</span>
        </div>
      </div>
    </div>
  );
}

window.AtlasScreen = AtlasScreen;
