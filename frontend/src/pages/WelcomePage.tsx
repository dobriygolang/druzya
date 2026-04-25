import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * WelcomePage — публичный лендинг druz9.
 * Порт design/hone/landing/landing.jsx — минималистичная hone-эстетика:
 * чистый чёрный фон, белый текст со слоями opacity, hairlines,
 * красный pulse-индикатор. Никакого фиолетового glow и cyan-eyebrow —
 * это «арена + cockpit + whisper», подаются как одна экосистема.
 */

/* ────────────────────────── Icons ────────────────────────── */
type IconName =
  | 'arrow' | 'arrow-dn' | 'check' | 'moon-sun' | 'pomo' | 'shh' | 'arena'
  | 'apple' | 'menu' | 'x' | 'eye-off' | 'camera' | 'plus' | 'minus'

function Icon({ name, size = 14, stroke = 'currentColor', sw = 1.4 }: {
  name: IconName; size?: number; stroke?: string; sw?: number
}) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none' as const, stroke, strokeWidth: sw,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'arrow':    return <svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>
    case 'arrow-dn': return <svg {...p}><path d="M12 5v14M5 13l7 7 7-7"/></svg>
    case 'check':    return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>
    case 'moon-sun': return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>
    case 'pomo':     return <svg {...p}><circle cx="12" cy="13" r="7"/><path d="M9 3h6M12 10v3l2 2"/></svg>
    case 'shh':      return <svg {...p}><path d="M3 11a9 9 0 0118 0v5a2 2 0 01-2 2h-3v-6h4M3 11v5a2 2 0 002 2h3v-6H3"/></svg>
    case 'arena':    return <svg {...p}><path d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/></svg>
    case 'apple':    return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M16.37 12.62c-.02-2.32 1.9-3.44 1.99-3.5-1.09-1.59-2.78-1.81-3.38-1.83-1.44-.15-2.81.85-3.54.85-.73 0-1.86-.83-3.06-.81-1.57.02-3.03.92-3.84 2.33-1.64 2.84-.42 7.04 1.18 9.35.78 1.13 1.71 2.4 2.92 2.35 1.17-.05 1.62-.76 3.03-.76 1.41 0 1.81.76 3.05.73 1.26-.02 2.06-1.15 2.83-2.29.89-1.32 1.26-2.6 1.28-2.67-.03-.01-2.44-.94-2.46-3.75zM14.1 5.55c.64-.79 1.08-1.87.96-2.95-.93.04-2.07.63-2.73 1.4-.6.69-1.12 1.8-.98 2.86 1.04.08 2.11-.53 2.75-1.31z"/></svg>
    case 'menu':     return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    case 'x':        return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>
    case 'eye-off':  return <svg {...p}><path d="M3 3l18 18"/><path d="M10.5 6.2A9 9 0 0121 12a12 12 0 01-2.7 3.4M6.6 6.6A12 12 0 003 12c2 4 6 7 9 7 1.5 0 3-.4 4.3-1.1"/><path d="M10 10a3 3 0 004 4"/></svg>
    case 'camera':   return <svg {...p}><path d="M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="4"/></svg>
    case 'plus':     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>
    case 'minus':    return <svg {...p}><path d="M5 12h14"/></svg>
  }
}

/* ────────────────────────── Canvas bg ─────────────────────── */
const STARS = [
  {x:7,y:14,r:1.1,o:.45},{x:17,y:72,r:1,o:.35},{x:23,y:28,r:1.3,o:.55},
  {x:31,y:84,r:.9,o:.3},{x:39,y:12,r:1,o:.4},{x:44,y:58,r:1.1,o:.5},
  {x:52,y:22,r:.9,o:.3},{x:58,y:80,r:1.2,o:.55},{x:63,y:38,r:1,o:.4},
  {x:68,y:64,r:.9,o:.35},{x:73,y:18,r:1.1,o:.5},{x:78,y:48,r:1,o:.4},
  {x:83,y:74,r:.9,o:.3},{x:88,y:30,r:1.2,o:.6},{x:92,y:58,r:1,o:.45},
  {x:14,y:44,r:.9,o:.35},{x:46,y:90,r:1,o:.3},{x:3,y:62,r:1.1,o:.45},
  {x:36,y:50,r:.9,o:.3},{x:71,y:88,r:1,o:.4},
]
const WAVES = [
  'M-50,280 C 260,220 420,340 700,290 S 1200,200 1700,260',
  'M-50,390 C 200,350 500,430 820,390 S 1300,340 1700,380',
  'M-50,500 C 240,470 520,560 860,510 S 1340,450 1700,490',
  'M-50,605 C 300,580 620,660 920,620 S 1380,570 1700,600',
  'M-50,700 C 280,680 560,750 900,720 S 1360,680 1700,705',
  'M-50,790 C 320,770 640,820 960,800 S 1420,770 1700,790',
]

