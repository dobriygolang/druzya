const { useState, useEffect, useRef } = React;

/* ────────────────────────────── Icons ─────────────────────── */
const Icon = ({ name, size = 14, stroke = "currentColor", sw = 1.4 }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "arrow":    return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>;
    case "arrow-dn": return <svg {...p}><path d="M12 5v14M5 13l7 7 7-7"/></svg>;
    case "check":    return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>;
    case "moon-sun": return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>;
    case "pomo":     return <svg {...p}><circle cx="12" cy="13" r="7"/><path d="M9 3h6M12 10v3l2 2"/></svg>;
    case "shh":      return <svg {...p}><path d="M3 11a9 9 0 0118 0v5a2 2 0 01-2 2h-3v-6h4M3 11v5a2 2 0 002 2h3v-6H3"/></svg>;
    case "arena":    return <svg {...p}><path d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/></svg>;
    case "apple":    return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M16.37 12.62c-.02-2.32 1.9-3.44 1.99-3.5-1.09-1.59-2.78-1.81-3.38-1.83-1.44-.15-2.81.85-3.54.85-.73 0-1.86-.83-3.06-.81-1.57.02-3.03.92-3.84 2.33-1.64 2.84-.42 7.04 1.18 9.35.78 1.13 1.71 2.4 2.92 2.35 1.17-.05 1.62-.76 3.03-.76 1.41 0 1.81.76 3.05.73 1.26-.02 2.06-1.15 2.83-2.29.89-1.32 1.26-2.6 1.28-2.67-.03-.01-2.44-.94-2.46-3.75zM14.1 5.55c.64-.79 1.08-1.87.96-2.95-.93.04-2.07.63-2.73 1.4-.6.69-1.12 1.8-.98 2.86 1.04.08 2.11-.53 2.75-1.31z"/></svg>;
    case "menu":     return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case "x":        return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case "sparkle":  return <svg {...p}><path d="M12 3l1.7 5 5 1.7-5 1.7L12 17l-1.7-5.6L5 9.7l5-1.7z"/></svg>;
    case "eye-off":  return <svg {...p}><path d="M3 3l18 18"/><path d="M10.5 6.2A9 9 0 0121 12a12 12 0 01-2.7 3.4M6.6 6.6A12 12 0 003 12c2 4 6 7 9 7 1.5 0 3-.4 4.3-1.1"/><path d="M10 10a3 3 0 004 4"/></svg>;
    case "camera":   return <svg {...p}><path d="M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="4"/></svg>;
    case "plus":     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "minus":    return <svg {...p}><path d="M5 12h14"/></svg>;
    default: return null;
  }
};

/* ────────────────────────────── Canvas bg ───────────────── */
const STARS = [
  {x:7,y:14,r:1.1,o:.45},{x:17,y:72,r:1,o:.35},{x:23,y:28,r:1.3,o:.55},
  {x:31,y:84,r:.9,o:.3},{x:39,y:12,r:1,o:.4},{x:44,y:58,r:1.1,o:.5},
  {x:52,y:22,r:.9,o:.3},{x:58,y:80,r:1.2,o:.55},{x:63,y:38,r:1,o:.4},
  {x:68,y:64,r:.9,o:.35},{x:73,y:18,r:1.1,o:.5},{x:78,y:48,r:1,o:.4},
  {x:83,y:74,r:.9,o:.3},{x:88,y:30,r:1.2,o:.6},{x:92,y:58,r:1,o:.45},
  {x:14,y:44,r:.9,o:.35},{x:46,y:90,r:1,o:.3},{x:3,y:62,r:1.1,o:.45},
  {x:36,y:50,r:.9,o:.3},{x:71,y:88,r:1,o:.4},
];
const WAVES = [
  "M-50,280 C 260,220 420,340 700,290 S 1200,200 1700,260",
  "M-50,390 C 200,350 500,430 820,390 S 1300,340 1700,380",
  "M-50,500 C 240,470 520,560 860,510 S 1340,450 1700,490",
  "M-50,605 C 300,580 620,660 920,620 S 1380,570 1700,600",
  "M-50,700 C 280,680 560,750 900,720 S 1360,680 1700,705",
  "M-50,790 C 320,770 640,820 960,800 S 1420,770 1700,790",
];
function CanvasBg({ strong = true }) {
  return (
    <div style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
      <svg width="100%" height="100%" style={{ position:"absolute", inset:0 }}>
        {STARS.map((s,i)=>(<circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={`rgba(255,255,255,${s.o*(strong?1:0.4)})`}/>))}
      </svg>
      {strong && (
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none" style={{ position:"absolute", inset:0 }}>
          {WAVES.map((d,i)=>(<path key={i} d={d} fill="none" stroke={`rgba(255,255,255,${0.08+(i%3)*0.006})`} strokeWidth="1"/>))}
        </svg>
      )}
    </div>
  );
}

