/* Hone — full-screen meditative pages w/ persistent timer dock. */
const { useState, useEffect, useRef, useMemo } = React;

/* ────────────────────────────── Primitives ────────────────────────── */
const Kbd = ({ children }) => <span className="kbd">{children}</span>;

const Icon = ({ name, size = 14, stroke = "currentColor" }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "menu":    return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case "play":    return <svg {...p}><path d="M7 5l13 7-13 7z" fill="currentColor" stroke="none"/></svg>;
    case "pause":   return <svg {...p}><rect x="7" y="5" width="3" height="14" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3" height="14" fill="currentColor" stroke="none"/></svg>;
    case "volume":  return <svg {...p}><path d="M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8M19 5a9 9 0 010 14"/></svg>;
    case "sparkle": return <svg {...p}><path d="M12 3l1.7 5 5 1.7-5 1.7L12 17l-1.7-5.6L5 9.7l5-1.7z"/></svg>;
    case "arrow":   return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "x":       return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    default: return null;
  }
};

/* ────────────────────────────── Canvas bg ─────────────────────────── */
const STARS = [
  { x: 8, y: 14, r: 1.1, o: 0.45 }, { x: 17, y: 72, r: 1, o: 0.35 },
  { x: 23, y: 28, r: 1.3, o: 0.55 }, { x: 31, y: 84, r: 0.9, o: 0.3 },
  { x: 39, y: 12, r: 1, o: 0.4 }, { x: 44, y: 58, r: 1.1, o: 0.5 },
  { x: 52, y: 22, r: 0.9, o: 0.3 }, { x: 58, y: 80, r: 1.2, o: 0.55 },
  { x: 63, y: 38, r: 1, o: 0.4 }, { x: 68, y: 64, r: 0.9, o: 0.35 },
  { x: 73, y: 18, r: 1.1, o: 0.5 }, { x: 78, y: 48, r: 1, o: 0.4 },
  { x: 83, y: 74, r: 0.9, o: 0.3 }, { x: 88, y: 30, r: 1.2, o: 0.6 },
  { x: 92, y: 58, r: 1, o: 0.45 }, { x: 14, y: 44, r: 0.9, o: 0.35 },
  { x: 46, y: 90, r: 1, o: 0.3 }, { x: 3, y: 62, r: 1.1, o: 0.45 },
  { x: 36, y: 50, r: 0.9, o: 0.3 }, { x: 71, y: 88, r: 1, o: 0.4 },
];
const WAVES = [
  "M-50,280 C 260,220 420,340 700,290 S 1200,200 1700,260",
  "M-50,390 C 200,350 500,430 820,390 S 1300,340 1700,380",
  "M-50,500 C 240,470 520,560 860,510 S 1340,450 1700,490",
  "M-50,605 C 300,580 620,660 920,620 S 1380,570 1700,600",
  "M-50,700 C 280,680 560,750 900,720 S 1360,680 1700,705",
  "M-50,790 C 320,770 640,820 960,800 S 1420,770 1700,790",
];