function CanvasBg({ strong = true }: { strong?: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        {STARS.map((s, i) => (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r}
            fill={`rgba(255,255,255,${s.o * (strong ? 1 : 0.4)})`} />
        ))}
      </svg>
      {strong && (
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0 }}>
          {WAVES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={`rgba(255,255,255,${0.08 + (i % 3) * 0.006})`} strokeWidth="1" />
          ))}
        </svg>
      )}
    </div>
  )
}

/* ────────────────────────── Nav ───────────────────────────── */
function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', on)
    on()
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className="no-select" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
      padding: '18px 28px',
      background: scrolled ? 'rgba(0,0,0,0.7)' : 'transparent',
      backdropFilter: scrolled ? 'blur(18px)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(18px)' : 'none',
      borderBottom: scrolled ? '1px solid var(--hair)' : '1px solid transparent',
      transition: 'all 200ms ease',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 32 }}>
        <a href="#top" className="mono"
           style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.28em', color: 'rgb(var(--ink))', textDecoration: 'none' }}>
          DRUZ9
        </a>
        <nav className="hidden md:flex" style={{ gap: 24 }}>
          <NavLink href="#arena">Arena</NavLink>
          <NavLink href="#hone">Hone</NavLink>
          <NavLink href="#cue">Cue</NavLink>
          <NavLink href="#pricing">Тарифы</NavLink>
          <NavLink href="#faq">FAQ</NavLink>
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/login" className="hidden md:inline-flex"
                style={{ fontSize: 13, color: 'var(--ink-60)', textDecoration: 'none' }}>
            Войти
          </Link>
          <Link to="/login"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 13px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 12.5, fontWeight: 500, textDecoration: 'none' }}>
            Начать бесплатно <Icon name="arrow" size={11} />
          </Link>
          <button onClick={() => setOpen((o) => !o)} className="md:hidden"
                  style={{ color: 'rgb(var(--ink))', marginLeft: 4 }}>
            <Icon name={open ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
          {[
            ['arena', 'Arena'], ['hone', 'Hone'], ['cue', 'Cue'],
            ['pricing', 'Тарифы'], ['faq', 'FAQ'],
          ].map(([h, label]) => (
            <a key={h} href={`#${h}`} onClick={() => setOpen(false)}
               style={{ padding: '8px 0', fontSize: 14, color: 'var(--ink-60)', textDecoration: 'none' }}>
              {label}
            </a>
          ))}
        </div>
      )}
    </header>
  )
}
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href}
       style={{ fontSize: 13, color: 'var(--ink-60)', textDecoration: 'none', transition: 'color 120ms ease' }}
       onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
       onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}>
      {children}
    </a>
  )
}