/* ────────────────────────────── Nav ─────────────────────── */
function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", on); on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className="no-select" style={{
      position:"fixed", top:0, left:0, right:0, zIndex:40,
      padding: "18px 28px",
      background: scrolled ? "rgba(0,0,0,0.7)" : "transparent",
      backdropFilter: scrolled ? "blur(18px)" : "none",
      WebkitBackdropFilter: scrolled ? "blur(18px)" : "none",
      borderBottom: scrolled ? "1px solid var(--hair)" : "1px solid transparent",
      transition: "all 200ms ease",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 32 }}>
        <a href="#top" className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.28em", color: "var(--ink)", textDecoration: "none" }}>DRUZ9</a>
        <nav style={{ display: "flex", gap: 24 }} className="hidden md:flex">
          <NavLink href="#arena">Arena</NavLink>
          <NavLink href="#hone">Hone</NavLink>
          <NavLink href="#cue">Cue</NavLink>
          <NavLink href="#pricing">Pricing</NavLink>
          <NavLink href="#faq">FAQ</NavLink>
        </nav>
        <div style={{ marginLeft: "auto", display:"flex", alignItems:"center", gap:10 }}>
          <a href="#" className="hidden md:inline-flex" style={{ fontSize: 13, color: "var(--ink-60)", textDecoration: "none" }}>Sign in</a>
          <a href="#pricing" style={{ display:"inline-flex", alignItems:"center", gap: 8, padding: "7px 13px",
             borderRadius: 999, background:"#fff", color:"#000", fontSize: 12.5, fontWeight: 500, textDecoration:"none" }}>
            Start free <Icon name="arrow" size={11}/>
          </a>
          <button onClick={() => setOpen(o=>!o)} className="md:hidden" style={{ color: "var(--ink)", marginLeft: 4 }}>
            <Icon name={open?"x":"menu"} size={18}/>
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden" style={{ marginTop: 14, display:"flex", flexDirection:"column", gap: 4, paddingBottom: 10 }}>
          {["arena","hone","cue","pricing","faq"].map(h => (
            <a key={h} href={`#${h}`} onClick={()=>setOpen(false)}
              style={{ padding:"8px 0", fontSize:14, color:"var(--ink-60)", textDecoration:"none" }}>
              {h[0].toUpperCase()+h.slice(1)}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}
function NavLink({ href, children }) {
  return (
    <a href={href} style={{ fontSize: 13, color: "var(--ink-60)", textDecoration: "none", transition: "color 120ms ease" }}
       onMouseEnter={e=>e.currentTarget.style.color="var(--ink)"}
       onMouseLeave={e=>e.currentTarget.style.color="var(--ink-60)"}>
      {children}
    </a>
  );
}

/* ────────────────────────────── Section shell ─────────────── */
function Section({ id, children, style }) {
  return (
    <section id={id} style={{ position:"relative", padding:"128px 28px", borderTop:"1px solid var(--hair)", ...style }}>
      <div style={{ maxWidth: 1200, margin:"0 auto", position:"relative" }}>{children}</div>
    </section>
  );
}
function Eyebrow({ children }) {
  return (
    <div className="mono" style={{ fontSize: 10.5, letterSpacing:".28em", color:"var(--ink-40)", textTransform:"uppercase" }}>
      {children}
    </div>
  );
}

/* ────────────────────────────── Hero ──────────────────────── */
function Hero() {
  return (
    <section id="top" style={{ position:"relative", minHeight: "100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:"120px 28px 80px" }}>
      <CanvasBg strong/>
      <div style={{ position:"relative", textAlign:"center", maxWidth: 820, width:"100%" }} className="fadein">
        <div className="mono" style={{ fontSize: 11, letterSpacing:".28em", color:"var(--ink-40)", marginBottom: 20 }}>
          <span style={{ width:5, height:5, borderRadius:99, background:"var(--red)", display:"inline-block", marginRight:8, verticalAlign:"middle" }} className="red-pulse"/>
          PUBLIC BETA · v.0.9
        </div>
        <h1 style={{ margin: 0, fontSize: "clamp(44px, 7vw, 84px)", fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.02 }}>
          Sharpen your craft.
          <br/>
          <span style={{ color: "var(--ink-60)" }}>Every day.</span>
        </h1>
        <p style={{ margin: "26px auto 0", maxWidth: 560, fontSize: 16, color:"var(--ink-60)", lineHeight: 1.55 }}>
          The ecosystem for developers who level up every day.
          Three tools. One ritual. One subscription.
        </p>
        <div style={{ marginTop: 36, display:"flex", gap: 10, justifyContent:"center", flexWrap:"wrap" }}>
          <a href="#pricing" style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"12px 20px",
             borderRadius: 999, background:"#fff", color:"#000", fontSize:13, fontWeight:500, textDecoration:"none" }}>
            Start free <Icon name="arrow" size={12}/>
          </a>
          <a href="#ritual" style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"12px 20px",
             borderRadius: 999, border:"1px solid var(--hair-2)", color:"var(--ink)", fontSize:13, fontWeight:500, textDecoration:"none" }}>
            See how it works
          </a>
        </div>

        {/* Three products pill row */}
        <div style={{ marginTop: 64, display:"inline-flex", alignItems:"center", gap: 0, padding: "6px 8px",
                      border: "1px solid var(--hair)", borderRadius: 999, background:"rgba(10,10,10,0.6)", backdropFilter:"blur(12px)" }}>
          <ProductPill dot="#fff" name="druz9.ru" tag="Arena"/>
          <span style={{ width:1, height:14, background:"var(--hair-2)", margin:"0 4px" }}/>
          <ProductPill dot="#fff" name="Hone" tag="Focus"/>
          <span style={{ width:1, height:14, background:"var(--hair-2)", margin:"0 4px" }}/>
          <ProductPill dot="#fff" name="Cue" tag="Copilot"/>
        </div>
      </div>

      <a href="#ritual" className="mono no-select" style={{
        position:"absolute", bottom: 32, left:"50%", transform:"translateX(-50%)",
        fontSize: 10, letterSpacing:".22em", color:"var(--ink-40)",
        textDecoration:"none", display:"inline-flex", alignItems:"center", gap: 8,
      }}>
        SCROLL <Icon name="arrow-dn" size={11}/>
      </a>
    </section>
  );
}
function ProductPill({ dot, name, tag }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap: 8, padding: "6px 14px" }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: dot }}/>
      <span className="mono" style={{ fontSize: 12, color: "var(--ink)" }}>{name}</span>
      <span className="mono" style={{ fontSize: 10.5, color:"var(--ink-40)", letterSpacing:".14em", textTransform:"uppercase" }}>{tag}</span>
    </span>
  );
}