function CanvasBg({ mode = "full" }) {
  // mode: "full" (home/stats), "quiet" (today/notes/whiteboard — just a few stars), "void" (focus — nothing)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode !== "full") return;
    let raf;
    const loop = () => { setTick(t => t + 0.1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  if (mode === "void") return null;

  const starOp = mode === "full" ? 1 : 0.35;
  const showWaves = mode === "full";
  const showSquares = mode === "full";

  return (
    <div style={{ position:"absolute", inset: 0, overflow:"hidden", pointerEvents:"none" }}>
      <svg width="100%" height="100%" style={{ position:"absolute", inset: 0 }}>
        {STARS.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r}
            fill={`rgba(255,255,255,${s.o * starOp})`}/>
        ))}
      </svg>
      {showWaves && (
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none"
             style={{ position:"absolute", inset: 0 }}>
          {WAVES.map((d, i) => (
            <path key={i} d={d} fill="none"
              stroke={`rgba(255,255,255,${0.08 + (i % 3) * 0.008})`} strokeWidth="1"/>
          ))}
        </svg>
      )}
      {showSquares && (
        <div style={{
          position:"absolute", left:"22%", top:"48%",
          width: 220, height: 220, transform:"translate(-50%,-50%)", opacity: 0.15,
        }}>
          <svg width="220" height="220" viewBox="-110 -110 220 220"
               style={{ transform:`rotate(${tick}deg)` }}>
            <rect x={-70} y={-70} width={140} height={140} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1"/>
          </svg>
          <svg width="220" height="220" viewBox="-110 -110 220 220"
               style={{ position:"absolute", inset: 0, transform:`rotate(${tick + 10}deg)` }}>
            <rect x={-70} y={-70} width={140} height={140} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1"/>
          </svg>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── Chrome ─────────────────────────────── */
function Wordmark() {
  return (
    <div style={{ position:"absolute", top: 28, left: 32, zIndex: 10 }} className="no-select">
      <div className="mono" style={{
        fontSize: 14, fontWeight: 700, letterSpacing: "0.32em", color: "var(--ink)",
        paddingBottom: 6, borderBottom:"1px solid rgba(255,255,255,0.5)",
        display:"inline-block",
      }}>HONE</div>
    </div>
  );
}
function Versionmark({ escHint, onEsc }) {
  return (
    <div style={{ position:"absolute", top: 28, right: 32, zIndex: 10, textAlign:"right" }} className="no-select">
      {escHint ? (
        <button onClick={onEsc} className="focus-ring mono"
          style={{ fontSize: 10, color:"var(--ink-40)", letterSpacing:".18em",
                   display:"inline-flex", alignItems:"center", gap: 8 }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--ink-90)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--ink-40)"}>
          <Kbd>esc</Kbd> HOME
        </button>
      ) : (
        <>
          <div className="mono" style={{ fontSize: 10, color:"var(--ink-40)", letterSpacing:"0.26em", lineHeight: 1 }}>1010</div>
          <div className="mono" style={{ fontSize: 10, color:"var(--ink-40)", letterSpacing:"0.14em", marginTop: 6 }}>v.0.0.1</div>
        </>
      )}
    </div>
  );
}

function Dock({ onMenu, running, onToggle, remain, vol, onVol }) {
  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  return (
    <div style={{
      position:"absolute", bottom: 36, left: "50%", transform:"translateX(-50%)",
      display:"flex", alignItems:"center", gap: 4, padding: 6, borderRadius: 999,
      background:"rgba(10,10,10,0.72)", border:"1px solid rgba(255,255,255,0.08)",
      backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)", zIndex: 10,
    }} className="no-select">
      <DockBtn onClick={onMenu} title="Menu (⌘K)"><Icon name="menu" size={15}/></DockBtn>
      <Divider/>
      <div style={{ display:"flex", alignItems:"center", gap: 10, padding: "0 14px" }}>
        <span style={{ width: 6, height: 6, borderRadius: 99,
                       background: running ? "var(--red)" : "rgba(255,255,255,0.35)" }}
              className={running ? "red-pulse" : ""}/>
        <span className="mono" style={{ fontSize: 15, letterSpacing:"0.02em", color:"var(--ink)" }}>
          {mm}:{ss}
        </span>
      </div>
      <Divider/>
      <DockBtn onClick={onToggle} title={running ? "Pause" : "Play"}>
        <Icon name={running ? "pause" : "play"} size={13}/>
      </DockBtn>
      <Divider/>
      <VolumeBtn vol={vol} onVol={onVol}/>
    </div>
  );
}
function DockBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} className="focus-ring"
      style={{ width: 34, height: 34, borderRadius: 999,
               display:"flex", alignItems:"center", justifyContent:"center",
               color:"var(--ink-90)" }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      {children}
    </button>
  );
}
function Divider() { return <span style={{ width:1, height: 18, background:"rgba(255,255,255,0.08)" }}/>; }
function VolumeBtn({ vol, onVol }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position:"relative" }}>
      <DockBtn onClick={() => setOpen(o => !o)} title="Volume"><Icon name="volume" size={13}/></DockBtn>
      {open && (
        <div onMouseLeave={() => setOpen(false)}
          style={{ position:"absolute", bottom: 46, right: -6, padding: "10px 12px",
                   borderRadius: 10, background:"rgba(10,10,10,0.9)",
                   border:"1px solid rgba(255,255,255,0.08)", backdropFilter:"blur(18px)" }}>
          <input type="range" min="0" max="100" value={vol}
            onChange={e => onVol(parseInt(e.target.value))}
            style={{ width: 110, accentColor:"#fff" }}/>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── Palette ──────────────────────────── */
function Palette({ onClose, onOpen }) {
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  const items = useMemo(() => [
    { id:"today",  label:"Today",         sc:"T",    run: () => onOpen("today") },
    { id:"focus",  label:"Focus",         sc:"F",    run: () => onOpen("focus") },
    { id:"notes",  label:"Notes",         sc:"N",    run: () => onOpen("notes") },
    { id:"board",  label:"Whiteboard",    sc:"D",    run: () => onOpen("board") },
    { id:"stats",  label:"Stats",         sc:"S",    run: () => onOpen("stats") },
    { id:"druz9",  label:"Open druz9.ru", sc:"⌘O",   run: () => {} },
    { id:"ai",     label:"Ask AI",        sc:"⌘⇧␣",  run: () => onOpen("copilot") },
  ], [onOpen]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter(i => i.label.toLowerCase().includes(s)) : items;
  }, [q, items]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [q]);

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = filtered[idx]; if (it) { it.run(); onClose(); } }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fadein" style={{
      position:"absolute", inset: 0, zIndex: 60,
      background: "rgba(0,0,0,0.8)",
      backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
      display:"flex", justifyContent:"center", paddingTop:"14vh",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 520, maxWidth:"90%", height:"fit-content",
                 background:"rgba(8,8,8,0.92)",
                 border:"1px solid rgba(255,255,255,0.08)",
                 borderRadius: 14, overflow:"hidden",
                 boxShadow:"0 40px 100px -20px rgba(0,0,0,0.8)" }}>
        <div style={{ padding:"16px 18px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Type a command…" style={{ width:"100%", fontSize: 15, color:"var(--ink)" }}/>
        </div>
        <div style={{ padding: "8px 0" }}>
          {filtered.map((it, i) => {
            const active = i === idx;
            return (
              <button key={it.id} onMouseEnter={() => setIdx(i)} onClick={() => { it.run(); onClose(); }}
                style={{ width:"100%", display:"grid", gridTemplateColumns:"1fr auto", gap: 14,
                         alignItems:"center", padding:"11px 18px",
                         color: active ? "var(--ink)" : "var(--ink-60)",
                         background: active ? "rgba(255,255,255,0.04)" : "transparent",
                         fontSize: 14 }}>
                <span style={{ textAlign:"left", display:"inline-flex", alignItems:"center", gap: 10 }}>
                  <span style={{ color:"var(--ink-40)", fontSize: 12 }}>›</span>
                  {it.label}
                </span>
                <Kbd>{it.sc}</Kbd>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding:"22px 18px", color:"var(--ink-40)", fontSize: 13 }}>No matches.</div>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap: 14,
                      padding:"10px 18px", borderTop:"1px solid rgba(255,255,255,0.06)",
                      fontSize: 11, color:"var(--ink-40)" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap: 6 }}><Kbd>↑</Kbd><Kbd>↓</Kbd> select</span>
          <span style={{ display:"inline-flex", alignItems:"center", gap: 6 }}><Kbd>↵</Kbd> open</span>
          <span style={{ display:"inline-flex", alignItems:"center", gap: 6 }}><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── Pages ────────────────────────────── */

function HomePage() {
  // Home is just the canvas. Nothing else.
  return null;
}

function TodayPage({ onStartFocus }) {
  return (
    <div className="fadein" style={{
      position:"absolute", inset: 0, display:"flex", alignItems:"center", justifyContent:"center",
    }}>
      <div style={{ width: 560, maxWidth: "90%", padding: "0 16px" }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing:"0.24em", color:"var(--ink-40)" }}>
          FRIDAY · APR 24
        </div>
        <h1 style={{ margin:"20px 0 0", fontSize: 44, fontWeight: 400, letterSpacing:"-0.03em", lineHeight: 1.08 }}>
          What will you hone today?
        </h1>

        <ul style={{ listStyle:"none", margin:"64px 0 0", padding: 0 }}>
          {[
            { t:"Binary Tree Level Order",  s:"Targets your weak spot — BFS on trees." },
            { t:"System Design mock · 18:00", s:"With Артём К. Warm-up prepared." },
            { t:"PR druz9/backend#421",      s:"Two comments from @lead are waiting." },
          ].map((x, i) => (
            <li key={i} style={{ padding:"26px 0" }}>
              <div style={{ fontSize: 17, color:"var(--ink)", letterSpacing:"-0.005em" }}>{x.t}</div>
              <div style={{ fontSize: 13, color:"var(--ink-40)", marginTop: 8 }}>{x.s}</div>
            </li>
          ))}
        </ul>

        <button onClick={onStartFocus} className="focus-ring"
          style={{ marginTop: 56, display:"inline-flex", alignItems:"center", gap: 10,
                   padding:"11px 20px", borderRadius: 999, background:"#fff", color:"#000",
                   fontSize: 13, fontWeight: 500 }}>
          Start focus <Icon name="arrow" size={12}/>
        </button>
      </div>
    </div>
  );
}

function FocusPage({ remain }) {
  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  return (
    <div className="fadein" style={{
      position:"absolute", inset: 0, display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap: 36,
    }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing:"0.24em", color:"var(--ink-40)" }}>
        FOCUSING ON
      </div>
      <div style={{ fontSize: 15, color:"var(--ink-90)", marginTop: -18 }}>
        Binary Tree Level Order Traversal
      </div>
      <div className="mono" style={{
        fontSize: "clamp(120px, 18vw, 220px)", fontWeight: 200, letterSpacing:"-0.04em",
        color:"var(--ink)", lineHeight: 1,
      }}>
        {mm}<span style={{ color:"var(--ink-40)" }}>:</span>{ss}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap: 12 }}>
        <span className="mono" style={{ fontSize: 11, color:"var(--ink-40)", letterSpacing:"0.22em" }}>
          POMODORO 2 / 4
        </span>
        <span style={{ width: 6, height: 6, borderRadius: 99, background:"var(--red)" }} className="red-pulse"/>
        <span className="mono" style={{ fontSize: 11, color:"var(--red)", letterSpacing:"0.22em" }}>LIVE</span>
      </div>

      <div className="mono no-select" style={{
        position:"absolute", bottom: 44, fontSize: 11, color:"var(--ink-40)", letterSpacing:"0.04em",
      }}>
        <Kbd>␣</Kbd> pause <span style={{ opacity:0.4, padding:"0 10px" }}>·</span>
        <Kbd>S</Kbd> stop <span style={{ opacity:0.4, padding:"0 10px" }}>·</span>
        <Kbd>esc</Kbd> exit
      </div>
    </div>
  );
}

