// Passive Skill Tree — the wow-moment
// Procedurally generate a large radial tree à la PoE2: central character,
// 4 quadrant clusters (Algorithms / Systems / Behavioral / AI), keystone nodes,
// notables, small passives. Pan, zoom, click to allocate.

const TREE_CLUSTERS = [
  {
    id: 'algo', name: 'АЛГОРИТМЫ', en: 'Algorithms',
    color: '#c22222', colorLit: '#e83838',
    angle: -90, // top
    keystone: { name: 'Мастер Бинарного Поиска', en: 'Master of the Bisection', desc: 'Все задачи на массивах дают +50% XP. Но ты теряешь способность к brute-force — Cursed.' },
    notables: ['Граф-Ходок', 'Кровавый DP', 'Жрец Хеша', 'Сумрачный Two-Pointer', 'Страж Инвариантов'],
  },
  {
    id: 'sys', name: 'СИСТЕМЫ', en: 'Systems',
    color: '#b5721f', colorLit: '#e09b3a',
    angle: 0, // right
    keystone: { name: 'Еретик Шардинга', en: 'Heretic of Shards', desc: 'Все вопросы по масштабированию засчитываются как Rare. Но коллбэк про монолит = автопровал.' },
    notables: ['Архивариус Кэша', 'Ведьмак CAP', 'Палач Очередей', 'Жертва Latency', 'Пророк CDN'],
  },
  {
    id: 'ai', name: 'AI·РИТУАЛ', en: 'AI Rites',
    color: '#1ba29b', colorLit: '#3dd4cc',
    angle: 90, // bottom
    keystone: { name: 'Призыватель Агентов', en: 'Summoner of Agents', desc: 'Можешь вызвать до 3 AI-призраков во время собеса. Каждый жрёт Mana. Один предаст.' },
    notables: ['Шёпот Контекста', 'Охотник Промптов', 'Кузнец Embeddings', 'Тень RAG', 'Проводник Токенов'],
  },
  {
    id: 'beh', name: 'ПОВЕДЕНИЕ', en: 'Behavioral',
    color: '#8888ff', colorLit: '#b0b0ff',
    angle: 180, // left
    keystone: { name: 'Исповедник STAR', en: 'Confessor of STAR', desc: 'Любая история автоматически структурируется. Но твои слабости становятся публичны.' },
    notables: ['Летописец Конфликтов', 'Мученик Дедлайна', 'Оратор Молчания', 'Дипломат Теней', 'Проповедник Impact'],
  },
];