/* ────────────────────────── Section shell ─────────────────── */
function Section({ id, children, style }: { id?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section id={id} style={{ position: 'relative', padding: '128px 28px', borderTop: '1px solid var(--hair)', ...style }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative' }}>{children}</div>
    </section>
  )
}
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mono"
         style={{ fontSize: 10.5, letterSpacing: '.28em', color: 'var(--ink-40)', textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

/* ────────────────────────── Hero ──────────────────────────── */
function Hero() {
  return (
    <section id="top"
             style={{ position: 'relative', minHeight: '100vh', display: 'flex',
               alignItems: 'center', justifyContent: 'center', padding: '120px 28px 80px' }}>
      <CanvasBg strong />
      <div className="hone-fadein" style={{ position: 'relative', textAlign: 'center', maxWidth: 820, width: '100%' }}>
        <div className="mono"
             style={{ fontSize: 11, letterSpacing: '.28em', color: 'var(--ink-40)', marginBottom: 20 }}>
          <span className="red-pulse"
                style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--red)',
                  display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
          PUBLIC BETA · v.0.9
        </div>
        <h1 style={{ margin: 0, fontSize: 'clamp(44px, 7vw, 84px)', fontWeight: 400,
                     letterSpacing: '-0.035em', lineHeight: 1.02 }}>
          Затачивай ремесло.
          <br />
          <span style={{ color: 'var(--ink-60)' }}>Каждый день.</span>
        </h1>
        <p style={{ margin: '26px auto 0', maxWidth: 560, fontSize: 16,
                    color: 'var(--ink-60)', lineHeight: 1.55 }}>
          Экосистема для разработчиков, которые растут каждый день.
          Три инструмента. Один ритуал. Одна подписка.
        </p>
        <div style={{ marginTop: 36, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/login"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Начать бесплатно <Icon name="arrow" size={12} />
          </Link>
          <a href="#ritual"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px',
               borderRadius: 999, border: '1px solid var(--hair-2)', color: 'rgb(var(--ink))',
               fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            Как это работает
          </a>
        </div>
        <div style={{ marginTop: 64, display: 'inline-flex', alignItems: 'center', gap: 0,
                      padding: '6px 8px', border: '1px solid var(--hair)', borderRadius: 999,
                      background: 'rgba(10,10,10,0.6)', backdropFilter: 'blur(12px)' }}>
          <ProductPill name="druz9.ru" tag="Arena" />
          <span style={{ width: 1, height: 14, background: 'var(--hair-2)', margin: '0 4px' }} />
          <ProductPill name="Hone" tag="Focus" />
          <span style={{ width: 1, height: 14, background: 'var(--hair-2)', margin: '0 4px' }} />
          <ProductPill name="Cue" tag="Copilot" />
        </div>
      </div>
      <a href="#ritual" className="mono no-select"
         style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
           fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)',
           textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        SCROLL <Icon name="arrow-dn" size={11} />
      </a>
    </section>
  )
}
function ProductPill({ name, tag }: { name: string; tag: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px' }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: '#fff' }} />
      <span className="mono" style={{ fontSize: 12, color: 'rgb(var(--ink))' }}>{name}</span>
      <span className="mono"
            style={{ fontSize: 10.5, color: 'var(--ink-40)', letterSpacing: '.14em', textTransform: 'uppercase' }}>
        {tag}
      </span>
    </span>
  )
}

/* ────────────────────────── Ritual ────────────────────────── */
function Ritual() {
  const beats: { t: string; icon: IconName; title: string; sub: string }[] = [
    { t: '07:00', icon: 'moon-sun', title: 'Открой Hone.',         sub: 'AI собирает план дня.' },
    { t: '09:30', icon: 'pomo',     title: 'Фокус-сессия.',         sub: 'Решай на druz9.ru.' },
    { t: '13:00', icon: 'shh',      title: 'Завис на работе.',      sub: '⌘⇧Space. Cue шепнёт.' },
    { t: '18:00', icon: 'arena',    title: 'Mock-интервью.',         sub: 'На druz9.ru.' },
  ]
  return (
    <Section id="ritual">
      <Eyebrow>Ритуал</Eyebrow>
      <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
                   letterSpacing: '-0.025em', lineHeight: 1.05 }}>
        Один день из жизни.
      </h2>
      <p style={{ margin: '18px 0 0', fontSize: 15, color: 'var(--ink-60)', maxWidth: 560, lineHeight: 1.55 }}>
        Три поверхности — один ритм. У каждого продукта свой момент. Они не пересекаются.
      </p>
      <div style={{ marginTop: 72, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 36, height: 1, background: 'var(--hair-2)' }} />
        <div className="md-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
          {beats.map((b, i) => (
            <div key={i} style={{ position: 'relative', paddingTop: 8 }}>
              <div style={{ width: 58, height: 58, borderRadius: 999,
                border: '1px solid var(--hair-2)', background: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', zIndex: 2, color: 'rgb(var(--ink))' }}>
                <Icon name={b.icon} size={20} sw={1.2} />
              </div>
              <div className="mono" style={{ marginTop: 22, fontSize: 11, letterSpacing: '.22em', color: 'var(--ink-40)' }}>{b.t}</div>
              <div style={{ marginTop: 10, fontSize: 18, letterSpacing: '-0.01em' }}>{b.title}</div>
              <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ink-60)' }}>{b.sub}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mono"
           style={{ marginTop: 80, fontSize: 12, color: 'var(--ink-40)',
             letterSpacing: '.12em', textAlign: 'center' }}>
        ОДИН АККАУНТ · ОДНА ПОДПИСКА · ТРИ ПОВЕРХНОСТИ
      </div>
    </Section>
  )
}

/* ────────────────────────── ProductRow ────────────────────── */
function ProductRow({ id, sideLeft = true, name, tag, title, desc, bullets, cta, mock }: {
  id: string; sideLeft?: boolean; name: string; tag: string; title: string; desc: string;
  bullets: string[]; cta: ReactNode; mock: ReactNode
}) {
  return (
    <Section id={id}>
      <div className="md-grid"
           style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
        <div style={{ order: sideLeft ? 0 : 1 }}>
          <Eyebrow>{tag}</Eyebrow>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono"
                  style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.01em',
                    paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.4)' }}>
              {name}
            </span>
          </div>
          <h2 style={{ margin: '28px 0 0', fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 400,
                       letterSpacing: '-0.02em', lineHeight: 1.08 }}>
            {title}
          </h2>
          <p style={{ margin: '20px 0 0', fontSize: 15, color: 'var(--ink-60)',
                      lineHeight: 1.65, maxWidth: 480 }}>
            {desc}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '28px 0 0', display: 'grid',
                       gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink-90)' }}>
                <Icon name="check" size={12} stroke="rgba(255,255,255,0.6)" />
                {b}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 32 }}>{cta}</div>
        </div>
        <div style={{ order: sideLeft ? 1 : 0 }}>{mock}</div>
      </div>
    </Section>
  )
}

/* ────────────────────────── Mocks ─────────────────────────── */
function ArenaMock() {
  return (
    <div style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden',
      border: '1px solid var(--hair-2)', background: '#000' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.7 }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          {STARS.map((s, i) => (
            <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r * 0.9}
                    fill={`rgba(255,255,255,${s.o * 0.6})`} />
          ))}
        </svg>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: '1px solid var(--hair)', background: 'rgba(0,0,0,0.5)', position: 'relative', zIndex: 2 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-40)', marginLeft: 14 }}>druz9.ru/arena</div>
        <span className="red-pulse"
              style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: 99, background: 'var(--red)' }} />
        <span className="mono" style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '.14em' }}>LIVE</span>
      </div>
      <div style={{ position: 'relative', zIndex: 2, padding: '22px 20px', display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14 }}>
        <Fighter name="ты" elo="1842" streak="+12" />
        <div className="mono"
             style={{ fontSize: 34, fontWeight: 300, textAlign: 'center', letterSpacing: '-0.03em' }}>
          02:14
          <div style={{ fontSize: 10, color: 'var(--ink-40)', letterSpacing: '.22em', marginTop: 2 }}>DUEL 1V1</div>
        </div>
        <Fighter name="@ivn" elo="1869" streak="−3" right />
      </div>
      <div style={{ position: 'relative', zIndex: 2, padding: '6px 20px 18px' }}>
        <div className="mono"
             style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)', margin: '10px 0 8px' }}>
          СЕЗОН · ТОП 5
        </div>
        {[
          { n: 'zkv',       v: '2341' },
          { n: 'vlad',      v: '2210' },
          { n: 'alena_b',   v: '2104', me: true },
          { n: 'arhip42',   v: '2088' },
          { n: 'kostya.go', v: '2041' },
        ].map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto',
                                alignItems: 'center', padding: '5px 0',
                                borderTop: '1px solid var(--hair)', fontSize: 12 }}>
            <span className="mono" style={{ color: 'var(--ink-40)' }}>#{i + 1}</span>
            <span style={{ color: r.me ? 'rgb(var(--ink))' : 'var(--ink-90)' }}>
              {r.n}
              {r.me && <span className="mono" style={{ color: 'var(--red)', marginLeft: 6 }}>ты</span>}
            </span>
            <span className="mono" style={{ color: 'var(--ink-60)' }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
function Fighter({ name, elo, streak, right }: {
  name: string; elo: string; streak: string; right?: boolean
}) {
  return (
    <div style={{ textAlign: right ? 'right' : 'left' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)' }}>
        {right ? 'СОПЕРНИК' : 'ТЫ'}
      </div>
      <div style={{ fontSize: 18, marginTop: 6 }}>{name}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-60)', marginTop: 4 }}>
        ELO {elo}{' '}
        <span style={{ color: streak.startsWith('+') ? 'rgb(120,230,170)' : 'var(--red)' }}>{streak}</span>
      </div>
    </div>
  )
}

function HoneMock() {
  return (
    <div style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden',
      border: '1px solid var(--hair-2)', background: '#000' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: '1px solid var(--hair)', background: 'rgba(0,0,0,0.6)', position: 'relative', zIndex: 3 }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
      </div>
      <div style={{ position: 'absolute', inset: 0 }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          {STARS.map((s, i) => (
            <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r}
                    fill={`rgba(255,255,255,${s.o * 0.6})`} />
          ))}
        </svg>
        <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="none"
             style={{ position: 'absolute', inset: 0 }}>
          {WAVES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={`rgba(255,255,255,${0.07 + (i % 3) * 0.005})`} strokeWidth="1" />
          ))}
        </svg>
      </div>
      <div style={{ position: 'absolute', top: 54, left: 24, zIndex: 3 }}>
        <div className="mono"
             style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', paddingBottom: 5,
               borderBottom: '1px solid rgba(255,255,255,0.5)', display: 'inline-block' }}>HONE</div>
      </div>
      <div style={{ position: 'absolute', top: 54, right: 24, zIndex: 3, textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: 9, color: 'var(--ink-40)', letterSpacing: '.22em' }}>1010</div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--ink-40)', letterSpacing: '.14em', marginTop: 4 }}>v.0.0.1</div>
      </div>
      <div style={{ position: 'absolute', left: '28%', top: '52%', transform: 'translate(-50%,-50%)',
                    width: 100, height: 100, opacity: 0.18 }}>
        <svg width="100" height="100" viewBox="-50 -50 100 100">
          <rect x={-34} y={-34} width={68} height={68} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
        </svg>
        <svg width="100" height="100" viewBox="-50 -50 100 100"
             style={{ position: 'absolute', inset: 0, transform: 'rotate(10deg)' }}>
          <rect x={-34} y={-34} width={68} height={68} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1" />
        </svg>
      </div>
      <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999,
                    background: 'rgba(10,10,10,0.72)', border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(14px)', zIndex: 3 }}>
        <span style={{ padding: '6px 8px', color: 'var(--ink-60)' }}><Icon name="menu" size={13} /></span>
        <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <span className="red-pulse" style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--red)' }} />
          <span className="mono" style={{ fontSize: 13, color: 'rgb(var(--ink))' }}>24:10</span>
        </span>
        <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ padding: '6px 8px', color: 'var(--ink-60)' }}><Icon name="pomo" size={13} sw={1.2} /></span>
      </div>
    </div>
  )
}