const NOTES = [
  { id:"redis", t:"Redis locks · rate limiter",
    body:"Race between INCR and EXPIRE. Use a Lua script — atomic INCR + conditional EXPIRE if value == 1.\n\n  local c = redis.call(\"INCR\", KEYS[1])\n  if c == 1 then redis.call(\"PEXPIRE\", KEYS[1], ARGV[1]) end\n  return c\n\nOpen: what happens on failover?" },
  { id:"english", t:"English — phrasal shadowing",
    body:"Daily, 15 min, before standup.\n\n— Shadow one podcast segment, 30 seconds.\n— Chase rhythm, not accent.\n— Weak cluster: conditional + past perfect." },
  { id:"sd",  t:"System design refs",
    body:"DDIA ch. 7 — transactions.\nMarc Brooker — shuffle sharding.\nAmazon builders' library — timeouts, retries, backoff." },
  { id:"ru",  t:"Рейтинг — мысли",
    body:"Новичкам не показывать абсолютные числа.\n\nПоказывать «относительно когорты», не глобальный rank.\nСделать A/B." },
  { id:"idea", t:"Idea · focus queue as .ics",
    body:"Export focus queue as an ICS feed so calendar picks it up automatically." },
];

function NotesPage() {
  const [sel, setSel] = useState("redis");
  const note = NOTES.find(n => n.id === sel);
  return (
    <div className="fadein" style={{
      position:"absolute", inset: 0, paddingTop: 80, paddingBottom: 120,
      display:"grid", gridTemplateColumns: "280px 1fr",
    }}>
      <aside style={{
        borderRight:"1px solid rgba(255,255,255,0.06)",
        padding: "0 10px", overflowY:"auto",
      }}>
        <div style={{ padding:"6px 14px 14px", display:"flex", alignItems:"center", gap: 8 }}>
          <span style={{ fontSize: 12, color:"var(--ink-40)", flex: 1 }}>Search…</span>
          <Kbd>⌘P</Kbd>
        </div>
        <button className="focus-ring" style={{
          width:"calc(100% - 12px)", margin:"0 6px 10px",
          padding:"8px 12px", borderRadius: 7,
          border:"1px solid rgba(255,255,255,0.06)",
          fontSize: 12.5, color:"var(--ink-60)", textAlign:"left",
          display:"flex", alignItems:"center", gap: 6,
        }}>
          <span style={{ opacity: 0.6 }}>+</span> New note
          <span style={{ marginLeft:"auto" }}><Kbd>⌘N</Kbd></span>
        </button>
        {NOTES.map(n => {
          const active = sel === n.id;
          return (
            <button key={n.id} onClick={() => setSel(n.id)}
              style={{ display:"block", width:"100%", textAlign:"left",
                       padding:"11px 14px", margin:"1px 0", borderRadius: 7,
                       color: active ? "var(--ink)" : "var(--ink-60)",
                       background: active ? "rgba(255,255,255,0.05)" : "transparent",
                       fontSize: 13.5 }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = "var(--ink)"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = "var(--ink-60)"; }}>
              {n.t}
            </button>
          );
        })}
      </aside>
      <section style={{ padding:"10px 56px 0 56px", position:"relative", overflowY:"auto" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500, letterSpacing:"-0.015em" }}>{note.t}</h1>
        <pre className="mono" style={{
          margin:"26px 0 0", fontSize: 13, lineHeight: 1.75, color:"var(--ink-90)",
          whiteSpace:"pre-wrap",
        }}>{note.body}</pre>
        <div className="mono" style={{
          position:"absolute", bottom: 8, right: 56, fontSize: 10, color:"var(--ink-40)",
        }}>⌘J for connections</div>
      </section>
    </div>
  );
}