function generateTree() {
  // Build a graph: center + 4 clusters, each with rings of nodes
  const nodes = [];
  const edges = [];
  // Center character node
  nodes.push({ id: 'root', x: 0, y: 0, r: 42, kind: 'character' });

  TREE_CLUSTERS.forEach((c, ci) => {
    const baseAngle = (c.angle * Math.PI) / 180;
    // Each cluster has 4 rings * ~14 nodes
    const rings = [
      { r: 140, count: 5, size: 7, kind: 'small', span: 0.55 },
      { r: 220, count: 8, size: 9, kind: 'small', span: 0.5 },
      { r: 300, count: 10, size: 8, kind: 'small', span: 0.48 },
      { r: 380, count: 8, size: 12, kind: 'notable', span: 0.46 },
      { r: 460, count: 6, size: 9, kind: 'small', span: 0.44 },
      { r: 540, count: 1, size: 24, kind: 'keystone', span: 0.2 },
    ];
    let prevRing = null;
    rings.forEach((ring, ri) => {
      const ringNodes = [];
      const clusterSpan = Math.PI * ring.span;
      for (let i = 0; i < ring.count; i++) {
        const t = ring.count === 1 ? 0.5 : i / (ring.count - 1);
        const a = baseAngle - clusterSpan / 2 + t * clusterSpan;
        const x = Math.cos(a) * ring.r;
        const y = Math.sin(a) * ring.r;
        // jitter
        const jx = x + (Math.random() - 0.5) * 12;
        const jy = y + (Math.random() - 0.5) * 12;
        const id = `${c.id}_${ri}_${i}`;
        const allocated = ci === 0 && ri < 3 && i < 4; // Algorithms partially allocated
        const reachable = !allocated && ((ci === 0 && ri <= 3) || (ci === 1 && ri === 0));
        const node = {
          id, x: jx, y: jy, r: ring.size,
          kind: ring.kind, cluster: c.id, color: c.color, colorLit: c.colorLit,
          name: ring.kind === 'keystone' ? c.keystone.name
                : ring.kind === 'notable' ? c.notables[i % c.notables.length]
                : null,
          desc: ring.kind === 'keystone' ? c.keystone.desc : null,
          allocated, reachable,
        };
        nodes.push(node);
        ringNodes.push(node);
      }
      // Connect to previous ring (nearest neighbor) or root
      ringNodes.forEach(n => {
        if (prevRing) {
          // find 1-2 closest in prev ring
          const sorted = prevRing.slice().sort((a, b) => {
            const da = (a.x - n.x) ** 2 + (a.y - n.y) ** 2;
            const db = (b.x - n.x) ** 2 + (b.y - n.y) ** 2;
            return da - db;
          });
          edges.push({ a: sorted[0].id, b: n.id });
          if (sorted.length > 1 && Math.random() < 0.25) edges.push({ a: sorted[1].id, b: n.id });
        } else {
          edges.push({ a: 'root', b: n.id });
        }
      });
      // lateral connections within ring
      for (let i = 0; i < ringNodes.length - 1; i++) {
        if (Math.random() < 0.4) edges.push({ a: ringNodes[i].id, b: ringNodes[i + 1].id });
      }
      prevRing = ringNodes;
    });
  });
  return { nodes, edges };
}

// Stable tree: generate once
let TREE_CACHE = null;
function getTree() { if (!TREE_CACHE) TREE_CACHE = generateTree(); return TREE_CACHE; }