function CueMock() {
  return (
    <div style={{ position: 'relative', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden',
      border: '1px solid var(--hair-2)', background: '#0a0a0a' }}>
      <div style={{ position: 'absolute', inset: 0, padding: '14px 0 0 0' }}>
        <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10,
                      borderBottom: '1px solid var(--hair)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.14)' }} />
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', marginLeft: 12 }}>handlers.go</div>
        </div>
        <div className="mono" style={{ padding: '16px 18px', fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.8 }}>
          <div><span style={{ color: 'rgba(255,255,255,0.3)' }}>23 </span><span style={{ color: 'rgba(160,200,255,0.7)' }}>func</span>{' '}
               <span style={{ color: 'var(--ink-90)' }}>handleBatch</span>(items []Item) error {'{'}</div>
          <div><span style={{ color: 'rgba(255,255,255,0.3)' }}>24 </span>  out := []byte{'{'}{'}'}</div>
          <div><span style={{ color: 'rgba(255,255,255,0.3)' }}>25 </span>  <span style={{ color: 'rgba(160,200,255,0.7)' }}>for</span> _, it := range items {'{'}</div>
          <div style={{ background: 'rgba(255,59,48,0.08)', borderLeft: '2px solid var(--red)',
                        paddingLeft: 6, marginLeft: -8 }}>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>26 </span>    b, _ := json.Marshal(it)
          </div>
          <div><span style={{ color: 'rgba(255,255,255,0.3)' }}>27 </span>    out = append(out, b...)</div>
          <div><span style={{ color: 'rgba(255,255,255,0.3)' }}>28 </span>  {'}'}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 16, right: 14, width: 260, zIndex: 4,
                    background: 'rgba(8,8,8,0.9)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 11, overflow: 'hidden', backdropFilter: 'blur(20px)',
                    boxShadow: '0 20px 50px -10px rgba(0,0,0,0.7)' }}>
        <div className="mono"
             style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
               fontSize: 9, color: 'rgb(140,240,170)', background: 'rgba(40,200,120,0.08)',
               borderBottom: '1px solid rgba(140,255,170,0.18)', letterSpacing: '.16em' }}>
          <Icon name="eye-off" size={10} /> СКРЫТО ОТ ЗАХВАТА
          <span className="red-pulse"
                style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: 99, background: 'rgb(100,230,140)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                      borderBottom: '1px solid var(--hair)' }}>
          <Icon name="camera" size={11} stroke="rgba(255,255,255,0.8)" />
          <span style={{ fontSize: 10.5, color: 'var(--ink-90)' }}>Захвачен экран</span>
        </div>
        <div style={{ padding: 10 }}>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing: '.22em', color: 'var(--ink-40)', marginBottom: 3 }}>Q</div>
          <div style={{ fontSize: 11, color: 'rgb(var(--ink))' }}>Почему этот код медленный?</div>
          <div className="mono" style={{ fontSize: 8.5, letterSpacing: '.22em', color: 'var(--ink-40)', margin: '10px 0 3px' }}>A</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-90)', lineHeight: 1.55 }}>
            json.Marshal на каждом шаге заново рефлектит структуру.
            Префиксируй слайс и кэшируй encoder — <span className="mono" style={{ color: 'rgb(var(--ink))' }}>3-4×</span> быстрее.
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── Pricing ───────────────────────── */
function Pricing() {
  return (
    <Section id="pricing">
      <Eyebrow>Тарифы</Eyebrow>
      <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
                   letterSpacing: '-0.025em', lineHeight: 1.05 }}>
        Одна подписка.<br />Три инструмента.
      </h2>
      <div className="md-grid"
           style={{ marginTop: 60, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <PlanCard
          name="Free" price="0 ₽" tag="навсегда · без карты"
          features={[
            'Arena basic · 3 дуэли в день',
            'Hone без AI-планирования',
            'Публичная статистика',
            'Доступ в комьюнити',
          ]}
          cta="Создать аккаунт"
        />
        <PlanCard
          featured
          name="druz9 Pro" price="790 ₽" priceSuffix="/ месяц" tag="всё внутри"
          features={[
            'Безлимит Arena · дуэли, моки, сезоны',
            'Hone с AI-планом и связями',
            'Cue copilot · без лимита',
            'Skill Atlas + прогноз рейтинга',
            'Приоритет в гильдиях',
            'Всё, что появится в будущем',
          ]}
          cta="14 дней бесплатно"
        />
      </div>
      <p style={{ marginTop: 28, fontSize: 12.5, color: 'var(--ink-40)', textAlign: 'center' }}>
        Отмена в любой момент · Рубли · Счёт для команд · Данные хранятся в РФ (152-ФЗ)
      </p>
    </Section>
  )
}
function PlanCard({ name, price, priceSuffix, tag, features, cta, featured }: {
  name: string; price: string; priceSuffix?: string; tag: string;
  features: string[]; cta: string; featured?: boolean
}) {
  return (
    <div style={{ position: 'relative', padding: '32px 32px 28px', borderRadius: 16,
      border: `1px solid ${featured ? 'rgba(255,255,255,0.2)' : 'var(--hair)'}`,
      background: featured ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
      {featured && (
        <div className="mono"
             style={{ position: 'absolute', top: -10, right: 24, padding: '3px 10px',
               borderRadius: 999, fontSize: 9.5, letterSpacing: '.2em',
               background: 'var(--red)', color: '#fff' }}>РЕКОМЕНДУЕМ</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em' }}>{name}</span>
        <span className="mono"
              style={{ fontSize: 10, color: 'var(--ink-40)', letterSpacing: '.18em' }}>
          {tag.toUpperCase()}
        </span>
      </div>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="mono"
              style={{ fontSize: 54, fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {price}
        </span>
        {priceSuffix && (
          <span className="mono" style={{ fontSize: 14, color: 'var(--ink-40)' }}>{priceSuffix}</span>
        )}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '28px 0 0',
                   display: 'flex', flexDirection: 'column', gap: 10 }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink-90)' }}>
            <Icon name="check" size={12} stroke="rgba(255,255,255,0.6)" />
            {f}
          </li>
        ))}
      </ul>
      <Link to="/login" style={{ textDecoration: 'none' }}>
        <button style={{ marginTop: 28, width: '100%', padding: '11px 16px', borderRadius: 999,
          background: featured ? '#fff' : 'transparent',
          color: featured ? '#000' : 'rgb(var(--ink))',
          border: featured ? 'none' : '1px solid var(--hair-2)',
          fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
          {cta}
        </button>
      </Link>
    </div>
  )
}

/* ────────────────────────── FAQ ───────────────────────────── */
function FAQ() {
  const [open, setOpen] = useState(0)
  const items = [
    { q: 'Почему три приложения, а не одно?',
      a: 'У каждого режима работы — своё ментальное пространство. Арена шумная: соревнование, дуэли, рейтинг. Cockpit тихий: твой план, твои заметки. Шёпот невидимый: помощь, не ломая флоу. Если их слить, каждый размоется.' },
    { q: 'Нужны ли все три?',
      a: 'Нет. Начни с druz9.ru и реши пару дуэлей. Hone подключай, когда серия станет важной. Cue — когда первый раз застрянешь на реальном собеседовании.' },
    { q: 'Windows?',
      a: 'Сначала macOS, потом Windows v2. Linux community-порт отслеживается на GitHub.' },
    { q: 'Cue легален на работе?',
      a: 'Зависит от твоего договора и от встречи. Нашу позицию по proctored-собесам и pair-programming публикуем в блоге. По умолчанию — относись как к любому productivity-инструменту.' },
    { q: 'Где хранятся данные?',
      a: 'Первичное хранение в Москве, 152-ФЗ. EU-реплика для скорости, если команда за рубежом.' },
  ]
  return (
    <Section id="faq">
      <Eyebrow>FAQ</Eyebrow>
      <h2 style={{ margin: '16px 0 44px', fontSize: 'clamp(30px, 4.2vw, 48px)', fontWeight: 400,
                   letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        Вопросы по делу.
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--hair)' }}>
        {items.map((it, i) => {
          const isOpen = open === i
          return (
            <div key={i} style={{ borderBottom: '1px solid var(--hair)' }}>
              <button onClick={() => setOpen(isOpen ? -1 : i)}
                      style={{ width: '100%', padding: '22px 0', display: 'grid',
                        gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 16,
                        textAlign: 'left', background: 'none', border: 0, cursor: 'pointer',
                        color: 'inherit' }}>
                <span style={{ fontSize: 17, color: 'rgb(var(--ink))' }}>{it.q}</span>
                <Icon name={isOpen ? 'minus' : 'plus'} size={14} stroke="rgba(255,255,255,0.6)" />
              </button>
              {isOpen && (
                <div className="hone-fadein"
                     style={{ paddingBottom: 24, fontSize: 14.5, color: 'var(--ink-60)',
                       lineHeight: 1.65, maxWidth: 720 }}>
                  {it.a}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ────────────────────────── Footer ────────────────────────── */
function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--hair)', padding: '48px 28px 60px' }}>
      <div className="md-grid"
           style={{ maxWidth: 1200, margin: '0 auto', display: 'grid',
             gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'flex-end' }}>
        <div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.28em' }}>DRUZ9</div>
          <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <FooterLink href="#arena">Arena</FooterLink>
            <FooterLink href="#hone">Hone</FooterLink>
            <FooterLink href="#cue">Cue</FooterLink>
            <FooterLink href="#pricing">Тарифы</FooterLink>
            <FooterLink href="/help" router>Помощь</FooterLink>
            <FooterLink href="/legal/terms" router>Условия</FooterLink>
            <FooterLink href="/legal/privacy" router>Приватность</FooterLink>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <a href="https://t.me/druz9" target="_blank" rel="noopener noreferrer"
             style={{ fontSize: 13, color: 'var(--ink-90)', textDecoration: 'none' }}>
            t.me/druz9
          </a>
          <div className="mono"
               style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)', letterSpacing: '.14em' }}>
            СДЕЛАНО В РОССИИ · {new Date().getFullYear()}
          </div>
        </div>
      </div>
    </footer>
  )
}
function FooterLink({ href, children, router }: {
  href: string; children: ReactNode; router?: boolean
}) {
  const style: CSSProperties = { fontSize: 13, color: 'var(--ink-60)', textDecoration: 'none' }
  if (router) return <Link to={href} style={style}>{children}</Link>
  return <a href={href} style={style}>{children}</a>
}

/* ────────────────────────── App ───────────────────────────── */
export default function WelcomePage() {
  // body must lose .v2 here — landing wants pure black, not the v2 token bg.
  // Also disable horizontal overflow guard inherited from .v2.
  useEffect(() => {
    const had = document.body.classList.contains('v2')
    document.body.classList.remove('v2')
    document.body.style.background = '#000'
    document.body.style.color = '#fff'
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => {
      if (had) document.body.classList.add('v2')
      document.body.style.background = ''
      document.body.style.color = ''
      document.documentElement.style.scrollBehavior = prev
    }
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#000', position: 'relative',
                  fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif", color: '#fff' }}>
      <style>{`
        @media (max-width: 800px) {
          .md-grid { grid-template-columns: 1fr !important; }
          .md\\:flex { display: none !important; }
          .md\\:hidden { display: inline-flex !important; }
          .md\\:inline-flex { display: none !important; }
        }
        @media (min-width: 801px) {
          .md\\:hidden { display: none !important; }
          .md\\:flex { display: flex !important; }
          .md\\:inline-flex { display: inline-flex !important; }
        }
      `}</style>
      <Nav />
      <Hero />
      <Ritual />

      <ProductRow
        id="arena" sideLeft
        name="druz9" tag="Продукт · Arena"
        title="Арена."
        desc="Живые дуэли. Mock-интервью. Рейтинг. Гильдии. Подкасты. Здесь ты соревнуешься с равными в реальном времени и видишь, где стоишь."
        bullets={['Дуэли 1v1 и 2v2', 'AI + peer mock', 'Skill Atlas прогресс', 'Сезоны и турниры']}
        cta={
          <Link to="/arena"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            На арену <Icon name="arrow" size={12} />
          </Link>
        }
        mock={<ArenaMock />}
      />

      <ProductRow
        id="hone" sideLeft={false}
        name="Hone" tag="Продукт · Focus"
        title="Cockpit."
        desc="Минималистичное desktop-приложение для тихой работы. AI планирует день, считает серии, не лезет под руку. Чистый чёрный. Клавиатура. Без шума."
        bullets={['AI-план на сегодня', 'Pomodoro-фокус', 'Приватные заметки + AI-связи', 'Доска + AI-критика']}
        cta={
          <a href="#"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
               borderRadius: 999, background: '#fff', color: '#000',
               fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            <Icon name="apple" size={14} /> Скачать для macOS
          </a>
        }
        mock={<HoneMock />}
      />

      <ProductRow
        id="cue" sideLeft
        name="Cue" tag="Продукт · Copilot"
        title="Шёпот."
        desc="Невидимый AI-overlay. ⌘⇧Space в любом приложении — Cue видит экран и помогает. Невидим для Zoom, Meet и любых screen share."
        bullets={['Глобальный хоткей', 'Видит экран', 'Скрыт от захвата', 'Работает везде']}
        cta={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <a href="#"
               style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                 borderRadius: 999, background: '#fff', color: '#000',
                 fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
              <Icon name="apple" size={14} /> Скачать Cue
            </a>
            <span className="mono"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 999,
                    border: '1px solid rgba(140,255,170,0.24)',
                    background: 'rgba(40,200,120,0.06)',
                    fontSize: 11, color: 'rgb(140,240,170)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: 'rgb(100,230,140)' }} />
              Тестировано в Zoom · Meet · Chrome
            </span>
          </div>
        }
        mock={<CueMock />}
      />

      <Pricing />
      <FAQ />
      <Footer />
    </div>
  )
}