function WhiteboardPage() {
  const [tool, setTool] = useState("V");
  const [critique, setCritique] = useState(false);
  return (
    <div className="fadein" style={{ position:"absolute", inset: 0 }}>
      <div style={{ position:"absolute", inset: 0,
        backgroundImage:"radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
        backgroundSize:"24px 24px",
      }}/>
      <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet"
           style={{ position:"absolute", inset: 0 }}>
        <g transform="translate(560 360)">
          <rect width="200" height="110" rx="6" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3"/>
          <text x="16" y="32" fill="rgba(255,255,255,0.95)" fontFamily="JetBrains Mono" fontSize="15">api</text>
          <text x="16" y="56" fill="rgba(255,255,255,0.45)" fontFamily="Inter" fontSize="12">Go · 3 replicas</text>
          <text x="16" y="84" fill="rgba(255,255,255,0.4)" fontFamily="JetBrains Mono" fontSize="11">/v1/*</text>
        </g>
        <g transform="translate(920 290)">
          <circle cx="70" cy="70" r="66" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3"/>
          <text x="70" y="66" textAnchor="middle" fill="rgba(255,255,255,0.95)" fontFamily="JetBrains Mono" fontSize="15">postgres</text>
          <text x="70" y="86" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontFamily="Inter" fontSize="12">primary + RR</text>
        </g>
        <g transform="translate(920 510)">
          <circle cx="70" cy="70" r="66" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.75)" strokeWidth="1.3"/>
          <text x="70" y="66" textAnchor="middle" fill="rgba(255,255,255,0.95)" fontFamily="JetBrains Mono" fontSize="15">s3</text>
          <text x="70" y="86" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontFamily="Inter" fontSize="12">blobs</text>
        </g>
        <g transform="translate(320 390)">
          <rect width="150" height="70" rx="6" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" strokeDasharray="4 4"/>
          <text x="16" y="30" fill="rgba(255,255,255,0.7)" fontFamily="JetBrains Mono" fontSize="13">client</text>
          <text x="16" y="52" fill="rgba(255,255,255,0.4)" fontFamily="Inter" fontSize="11">web / ios</text>
        </g>
        <defs>
          <marker id="ahw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.8)"/>
          </marker>
        </defs>
        <path d="M470,422 L560,415" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" fill="none" markerEnd="url(#ahw)"/>
        <path d="M760,385 L920,355" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" fill="none" markerEnd="url(#ahw)"/>
        <path d="M760,440 L920,575" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" fill="none" markerEnd="url(#ahw)"/>
      </svg>

      {critique && (
        <div className="fadein" style={{
          position:"absolute", top: 120, right: 80, width: 440,
          fontSize: 13, color:"var(--ink-90)", lineHeight: 1.75, letterSpacing:"-0.005em",
        }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing:".22em", color:"var(--ink-40)", marginBottom: 16 }}>SENIOR REVIEW</div>
          <p style={{ margin:"0 0 14px" }}>Strong: clear data separation — relational in Postgres, blobs in S3. Right default.</p>
          <p style={{ margin:"0 0 14px", color:"var(--ink-60)" }}>Concern: no caching layer between API and Postgres. Your read traffic will hammer the primary.</p>
          <p style={{ margin:"0 0 14px", color:"var(--ink-60)" }}>Missing: retry policy with jittered backoff. Dead-letter queue for async writes to S3. Observability plane is absent.</p>
        </div>
      )}

      <div style={{ position:"absolute", top: 86, right: 32 }}>
        <button onClick={() => setCritique(c => !c)} className="focus-ring"
          style={{ display:"inline-flex", alignItems:"center", gap: 8,
                   padding:"7px 13px", borderRadius: 999,
                   background: critique ? "#fff" : "rgba(255,255,255,0.06)",
                   color: critique ? "#000" : "var(--ink)",
                   fontSize: 12.5, border:"1px solid rgba(255,255,255,0.08)" }}>
          <Icon name="sparkle" size={12}/> ⌘E critique
        </button>
      </div>

      {/* Tools — positioned ABOVE the timer dock */}
      <div style={{
        position:"absolute", bottom: 92, left:"50%", transform:"translateX(-50%)",
        display:"flex", gap: 4, padding: 6, borderRadius: 999,
        background:"rgba(10,10,10,0.72)", border:"1px solid rgba(255,255,255,0.08)",
        backdropFilter:"blur(18px)",
      }}>
        {["V","R","O","L","T","E"].map(k => {
          const active = tool === k;
          return (
            <button key={k} onClick={() => setTool(k)} className="focus-ring mono"
              style={{ width: 32, height: 32, borderRadius: 999,
                       fontSize: 12, fontWeight: 500,
                       background: active ? "rgba(255,255,255,0.1)" : "transparent",
                       color: active ? "var(--ink)" : "var(--ink-60)" }}>
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatsPage() {
  return (
    <div className="fadein" style={{ position:"absolute", inset: 0,
      display:"grid", gridTemplateColumns: "1fr 440px" }}>
      {/* LEFT: canvas-like hero */}
      <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
        <div style={{ padding:"0 64px", maxWidth: 640 }}>
          <h1 style={{ margin: 0, fontSize: 46, fontWeight: 400, letterSpacing:"-0.03em", lineHeight: 1.05 }}>
            Everything<br/>stays calm.
          </h1>
          <p style={{ marginTop: 24, fontSize: 14, color:"var(--ink-40)", maxWidth: 460, lineHeight: 1.6 }}>
            You focused <span className="mono" style={{ color:"var(--ink-90)"}}>3h 12m</span> today across
            seven sessions. Best window — 11:30 to 13:00.
          </p>
        </div>
      </div>

      {/* RIGHT: widgets */}
      <aside style={{ padding: "90px 32px 120px 0", display:"flex", flexDirection:"column", gap: 14, overflowY:"auto" }}>
        <Card>
          <Label>Focus Activity</Label>
          <Heatmap/>
        </Card>
        <Card>
          <Label>Current Streak</Label>
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", alignItems:"center", gap: 18, marginTop: 8 }}>
            <div className="mono" style={{ fontSize: 68, fontWeight: 300, letterSpacing:"-0.04em", lineHeight: 1, color:"var(--ink)" }}>
              12<span style={{ fontSize: 22, color:"var(--ink-40)" }}>d</span>
            </div>
            <div>
              <Sparkline/>
              <div className="mono" style={{ fontSize: 11, color:"var(--ink-40)", marginTop: 8 }}>
                Longest: <span style={{ color:"var(--ink-90)" }}>34</span>
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <Label>Focused Time · last 7 days</Label>
          <Bars/>
        </Card>
      </aside>
    </div>
  );
}
function Card({ children }) {
  return (
    <section style={{
      background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)",
      borderRadius: 16, padding: 22,
    }}>{children}</section>
  );
}
function Label({ children }) {
  return (
    <div className="mono" style={{ fontSize: 10, letterSpacing:"0.22em",
      textTransform:"uppercase", color:"var(--ink-40)", marginBottom: 14 }}>{children}</div>
  );
}
function Heatmap() {
  const seed = (r, c) => {
    const v = Math.sin(r * 12.9898 + c * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  return (
    <div style={{ display:"grid", gridTemplateRows:"repeat(7, 1fr)", gridAutoFlow:"column",
      gridAutoColumns:"1fr", gap: 3 }}>
      {Array.from({ length: 7 * 26 }).map((_, i) => {
        const r = i % 7, c = Math.floor(i / 7);
        const s = seed(r, c);
        const isToday = c === 25 && r === 5;
        const o = s < 0.18 ? 0.04 : s < 0.42 ? 0.1 : s < 0.65 ? 0.2 : s < 0.85 ? 0.35 : 0.6;
        return <span key={i} style={{ aspectRatio:"1/1", borderRadius: 2,
          background: isToday ? "var(--red)" : `rgba(255,255,255,${o})` }}/>;
      })}
    </div>
  );
}
function Sparkline() {
  const pts = [3,5,4,6,7,5,8,7,9,11,9,10,12];
  const W = 200, H = 46;
  const max = Math.max(...pts), min = Math.min(...pts);
  const path = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((p - min) / (max - min)) * (H - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <path d={path} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.2"/>
      <circle cx={W} cy={H - ((pts[pts.length-1] - min) / (max-min)) * (H-4) - 2} r="3" fill="var(--red)"/>
    </svg>
  );
}
function Bars() {
  const days = [
    { d:"Sat", h:1.2 }, { d:"Sun", h:0.4 }, { d:"Mon", h:2.8 },
    { d:"Tue", h:3.6 }, { d:"Wed", h:2.2 }, { d:"Thu", h:4.1 },
    { d:"Fri", h:3.2, today:true },
  ];
  const max = 5;
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap: 10, alignItems:"end", height: 150 }}>
      {days.map((x, i) => {
        const h = (x.h / max) * 120;
        return (
          <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap: 8 }}>
            <div style={{ width:"100%", height: 120, display:"flex", alignItems:"flex-end" }}>
              <div style={{ width:"100%", height: h,
                background: x.today ? "var(--red)" : "rgba(255,255,255,0.9)",
                borderRadius: 3,
                transition:"height 500ms cubic-bezier(.2,.7,.2,1)" }}/>
            </div>
            <div className="mono" style={{ fontSize: 10, color:"var(--ink-40)" }}>{x.d}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────── Copilot ─────────────────────────── */
function Copilot({ onClose }) {
  const full = [
    "The hot path allocates a new slice every call inside the inner loop.",
    "Each append past capacity triggers a grow+copy — O(n²).",
    "",
    "Two fixes, cheapest first:",
    "  items := make([]Item, 0, len(src))",
    "  move allocation outside the loop; reuse the buffer.",
    "",
    "Second: json.Marshal re-reflects the struct every call.",
    "Cache a *jsoniter.Encoder — 3-4× faster on stable shapes.",
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= full.length) return;
    const t = setTimeout(() => setShown(s => s + 1), 180);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="fadein" style={{
      position:"absolute", top: 72, right: 22, width: 420, zIndex: 55,
      background:"rgba(8,8,8,0.88)", border:"1px solid rgba(255,255,255,0.08)",
      borderRadius: 14, backdropFilter:"blur(24px) saturate(1.2)",
      overflow:"hidden", boxShadow:"0 30px 80px -10px rgba(0,0,0,0.7)",
    }}>
      <div style={{
        display:"flex", alignItems:"center", gap: 8, padding:"8px 14px",
        fontSize: 10.5, color:"rgb(140,240,170)",
        background:"rgba(40,200,120,0.08)",
        borderBottom:"1px solid rgba(140,255,170,0.18)",
      }} className="mono">
        <span style={{ width: 5, height: 5, borderRadius: 99, background:"rgb(100,230,140)" }} className="red-pulse"/>
        <span style={{ letterSpacing:".18em" }}>HIDDEN FROM SCREEN SHARE</span>
        <button onClick={onClose} style={{ marginLeft:"auto", color:"var(--ink-40)" }}>
          <Icon name="x" size={11}/>
        </button>
      </div>
      <div style={{ padding:"14px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing:".22em", color:"var(--ink-40)", marginBottom: 4 }}>Q</div>
        <div style={{ fontSize: 14, color:"var(--ink)" }}>Why is this code slow?</div>
      </div>
      <div style={{ padding:"12px 16px 16px" }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing:".22em", color:"var(--ink-40)", marginBottom: 6 }}>A</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color:"var(--ink-90)" }}>
          {full.slice(0, shown).map((line, i) => {
            if (line === "") return <div key={i} style={{ height: 6 }}/>;
            const isCode = line.includes(":=") || line.trim().startsWith("items") || line.includes("Encoder");
            return (
              <div key={i} className={isCode ? "mono" : ""}
                   style={{ margin:"2px 0", fontSize: isCode ? 12 : 13, color: isCode ? "var(--ink)" : "var(--ink-90)" }}>
                {line}
              </div>
            );
          })}
          {shown < full.length && <span className="caret"/>}
        </div>
      </div>
      <div style={{
        display:"flex", alignItems:"center", gap: 12,
        padding:"9px 14px", borderTop:"1px solid rgba(255,255,255,0.06)",
        fontSize: 10.5, color:"var(--ink-40)",
      }} className="mono">
        <span>esc dismiss</span><span style={{ opacity: 0.4 }}>·</span><span>⌘⇧S screenshot again</span>
      </div>
    </div>
  );
}

/* ────────────────────────────── App ──────────────────────────────── */
function App() {
  const [page, setPage] = useState("home");   // home | today | focus | notes | board | stats
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const [remain, setRemain] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [vol, setVol] = useState(40);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRemain(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const open = (id) => {
    if (id === "copilot") { setCopilotOpen(true); return; }
    if (id === "focus") setRunning(true);
    setPage(id);
  };

  const home = () => {
    if (page === "focus") { setRunning(false); setRemain(25 * 60); }
    setPage("home");
  };

  useEffect(() => {
    const onKey = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target;
      const isText = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (isMod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(p => !p); return; }
      if (isMod && e.shiftKey && e.code === "Space") { e.preventDefault(); setCopilotOpen(c => !c); return; }

      if (e.key === "Escape") {
        if (copilotOpen) { setCopilotOpen(false); return; }
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (page !== "home") { home(); return; }
        return;
      }
      if (isText || paletteOpen) return;

      if (page === "focus") {
        if (e.code === "Space") { e.preventDefault(); setRunning(r => !r); return; }
        if (e.key.toLowerCase() === "s") { setRunning(false); setRemain(25*60); setPage("home"); return; }
      }

      const k = e.key.toLowerCase();
      if (k === "t") open("today");
      else if (k === "f") open("focus");
      else if (k === "n") open("notes");
      else if (k === "d") open("board");
      else if (k === "s") open("stats");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, copilotOpen, page]);

  const focusMode = page === "focus";
  const canvasMode = page === "home" || page === "stats" ? "full" : focusMode ? "void" : "quiet";

  return (
    <div style={{ position:"fixed", inset: 0, background:"#000", overflow:"hidden" }}>
      <CanvasBg mode={canvasMode}/>

      {!focusMode && <Wordmark/>}
      {!focusMode && <Versionmark escHint={page !== "home"} onEsc={home}/>}

      {page === "home"  && <HomePage/>}
      {page === "today" && <TodayPage onStartFocus={() => open("focus")}/>}
      {page === "focus" && <FocusPage remain={remain}/>}
      {page === "notes" && <NotesPage/>}
      {page === "board" && <WhiteboardPage/>}
      {page === "stats" && <StatsPage/>}

      {!focusMode && (
        <Dock onMenu={() => setPaletteOpen(true)}
          running={running}
          onToggle={() => setRunning(r => !r)}
          remain={remain} vol={vol} onVol={setVol}/>
      )}

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onOpen={open}/>}
      {copilotOpen && <Copilot onClose={() => setCopilotOpen(false)}/>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