function PassiveTreeScreen() {
  const { nodes, edges } = React.useMemo(() => getTree(), []);
  const [nodeMap] = React.useState(() => {
    const m = {};
    nodes.forEach(n => m[n.id] = n);
    return m;
  });
  const [allocated, setAllocated] = React.useState(() => {
    const s = new Set(['root']);
    nodes.filter(n => n.allocated).forEach(n => s.add(n.id));
    return s;
  });
  const [hovered, setHovered] = React.useState(null);
  const [zoom, setZoom] = React.useState(0.9);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const [searchFilter, setSearchFilter] = React.useState('');
  const dragRef = React.useRef(null);
  const svgRef = React.useRef(null);

  // Adjacency
  const adj = React.useMemo(() => {
    const a = {};
    edges.forEach(e => {
      (a[e.a] = a[e.a] || []).push(e.b);
      (a[e.b] = a[e.b] || []).push(e.a);
    });
    return a;
  }, [edges]);

  const isReachable = (id) => {
    if (allocated.has(id)) return false;
    const neighbors = adj[id] || [];
    return neighbors.some(n => allocated.has(n));
  };

  const onNodeClick = (id) => {
    if (id === 'root') return;
    const next = new Set(allocated);
    if (next.has(id)) {
      next.delete(id);
    } else if (isReachable(id)) {
      next.add(id);
    } else {
      return;
    }
    setAllocated(next);
  };

  const onMouseDown = (e) => {
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, pan: { ...pan } };
  };
  const onMouseMove = (e) => {
    if (!dragging || !dragRef.current) return;
    setPan({
      x: dragRef.current.pan.x + (e.clientX - dragRef.current.x),
      y: dragRef.current.pan.y + (e.clientY - dragRef.current.y),
    });
  };
  const onMouseUp = () => { setDragging(false); dragRef.current = null; };
  const onWheel = (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom(z => Math.max(0.2, Math.min(1.8, z + delta)));
  };

  const countByCluster = TREE_CLUSTERS.map(c => ({
    ...c,
    count: [...allocated].filter(id => id.startsWith(c.id + '_')).length,
    total: nodes.filter(n => n.cluster === c.id).length,
  }));

  return (
    <div style={{
      position: 'relative', width: '100%', height: 'calc(100vh - 60px)',
      overflow: 'hidden', background: 'radial-gradient(ellipse at center, #0f0a0a 0%, #050303 80%)',
      cursor: dragging ? 'grabbing' : 'grab',
    }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      {/* background etching */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.1 }}>
        <defs>
          <pattern id="etch" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 20 L40 20 M20 0 L20 40" stroke="#2a1010" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#etch)" />
      </svg>

      <svg ref={svgRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        viewBox="-700 -700 1400 1400"
      >
        <defs>
          <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#c22222" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#c22222" stopOpacity="0" />
          </radialGradient>
          {TREE_CLUSTERS.map(c => (
            <radialGradient key={c.id} id={`glow_${c.id}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={c.colorLit} stopOpacity="0.6" />
              <stop offset="100%" stopColor={c.colorLit} stopOpacity="0" />
            </radialGradient>
          ))}
          <filter id="nodeGlow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Outer ring decoration */}
          <circle cx="0" cy="0" r="520" fill="none" stroke="#1a0a0a" strokeWidth="1" strokeDasharray="4 8" />
          <circle cx="0" cy="0" r="480" fill="none" stroke="#2a1010" strokeWidth="0.5" />

          {/* Center glow */}
          <circle cx="0" cy="0" r="500" fill="url(#centerGlow)" />

          {/* Edges */}
          {edges.map((e, i) => {
            const a = nodeMap[e.a], b = nodeMap[e.b];
            if (!a || !b) return null;
            const bothAlloc = allocated.has(a.id) && allocated.has(b.id);
            const oneAlloc = allocated.has(a.id) || allocated.has(b.id);
            const stroke = bothAlloc ? '#e09b3a' : oneAlloc ? '#5a4020' : '#201510';
            const width = bothAlloc ? 2 : 0.8;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                         stroke={stroke} strokeWidth={width}
                         opacity={bothAlloc ? 0.9 : 0.5} />;
          })}

          {/* Nodes */}
          {nodes.map(n => {
            if (n.id === 'root') {
              return (
                <g key="root">
                  <circle cx="0" cy="0" r="60" fill="url(#centerGlow)" />
                  <circle cx="0" cy="0" r="42" fill="#1a0606" stroke="#8a1414" strokeWidth="2" />
                  <circle cx="0" cy="0" r="38" fill="#0a0404" stroke="#453015" strokeWidth="0.5" />
                  <text x="0" y="-2" textAnchor="middle" fontFamily="var(--font-display)"
                        fontSize="9" fill="#e09b3a" fontWeight="700" letterSpacing="2">
                    АСЦЕНДАНТ
                  </text>
                  <text x="0" y="12" textAnchor="middle" fontFamily="var(--font-display)"
                        fontSize="14" fill="#e8dccb" fontWeight="900" letterSpacing="1">LVL 24</text>
                </g>
              );
            }
            const isAlloc = allocated.has(n.id);
            const isReach = !isAlloc && isReachable(n.id);
            const isHover = hovered === n.id;
            const matches = !searchFilter || (n.name && n.name.toLowerCase().includes(searchFilter.toLowerCase()));
            const dim = searchFilter && !matches;

            let fill, stroke, strokeWidth;
            if (n.kind === 'keystone') {
              fill = isAlloc ? n.color : '#0a0606';
              stroke = isAlloc ? n.colorLit : isReach ? n.color : '#2a1810';
              strokeWidth = 3;
            } else if (n.kind === 'notable') {
              fill = isAlloc ? n.colorLit : '#0a0606';
              stroke = isAlloc ? '#fff' : isReach ? n.colorLit : '#2a1810';
              strokeWidth = 2;
            } else {
              fill = isAlloc ? n.colorLit : '#0a0606';
              stroke = isAlloc ? n.color : isReach ? n.color : '#2a1810';
              strokeWidth = 1;
            }

            return (
              <g key={n.id} opacity={dim ? 0.2 : 1}
                 onMouseEnter={() => setHovered(n.id)}
                 onMouseLeave={() => setHovered(null)}
                 onClick={(e) => { e.stopPropagation(); onNodeClick(n.id); }}
                 style={{ cursor: isReach || isAlloc ? 'pointer' : 'default' }}
              >
                {isAlloc && (
                  <circle cx={n.x} cy={n.y} r={n.r + 6} fill={`url(#glow_${n.cluster})`} />
                )}
                {n.kind === 'keystone' ? (
                  // Diamond/hex for keystone
                  <polygon
                    points={`${n.x},${n.y - n.r} ${n.x + n.r * 0.87},${n.y - n.r / 2} ${n.x + n.r * 0.87},${n.y + n.r / 2} ${n.x},${n.y + n.r} ${n.x - n.r * 0.87},${n.y + n.r / 2} ${n.x - n.r * 0.87},${n.y - n.r / 2}`}
                    fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                  />
                ) : n.kind === 'notable' ? (
                  <polygon
                    points={`${n.x},${n.y - n.r} ${n.x + n.r},${n.y} ${n.x},${n.y + n.r} ${n.x - n.r},${n.y}`}
                    fill={fill} stroke={stroke} strokeWidth={strokeWidth}
                  />
                ) : (
                  <circle cx={n.x} cy={n.y} r={n.r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
                )}
                {isHover && (
                  <circle cx={n.x} cy={n.y} r={n.r + 4} fill="none" stroke="#fff" strokeWidth="1" opacity="0.5" />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hovered && nodeMap[hovered] && nodeMap[hovered].id !== 'root' && (
        <HoverTooltip node={nodeMap[hovered]} allocated={allocated.has(hovered)} reachable={isReachable(hovered)} />
      )}

      {/* Left: cluster summary */}
      <div style={{ position: 'absolute', top: 16, left: 16, width: 280, zIndex: 10 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="ornament">✦</span> Путь Пробуждения <span className="ornament">✦</span></div>
          <div style={{ padding: 12 }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ink-mid)', marginBottom: 10 }}>
              <span className="ember">{allocated.size - 1}</span> / 240 нод · <span className="blood">{240 - allocated.size + 1}</span> очков
            </div>
            {countByCluster.map(c => (
              <div key={c.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ width: 8, height: 8, background: c.colorLit, boxShadow: `0 0 6px ${c.colorLit}` }} />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--ink-bright)', letterSpacing: '0.15em' }}>{c.name}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ink-mid)' }}>{c.count}/{c.total}</span>
                </div>
                <div className="bar" style={{ marginTop: 4, height: 4 }}>
                  <div className="bar-fill" style={{ width: `${(c.count / c.total) * 100}%`, background: `linear-gradient(180deg, ${c.colorLit}, ${c.color})`, boxShadow: `0 0 6px ${c.colorLit}66` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 12, marginTop: 16 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--ink-mid)', textTransform: 'uppercase' }}>Поиск</div>
          <input
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            placeholder="e.g. Кровавый, STAR, Hash…"
            style={{
              width: '100%', marginTop: 6, padding: '6px 10px',
              background: 'var(--bg-inset)', border: '1px solid var(--metal-dark)',
              fontFamily: 'var(--font-code)', fontSize: 12, color: 'var(--ink-bright)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Right: legend + zoom */}
      <div style={{ position: 'absolute', top: 16, right: 16, width: 240, zIndex: 10 }}>
        <div className="panel" style={{ padding: 0 }}>
          <div className="panel-head"><span className="ornament">✦</span> Легенда</div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { shape: 'circle', label: 'Малый пассив', en: 'Small passive' },
              { shape: 'diamond', label: 'Примечательный', en: 'Notable' },
              { shape: 'hex', label: 'Краеугольный', en: 'Keystone' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="20" height="20" viewBox="-10 -10 20 20">
                  {l.shape === 'circle' && <circle r="5" fill="#c22222" stroke="#e83838" strokeWidth="1" />}
                  {l.shape === 'diamond' && <polygon points="0,-7 7,0 0,7 -7,0" fill="#b5721f" stroke="#e09b3a" strokeWidth="1.5" />}
                  {l.shape === 'hex' && <polygon points="0,-8 7,-4 7,4 0,8 -7,4 -7,-4" fill="#1ba29b" stroke="#3dd4cc" strokeWidth="2" />}
                </svg>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--ink-bright)', letterSpacing: '0.1em' }}>{l.label}</div>
                  <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)' }}>{l.en}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 12, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="h-caps">Zoom</span>
            <span style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-lit)' }}>{(zoom * 100).toFixed(0)}%</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost" style={{ flex: 1, padding: '6px' }} onClick={() => setZoom(z => Math.max(0.2, z - 0.15))}>−</button>
            <button className="btn btn-ghost" style={{ flex: 1, padding: '6px' }} onClick={() => { setZoom(0.9); setPan({ x: 0, y: 0 }); }}>⌾</button>
            <button className="btn btn-ghost" style={{ flex: 1, padding: '6px' }} onClick={() => setZoom(z => Math.min(1.8, z + 0.15))}>+</button>
          </div>
        </div>
      </div>

      {/* Bottom: action bar */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, zIndex: 10 }}>
        <button className="btn btn-ghost">↻ Сброс</button>
        <button className="btn btn-blood">✦ Утвердить путь</button>
        <button className="btn btn-ghost">Построения</button>
      </div>

      {/* Mouse hint */}
      <div style={{ position: 'absolute', bottom: 16, right: 16, fontFamily: 'var(--font-code)', fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.1em' }}>
        ⎇ DRAG · ⌁ SCROLL · ◉ CLICK
      </div>
    </div>
  );
}

function HoverTooltip({ node, allocated, reachable }) {
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  React.useEffect(() => {
    const h = (e) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  const kind = node.kind;
  const label = kind === 'keystone' ? 'КРАЕУГОЛЬНЫЙ ПАССИВ' : kind === 'notable' ? 'ПРИМЕЧАТЕЛЬНЫЙ' : 'МАЛЫЙ ПАССИВ';
  const color = kind === 'keystone' ? '#af6025' : kind === 'notable' ? '#ffff77' : '#c8c8c8';

  return (
    <div className="tooltip" style={{
      position: 'fixed', left: Math.min(pos.x + 20, window.innerWidth - 320),
      top: Math.min(pos.y + 20, window.innerHeight - 200), zIndex: 50, pointerEvents: 'none',
      minWidth: 280, maxWidth: 320,
    }}>
      <div className="tooltip-head">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color, fontWeight: 700, letterSpacing: '0.1em' }}>
          {node.name || 'Пассив ' + node.id}
        </div>
        <div style={{ fontFamily: 'var(--font-code)', fontSize: 9, color: 'var(--ink-dim)', letterSpacing: '0.3em', marginTop: 2 }}>
          {label}
        </div>
      </div>
      <div className="tooltip-body">
        {node.desc ? (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-mid)', fontStyle: 'italic', lineHeight: 1.5 }}>
            « {node.desc} »
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-code)', fontSize: 11, color: 'var(--ember-lit)', lineHeight: 1.6 }}>
            +{10 + Math.floor(Math.random() * 20)}% к XP в {node.cluster === 'algo' ? 'алгоритмических' : node.cluster === 'sys' ? 'системных' : node.cluster === 'ai' ? 'AI' : 'поведенческих'} трайалах<br/>
            +{3 + Math.floor(Math.random() * 8)} к концентрации
          </div>
        )}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--metal-dark)',
             fontFamily: 'var(--font-code)', fontSize: 10, color: allocated ? 'var(--toxic-lit)' : reachable ? 'var(--ember-lit)' : 'var(--ink-dim)', letterSpacing: '0.15em' }}>
          {allocated ? '◉ АЛЛОЦИРОВАНО — ЛКМ чтобы снять' : reachable ? '○ ДОСТУПНО — ЛКМ чтобы взять' : '✕ НЕДОСТИЖИМО'}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PassiveTreeScreen });