/* ────────────────────────────── Ritual ─────────────────────── */
function Ritual() {
  const beats = [
    { t:"07:00", icon:"moon-sun", title:"Open Hone.",          sub:"AI builds your plan." },
    { t:"09:30", icon:"pomo",     title:"Focus session.",       sub:"Solve on druz9.ru." },
    { t:"13:00", icon:"shh",      title:"Stuck at work.",        sub:"⌘⇧Space. Cue whispers." },
    { t:"18:00", icon:"arena",    title:"Mock interview.",       sub:"On druz9.ru." },
  ];
  return (
    <Section id="ritual">
      <Eyebrow>The ritual</Eyebrow>
      <h2 style={{ margin:"16px 0 0", fontSize:"clamp(34px, 5vw, 56px)", fontWeight:400, letterSpacing:"-0.025em", lineHeight:1.05 }}>
        One day in the life.
      </h2>
      <p style={{ margin:"18px 0 0", fontSize: 15, color:"var(--ink-60)", maxWidth: 560, lineHeight: 1.55 }}>
        Three surfaces, one rhythm. Each product has its moment. None of them overlap.
      </p>

      <div style={{ marginTop: 72, position:"relative" }}>
        {/* horizon line */}
        <div style={{ position:"absolute", left:0, right:0, top: 36, height: 1, background:"var(--hair-2)" }}/>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap: 32 }} className="md-grid">
          {beats.map((b,i)=>(
            <div key={i} style={{ position:"relative", paddingTop: 8 }}>
              <div style={{
                width: 58, height: 58, borderRadius: 999,
                border:"1px solid var(--hair-2)", background:"#000",
                display:"flex", alignItems:"center", justifyContent:"center",
                position:"relative", zIndex: 2, color:"var(--ink)",
              }}>
                <Icon name={b.icon} size={20} sw={1.2}/>
              </div>
              <div className="mono" style={{ marginTop: 22, fontSize: 11, letterSpacing:".22em", color:"var(--ink-40)" }}>{b.t}</div>
              <div style={{ marginTop: 10, fontSize: 18, letterSpacing:"-0.01em" }}>{b.title}</div>
              <div style={{ marginTop: 4, fontSize: 13.5, color:"var(--ink-60)" }}>{b.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mono" style={{ marginTop: 80, fontSize: 12, color:"var(--ink-40)", letterSpacing:".12em", textAlign:"center" }}>
        ONE ACCOUNT · ONE SUBSCRIPTION · THREE SURFACES
      </div>
    </Section>
  );
}

/* ────────────────────────────── Product row ────────────────── */
function ProductRow({ id, sideLeft = true, name, tag, title, desc, bullets, cta, mock }) {
  return (
    <Section id={id}>
      <div style={{ display:"grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems:"center" }} className="md-grid">
        <div style={{ order: sideLeft ? 0 : 1 }}>
          <Eyebrow>{tag}</Eyebrow>
          <div style={{ marginTop: 14, display:"flex", alignItems:"baseline", gap: 10 }}>
            <span className="mono" style={{ fontSize: 32, fontWeight: 500, letterSpacing:"-0.01em", paddingBottom: 4, borderBottom:"1px solid rgba(255,255,255,0.4)" }}>
              {name}
            </span>
          </div>
          <h2 style={{ margin:"28px 0 0", fontSize:"clamp(28px, 4vw, 44px)", fontWeight:400, letterSpacing:"-0.02em", lineHeight:1.08 }}>
            {title}
          </h2>
          <p style={{ margin:"20px 0 0", fontSize: 15, color:"var(--ink-60)", lineHeight: 1.65, maxWidth: 480 }}>
            {desc}
          </p>
          <ul style={{ listStyle:"none", padding:0, margin:"28px 0 0", display:"grid", gridTemplateColumns:"1fr 1fr", gap: 12 }}>
            {bullets.map((b,i)=>(
              <li key={i} style={{ display:"flex", alignItems:"center", gap: 10, fontSize: 13.5, color:"var(--ink-90)" }}>
                <Icon name="check" size={12} stroke="var(--ink-60)"/>
                {b}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 32 }}>{cta}</div>
        </div>
        <div style={{ order: sideLeft ? 1 : 0 }}>{mock}</div>
      </div>
    </Section>
  );
}

/* ────────────────────────────── Arena mock ─────────────────── */
function ArenaMock() {
  return (
    <div style={{ position:"relative", aspectRatio:"4/3", borderRadius: 14, overflow:"hidden",
      border:"1px solid var(--hair-2)", background:"#000" }}>
      <div style={{ position:"absolute", inset:0, opacity:0.7 }}>
        <svg width="100%" height="100%" style={{ position:"absolute", inset:0 }}>
          {STARS.map((s,i)=>(<circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r*0.9} fill={`rgba(255,255,255,${s.o*0.6})`}/>))}
        </svg>
      </div>
      {/* window chrome */}
      <div style={{ padding:"10px 12px", display:"flex", alignItems:"center", gap: 6, borderBottom:"1px solid var(--hair)", background:"rgba(0,0,0,0.5)", position:"relative", zIndex:2 }}>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
        <div className="mono" style={{ fontSize:11, color:"var(--ink-40)", marginLeft:14 }}>druz9.ru/arena</div>
        <span style={{ marginLeft:"auto", width:5,height:5,borderRadius:99,background:"var(--red)" }} className="red-pulse"/>
        <span className="mono" style={{ fontSize:10, color:"var(--red)", letterSpacing:".14em" }}>LIVE</span>
      </div>
      {/* Duel */}
      <div style={{ position:"relative", zIndex:2, padding:"22px 20px", display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:14 }}>
        <Fighter name="you"      elo="1842" streak="+12"/>
        <div className="mono" style={{ fontSize: 34, fontWeight: 300, textAlign:"center", letterSpacing:"-0.03em" }}>
          02:14
          <div style={{ fontSize: 10, color:"var(--ink-40)", letterSpacing:".22em", marginTop: 2 }}>DUEL 1V1</div>
        </div>
        <Fighter name="@ivn"     elo="1869" streak="−3" right/>
      </div>
      {/* leaderboard */}
      <div style={{ position:"relative", zIndex:2, padding:"6px 20px 18px" }}>
        <div className="mono" style={{ fontSize:10, letterSpacing:".22em", color:"var(--ink-40)", margin:"10px 0 8px" }}>SEASON · TOP 5</div>
        {[
          { n: "zkv",      v: "2341" },
          { n: "vlad",     v: "2210" },
          { n: "alena_b",  v: "2104", me: true },
          { n: "arhip42",  v: "2088" },
          { n: "kostya.go",v: "2041" },
        ].map((r,i)=>(
          <div key={i} style={{ display:"grid", gridTemplateColumns:"24px 1fr auto", alignItems:"center", padding:"5px 0", borderTop:"1px solid var(--hair)", fontSize: 12 }}>
            <span className="mono" style={{ color: "var(--ink-40)" }}>#{i+1}</span>
            <span style={{ color: r.me ? "var(--ink)" : "var(--ink-90)" }}>{r.n}{r.me && <span className="mono" style={{ color:"var(--red)", marginLeft: 6 }}>you</span>}</span>
            <span className="mono" style={{ color:"var(--ink-60)" }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Fighter({ name, elo, streak, right }) {
  return (
    <div style={{ textAlign: right ? "right" : "left" }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing:".18em", color:"var(--ink-40)" }}>{right ? "OPPONENT" : "YOU"}</div>
      <div style={{ fontSize: 18, marginTop: 6 }}>{name}</div>
      <div className="mono" style={{ fontSize: 11, color:"var(--ink-60)", marginTop: 4 }}>
        ELO {elo} <span style={{ color: streak.startsWith("+") ? "rgb(120,230,170)" : "var(--red)" }}>{streak}</span>
      </div>
    </div>
  );
}

/* ────────────────────────────── Hone mock ─────────────────── */
function HoneMock() {
  return (
    <div style={{ position:"relative", aspectRatio:"4/3", borderRadius: 14, overflow:"hidden",
      border:"1px solid var(--hair-2)", background:"#000" }}>
      {/* window chrome */}
      <div style={{ padding:"10px 12px", display:"flex", alignItems:"center", gap: 6, borderBottom:"1px solid var(--hair)", background:"rgba(0,0,0,0.6)", position:"relative", zIndex:3 }}>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
        <span style={{ width:10,height:10,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
      </div>
      {/* starfield */}
      <div style={{ position:"absolute", inset:0 }}>
        <svg width="100%" height="100%" style={{ position:"absolute", inset:0 }}>
          {STARS.map((s,i)=>(<circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill={`rgba(255,255,255,${s.o*0.6})`}/>))}
        </svg>
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none" style={{ position:"absolute", inset:0 }}>
          {WAVES.map((d,i)=>(<path key={i} d={d} fill="none" stroke={`rgba(255,255,255,${0.07+(i%3)*0.005})`} strokeWidth="1"/>))}
        </svg>
      </div>
      {/* HONE wordmark */}
      <div style={{ position:"absolute", top:54, left:24, zIndex:3 }}>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.3em", paddingBottom: 5, borderBottom:"1px solid rgba(255,255,255,0.5)", display:"inline-block" }}>HONE</div>
      </div>
      {/* version */}
      <div style={{ position:"absolute", top:54, right:24, zIndex:3, textAlign:"right" }}>
        <div className="mono" style={{ fontSize: 9, color:"var(--ink-40)", letterSpacing:".22em" }}>1010</div>
        <div className="mono" style={{ fontSize: 9, color:"var(--ink-40)", letterSpacing:".14em", marginTop: 4 }}>v.0.0.1</div>
      </div>
      {/* rotating squares */}
      <div style={{ position:"absolute", left:"28%", top:"52%", transform:"translate(-50%,-50%)", width: 100, height: 100, opacity: 0.18 }}>
        <svg width="100" height="100" viewBox="-50 -50 100 100"><rect x={-34} y={-34} width={68} height={68} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1"/></svg>
        <svg width="100" height="100" viewBox="-50 -50 100 100" style={{ position:"absolute", inset:0, transform:"rotate(10deg)" }}><rect x={-34} y={-34} width={68} height={68} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1"/></svg>
      </div>
      {/* dock */}
      <div style={{
        position:"absolute", bottom:20, left:"50%", transform:"translateX(-50%)",
        display:"flex", alignItems:"center", gap: 2, padding: 4, borderRadius: 999,
        background:"rgba(10,10,10,0.72)", border:"1px solid rgba(255,255,255,0.08)",
        backdropFilter:"blur(14px)", zIndex:3,
      }}>
        <span style={{ padding:"6px 8px", color:"var(--ink-60)" }}><Icon name="menu" size={13}/></span>
        <span style={{ width:1, height: 14, background:"rgba(255,255,255,0.08)" }}/>
        <span style={{ display:"flex", alignItems:"center", gap: 8, padding: "0 12px" }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background:"var(--red)" }} className="red-pulse"/>
          <span className="mono" style={{ fontSize: 13, color:"var(--ink)" }}>24:10</span>
        </span>
        <span style={{ width:1, height: 14, background:"rgba(255,255,255,0.08)" }}/>
        <span style={{ padding:"6px 8px", color:"var(--ink-60)" }}><Icon name="pomo" size={13} sw={1.2}/></span>
      </div>
    </div>
  );
}

/* ────────────────────────────── Cue mock ─────────────────── */
function CueMock() {
  return (
    <div style={{ position:"relative", aspectRatio:"4/3", borderRadius: 14, overflow:"hidden",
      border:"1px solid var(--hair-2)", background:"#0a0a0a" }}>
      {/* IDE backdrop */}
      <div style={{ position:"absolute", inset:0, padding:"14px 0 0 0" }}>
        <div style={{ padding:"6px 14px", display:"flex", alignItems:"center", gap: 10, borderBottom:"1px solid var(--hair)" }}>
          <span style={{ width:8,height:8,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
          <span style={{ width:8,height:8,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
          <span style={{ width:8,height:8,borderRadius:99,background:"rgba(255,255,255,0.14)" }}/>
          <div className="mono" style={{ fontSize:10, color:"var(--ink-40)", marginLeft:12 }}>handlers.go</div>
        </div>
        <div className="mono" style={{ padding:"16px 18px", fontSize: 11, color:"var(--ink-40)", lineHeight: 1.8 }}>
          <div><span style={{ color:"rgba(255,255,255,0.3)" }}>23 </span><span style={{ color:"rgba(160,200,255,0.7)"}}>func</span> <span style={{ color:"var(--ink-90)"}}>handleBatch</span>(items []Item) error {"{"}</div>
          <div><span style={{ color:"rgba(255,255,255,0.3)" }}>24 </span>  out := []byte{"{"}{"}"} </div>
          <div><span style={{ color:"rgba(255,255,255,0.3)" }}>25 </span>  <span style={{ color:"rgba(160,200,255,0.7)"}}>for</span> _, it := range items {"{"}</div>
          <div style={{ background:"rgba(255,59,48,0.08)", borderLeft:"2px solid var(--red)", paddingLeft: 6, marginLeft: -8 }}>
            <span style={{ color:"rgba(255,255,255,0.3)" }}>26 </span>    b, _ := json.Marshal(it)
          </div>
          <div><span style={{ color:"rgba(255,255,255,0.3)" }}>27 </span>    out = append(out, b...)</div>
          <div><span style={{ color:"rgba(255,255,255,0.3)" }}>28 </span>  {"}"}</div>
        </div>
      </div>

      {/* Cue overlay */}
      <div style={{
        position:"absolute", top: 16, right: 14, width: 260, zIndex: 4,
        background:"rgba(8,8,8,0.9)", border:"1px solid rgba(255,255,255,0.08)",
        borderRadius: 11, overflow:"hidden", backdropFilter:"blur(20px)",
        boxShadow:"0 20px 50px -10px rgba(0,0,0,0.7)",
      }}>
        <div className="mono" style={{
          display:"flex", alignItems:"center", gap: 6, padding:"6px 10px",
          fontSize: 9, color:"rgb(140,240,170)", background:"rgba(40,200,120,0.08)",
          borderBottom:"1px solid rgba(140,255,170,0.18)", letterSpacing:".16em",
        }}>
          <Icon name="eye-off" size={10}/> HIDDEN FROM SHARE
          <span style={{ marginLeft:"auto", width:4, height:4, borderRadius:99, background:"rgb(100,230,140)" }} className="red-pulse"/>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap: 8, padding:"8px 10px", borderBottom:"1px solid var(--hair)" }}>
          <Icon name="camera" size={11} stroke="rgba(255,255,255,0.8)"/>
          <span style={{ fontSize: 10.5, color: "var(--ink-90)" }}>Captured your screen</span>
        </div>
        <div style={{ padding:"10px" }}>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing:".22em", color:"var(--ink-40)", marginBottom: 3 }}>Q</div>
          <div style={{ fontSize: 11, color:"var(--ink)" }}>Why is this code slow?</div>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing:".22em", color:"var(--ink-40)", margin:"10px 0 3px" }}>A</div>
          <div style={{ fontSize: 10.5, color:"var(--ink-90)", lineHeight: 1.55 }}>
            json.Marshal re-reflects the struct every iteration.
            Pre-size the slice and cache an encoder — <span className="mono" style={{ color:"var(--ink)" }}>3-4×</span> faster.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── Pricing ─────────────────── */
function Pricing() {
  return (
    <Section id="pricing">
      <Eyebrow>Pricing</Eyebrow>
      <h2 style={{ margin:"16px 0 0", fontSize:"clamp(34px, 5vw, 56px)", fontWeight:400, letterSpacing:"-0.025em", lineHeight:1.05 }}>
        One subscription.<br/>Three tools.
      </h2>

      <div style={{ marginTop: 60, display:"grid", gridTemplateColumns:"1fr 1fr", gap: 20 }} className="md-grid">
        <PlanCard
          name="Free"
          price="0 ₽"
          tag="forever · no card"
          features={["Arena basic · 3 duels/day","Hone without AI planning","Public stats","Community access"]}
          cta="Create account"
        />
        <PlanCard
          featured
          name="druz9 Pro"
          price="790 ₽"
          priceSuffix="/ month"
          tag="everything"
          features={["Unlimited Arena · duels, mocks, seasons","Hone with AI plan + connections","Cue copilot · unlimited","Skill Atlas + rating forecast","Priority in guilds","Everything future ships here"]}
          cta="Start 14-day free"
        />
      </div>

      <p style={{ marginTop: 28, fontSize: 12.5, color:"var(--ink-40)", textAlign:"center" }}>
        Cancel anytime · Russian rubles · Invoice for teams · Data stored in RU (152-ФЗ)
      </p>
    </Section>
  );
}
function PlanCard({ name, price, priceSuffix, tag, features, cta, featured }) {
  return (
    <div style={{
      position:"relative", padding: "32px 32px 28px", borderRadius: 16,
      border: `1px solid ${featured ? "rgba(255,255,255,0.2)" : "var(--hair)"}`,
      background: featured ? "rgba(255,255,255,0.03)" : "transparent",
    }}>
      {featured && (
        <div className="mono" style={{
          position:"absolute", top: -10, right: 24,
          padding:"3px 10px", borderRadius: 999, fontSize: 9.5, letterSpacing:".2em",
          background: "var(--red)", color:"#fff",
        }}>RECOMMENDED</div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap: 10 }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 500, letterSpacing:"-0.01em" }}>{name}</span>
        <span className="mono" style={{ fontSize: 10, color:"var(--ink-40)", letterSpacing:".18em" }}>{tag.toUpperCase()}</span>
      </div>
      <div style={{ marginTop: 18, display:"flex", alignItems:"baseline", gap: 6 }}>
        <span className="mono" style={{ fontSize: 54, fontWeight: 300, letterSpacing:"-0.03em", lineHeight: 1 }}>{price}</span>
        {priceSuffix && <span className="mono" style={{ fontSize: 14, color:"var(--ink-40)" }}>{priceSuffix}</span>}
      </div>
      <ul style={{ listStyle:"none", padding: 0, margin: "28px 0 0", display:"flex", flexDirection:"column", gap: 10 }}>
        {features.map((f,i)=>(
          <li key={i} style={{ display:"flex", alignItems:"center", gap: 10, fontSize: 13.5, color:"var(--ink-90)" }}>
            <Icon name="check" size={12} stroke="var(--ink-60)"/>
            {f}
          </li>
        ))}
      </ul>
      <button style={{
        marginTop: 28, width:"100%", padding:"11px 16px", borderRadius: 999,
        background: featured ? "#fff" : "transparent",
        color: featured ? "#000" : "var(--ink)",
        border: featured ? "none" : "1px solid var(--hair-2)",
        fontSize: 13, fontWeight: 500,
      }}>{cta}</button>
    </div>
  );
}

/* ────────────────────────────── FAQ ─────────────────────── */
function FAQ() {
  const [open, setOpen] = useState(0);
  const items = [
    { q:"Why three apps instead of one?",
      a:"Each mode of work needs its own mental space. The arena is loud — competition, dueling, rating. The cockpit is quiet — your own plan, your own notes. The whisper is invisible — help without breaking flow. Merging them would dilute every one." },
    { q:"Do I need all three?",
      a:"No. Start with druz9.ru and solve a few duels. Add Hone when your streak feels worth tracking. Add Cue the first time you get stuck in a real interview." },
    { q:"Windows?",
      a:"macOS first, then Windows v2. Linux community port is tracked on GitHub." },
    { q:"Is Cue legal at work?",
      a:"Depends on your contract and on the meeting. We publish our stance on proctored interviews and pair-programming in the blog. Default: treat it like any productivity tool." },
    { q:"Russian data storage?",
      a:"Yes. Primary storage in Moscow, compliant with 152-ФЗ. EU replica for latency if your team is abroad." },
  ];
  return (
    <Section id="faq">
      <Eyebrow>FAQ</Eyebrow>
      <h2 style={{ margin:"16px 0 44px", fontSize:"clamp(30px, 4.2vw, 48px)", fontWeight:400, letterSpacing:"-0.02em", lineHeight:1.05 }}>
        Questions, asked plainly.
      </h2>
      <div style={{ display:"flex", flexDirection:"column", borderTop:"1px solid var(--hair)" }}>
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={i} style={{ borderBottom:"1px solid var(--hair)" }}>
              <button onClick={() => setOpen(isOpen ? -1 : i)}
                style={{ width:"100%", padding:"22px 0", display:"grid", gridTemplateColumns:"1fr auto",
                  alignItems:"center", gap: 16, textAlign:"left" }}>
                <span style={{ fontSize: 17, color:"var(--ink)" }}>{it.q}</span>
                <Icon name={isOpen ? "minus" : "plus"} size={14} stroke="var(--ink-60)"/>
              </button>
              {isOpen && (
                <div className="fadein" style={{ paddingBottom: 24, fontSize: 14.5, color:"var(--ink-60)", lineHeight: 1.65, maxWidth: 720 }}>
                  {it.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ────────────────────────────── Footer ─────────────────── */
function Footer() {
  return (
    <footer style={{ borderTop:"1px solid var(--hair)", padding: "48px 28px 60px" }}>
      <div style={{ maxWidth: 1200, margin:"0 auto", display:"grid", gridTemplateColumns:"1fr auto", gap: 32, alignItems:"flex-end" }} className="md-grid">
        <div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing:"0.28em" }}>DRUZ9</div>
          <div style={{ marginTop: 14, display:"flex", gap: 24, flexWrap:"wrap" }}>
            <FooterLink href="#arena">Arena</FooterLink>
            <FooterLink href="#hone">Hone</FooterLink>
            <FooterLink href="#cue">Cue</FooterLink>
            <FooterLink href="#pricing">Pricing</FooterLink>
            <FooterLink href="#">Blog</FooterLink>
            <FooterLink href="#">Terms</FooterLink>
            <FooterLink href="#">Privacy</FooterLink>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <a href="#" style={{ fontSize: 13, color:"var(--ink-90)", textDecoration:"none" }}>t.me/usehone</a>
          <div className="mono" style={{ marginTop: 8, fontSize: 11, color:"var(--ink-40)", letterSpacing:".14em" }}>
            MADE IN RUSSIA · 2026
          </div>
        </div>
      </div>
    </footer>
  );
}
function FooterLink({ href, children }) {
  return <a href={href} style={{ fontSize: 13, color:"var(--ink-60)", textDecoration:"none" }}>{children}</a>;
}

/* ────────────────────────────── App ──────────────────────── */
function App() {
  return (
    <div style={{ minHeight:"100vh", background:"#000", position:"relative" }}>
      <style>{`
        @media (max-width: 800px) {
          .md-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 800px) {
          .md\\:flex { display: none !important; }
          .md\\:hidden { display: inline-flex !important; }
          .md\\:inline-flex { display: none !important; }
        }
        @media (min-width: 801px) {
          .md\\:hidden { display: none !important; }
        }
      `}</style>
      <Nav/>
      <Hero/>
      <Ritual/>

      <ProductRow
        id="arena"
        sideLeft
        name="druz9" tag="Product · Arena"
        title="The arena."
        desc="Live duels. Mock interviews. Rating. Guilds. Podcasts. Where you compete against peers, in real time, and see exactly where you stand."
        bullets={["1v1 & 2v2 duels", "AI + peer mock", "Skill Atlas progress", "Seasons & tournaments"]}
        cta={<a href="#" style={{ display:"inline-flex", alignItems:"center", gap: 10, padding:"11px 18px", borderRadius: 999, background:"#fff", color:"#000", fontSize: 13, fontWeight: 500, textDecoration:"none" }}>Enter arena <Icon name="arrow" size={12}/></a>}
        mock={<ArenaMock/>}
      />

      <ProductRow
        id="hone"
        sideLeft={false}
        name="Hone" tag="Product · Focus"
        title="The cockpit."
        desc="Minimal desktop app for the quiet work. AI plans your day, tracks your streaks, and stays out of the way. Pure black. Keyboard-first. No noise."
        bullets={["AI-planned Today","Pomodoro focus","Private notes w/ AI links","Whiteboard + AI critique"]}
        cta={<a href="#" style={{ display:"inline-flex", alignItems:"center", gap: 10, padding:"11px 18px", borderRadius: 999, background:"#fff", color:"#000", fontSize: 13, fontWeight: 500, textDecoration:"none" }}><Icon name="apple" size={14}/> Download for macOS</a>}
        mock={<HoneMock/>}
      />

      <ProductRow
        id="cue"
        sideLeft
        name="Cue" tag="Product · Copilot"
        title="The whisper."
        desc="Invisible AI overlay. Press ⌘⇧Space anywhere — Cue sees your screen and helps. Invisible to Zoom, Meet, and any screen share."
        bullets={["Global hotkey","Screen-aware","Hidden from capture","Works in any app"]}
        cta={
          <div style={{ display:"flex", gap: 10, flexWrap:"wrap", alignItems:"center" }}>
            <a href="#" style={{ display:"inline-flex", alignItems:"center", gap: 10, padding:"11px 18px", borderRadius: 999, background:"#fff", color:"#000", fontSize: 13, fontWeight: 500, textDecoration:"none" }}><Icon name="apple" size={14}/> Download Cue</a>
            <span style={{ display:"inline-flex", alignItems:"center", gap: 8, padding:"6px 10px", borderRadius: 999, border:"1px solid rgba(140,255,170,0.24)", background:"rgba(40,200,120,0.06)", fontSize: 11, color:"rgb(140,240,170)" }} className="mono">
              <span style={{ width:5, height:5, borderRadius:99, background:"rgb(100,230,140)" }}/>
              Tested in Zoom · Meet · Chrome
            </span>
          </div>
        }
        mock={<CueMock/>}
      />

      <Pricing/>
      <FAQ/>
      <Footer/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
