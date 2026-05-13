import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { HoneDemo, CueDemo, MockWatermarkDemo, DemoModal } from './welcome/demos'

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
  const { t } = useTranslation('welcome')
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', on)
    on()
    return () => window.removeEventListener('scroll', on)
  }, [])
  const navItems: [string, string][] = [
    ['tracks', t('landing.nav.tracks')],
    ['atlas', t('landing.nav.mock')],
    ['hone', t('landing.nav.hone')],
    ['cue', t('landing.nav.cue')],
    ['insights', t('landing.nav.insights')],
    ['pricing', t('landing.nav.pricing')],
    ['faq', t('landing.nav.faq')],
  ]
  return (
    <header className="no-select" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
      padding: '18px 28px',
      background: scrolled ? 'rgba(0,0,0,0.7)' : 'transparent',
      backdropFilter: scrolled ? 'blur(18px)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(18px)' : 'none',
      borderBottom: scrolled ? '1px solid var(--hair)' : '1px solid transparent',
      transition:
        'background-color var(--motion-dur-medium) var(--motion-ease-standard), border-color var(--motion-dur-medium) var(--motion-ease-standard), backdrop-filter var(--motion-dur-medium) var(--motion-ease-standard)',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 32 }}>
        <a href="#top" className="mono"
           style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.28em', color: 'rgb(var(--ink))', textDecoration: 'none' }}>
          DRUZ9
        </a>
        <nav className="hidden md:flex" style={{ gap: 24 }}>
          {navItems.map(([id, label]) => (
            <NavLink key={id} href={`#${id}`}>{label}</NavLink>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/login" className="hidden md:inline-flex"
                style={{ fontSize: 13, color: 'var(--ink-60)', textDecoration: 'none' }}>
            {t('landing.nav.login')}
          </Link>
          <Link to="/login" className="hidden md:inline-flex"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 13px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 12.5, fontWeight: 500, textDecoration: 'none' }}>
            {t('landing.nav.start_free')} <Icon name="arrow" size={11} />
          </Link>
          <Link to="/login" className="md:hidden"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 12.5, fontWeight: 500, textDecoration: 'none' }}>
            {t('landing.nav.start_short')} <Icon name="arrow" size={11} />
          </Link>
          <button onClick={() => setOpen((o) => !o)} className="md:hidden"
                  style={{ color: 'rgb(var(--ink))', marginLeft: 4 }}>
            <Icon name={open ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 10 }}>
          {navItems.map(([h, label]) => (
            <a key={h} href={`#${h}`} onClick={() => setOpen(false)}
               style={{ padding: '8px 0', fontSize: 14, color: 'var(--ink-60)', textDecoration: 'none' }}>
              {label}
            </a>
          ))}
          <Link to="/login" onClick={() => setOpen(false)}
                style={{ marginTop: 6, padding: '8px 0', fontSize: 14,
                  color: 'rgb(var(--ink))', textDecoration: 'none',
                  borderTop: '1px solid var(--hair)' }}>
            {t('landing.nav.login')}
          </Link>
        </div>
      )}
    </header>
  )
}
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href}
       className="focus-ring"
       style={{
         fontSize: 13,
         color: 'var(--ink-60)',
         textDecoration: 'none',
         padding: '4px 8px',
         borderRadius: 6,
         transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
       }}
       onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
       onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}>
      {children}
    </a>
  )
}

/* ────────────────────────── Section shell ─────────────────── */
function Section({ id, children, style }: { id?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section id={id} style={{ position: 'relative', padding: '96px 28px', borderTop: '1px solid var(--hair)', ...style }}>
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

/* ────────────────────────── Mock watermark preview ─────────
   Тихая статичная демка main hero-аргумента: «strict mock — без AI,
   честный score; AI mock — отдельной колонкой». Watermark разносит две
   валюты готовности. Live-данных не врём — это illustrative preview, а
   не фейковая статистика. */
function MockWatermarkPreview() {
  const { t } = useTranslation('welcome')
  return (
    <div style={{ maxWidth: 520, margin: '0 auto',
                  border: '1px solid var(--hair)', borderRadius: 14,
                  padding: '18px 22px', background: 'rgba(10,10,10,0.55)',
                  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div className="mono"
           style={{ fontSize: 9.5, letterSpacing: '.22em', color: 'var(--ink-40)',
                    textTransform: 'uppercase', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{t('landing.mock_preview.title')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="red-pulse"
                style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--red)' }} />
          {t('landing.mock_preview.watermark')}
        </span>
      </div>
      <div style={{ marginTop: 16, display: 'grid',
                    gridTemplateColumns: '1fr 1px 1fr', gap: 18, alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em',
                                          color: 'var(--ink-40)' }}>{t('landing.mock_preview.strict_label')}</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 38, fontWeight: 300,
                                          letterSpacing: '-0.03em', lineHeight: 1 }}>78</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 11,
                                          color: 'var(--ink-60)' }}>{t('landing.mock_preview.strict_caption')}</div>
        </div>
        <div style={{ width: 1, height: 60, background: 'var(--hair-2)' }} />
        <div style={{ textAlign: 'left' }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.18em',
                                          color: 'var(--ink-40)' }}>{t('landing.mock_preview.ai_label')}</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 38, fontWeight: 300,
                                          letterSpacing: '-0.03em', lineHeight: 1,
                                          color: 'var(--ink-60)' }}>92</div>
          <div className="mono" style={{ marginTop: 6, fontSize: 11,
                                          color: 'var(--ink-60)' }}>{t('landing.mock_preview.ai_caption')}</div>
        </div>
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-60)',
                    lineHeight: 1.5, textAlign: 'left' }}>
        {t('landing.mock_preview.summary')}
      </div>
    </div>
  )
}

/* ────────────────────────── Hero ──────────────────────────── */
function Hero() {
  const { t } = useTranslation('welcome')
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
          {t('landing.hero.badge')}
        </div>
        <h1 style={{ margin: 0, fontSize: 'clamp(44px, 7vw, 84px)', fontWeight: 400,
                     letterSpacing: '-0.035em', lineHeight: 1.02 }}>
          {t('landing.hero.title_line1')}
          <br />
          <span style={{ color: 'var(--ink-60)' }}>{t('landing.hero.title_line2')}</span>
        </h1>
        <p style={{ margin: '26px auto 0', maxWidth: 580, fontSize: 16,
                    color: 'var(--ink-60)', lineHeight: 1.55 }}>
          {t('landing.hero.subhead')}
        </p>
        <div style={{ marginTop: 36, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/login?next=/mock"
                className="focus-ring motion-press"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none',
                  transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.92)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}>
            {t('landing.hero.cta_run_mock')} <Icon name="arrow" size={12} />
          </Link>
          <a href="#tracks"
             className="focus-ring motion-press"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px',
               borderRadius: 999, border: '1px solid var(--hair-2)', color: 'rgb(var(--ink))',
               fontSize: 13, fontWeight: 500, textDecoration: 'none', background: 'transparent',
               transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)' }}
             onMouseEnter={(e) => {
               e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
               e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)'
             }}
             onMouseLeave={(e) => {
               e.currentTarget.style.background = 'transparent'
               e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
             }}>
            {t('landing.hero.cta_pick_track')}
          </a>
          <Link to="/login?next=/tutor"
                className="focus-ring motion-press"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px',
                  borderRadius: 999, border: '1px solid var(--hair)', color: 'var(--ink-60)',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none', background: 'transparent',
                  transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                  e.currentTarget.style.color = 'rgb(var(--ink))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--ink-60)'
                }}>
            {t('landing.hero.cta_tutor')}
          </Link>
        </div>
        {/* F9 entry — unauth diagnostic CTA. 8 минут → 3 actions + suggested
            goal без логина (localStorage). После diagnostic юзер уже
            «engaged» — конверсия в signup растёт vs cold mock CTA. */}
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
          <Link
            to="/diagnostic"
            className="focus-ring"
            style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              textDecoration: 'none',
              padding: '6px 10px',
              borderRadius: 4,
              transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
          >
            {t('landing.hero.diagnostic_link')}
          </Link>
        </div>
        <div style={{ marginTop: 56 }}>
          <MockWatermarkPreview />
        </div>
        <div className="hero-pill-row"
             style={{ marginTop: 36, display: 'inline-flex', alignItems: 'center',
                      gap: 0, flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%',
                      padding: '6px 8px', border: '1px solid var(--hair)', borderRadius: 999,
                      background: 'rgba(10,10,10,0.6)', backdropFilter: 'blur(12px)' }}>
          <ProductPill name="druz9.online" tag="Mock + Atlas" />
          <span className="hero-pill-sep"
                style={{ width: 1, height: 14, background: 'var(--hair-2)', margin: '0 4px' }} />
          <ProductPill name="Hone" tag="Focus" />
          <span className="hero-pill-sep"
                style={{ width: 1, height: 14, background: 'var(--hair-2)', margin: '0 4px' }} />
          <ProductPill name="Cue" tag="Copilot" />
        </div>
      </div>
      <a href="#ritual" className="mono no-select"
         style={{ position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
           fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)',
           textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {t('landing.hero.scroll')} <Icon name="arrow-dn" size={11} />
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
  const { t } = useTranslation('welcome')
  const beats: { t: string; icon: IconName; title: string; sub: string }[] = [
    { t: '07:00', icon: 'moon-sun', title: t('landing.ritual.beat1_title'), sub: t('landing.ritual.beat1_sub') },
    { t: '13:00', icon: 'shh',      title: t('landing.ritual.beat2_title'), sub: t('landing.ritual.beat2_sub') },
    { t: '18:00', icon: 'arena',    title: t('landing.ritual.beat3_title'), sub: t('landing.ritual.beat3_sub') },
    { t: '22:00', icon: 'pomo',     title: t('landing.ritual.beat4_title'), sub: t('landing.ritual.beat4_sub') },
  ]
  return (
    <Section id="ritual">
      <Eyebrow>{t('landing.ritual.eyebrow')}</Eyebrow>
      <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
                   letterSpacing: '-0.025em', lineHeight: 1.05 }}>
        {t('landing.ritual.title')}
      </h2>
      <p style={{ margin: '18px 0 0', fontSize: 15, color: 'var(--ink-60)', maxWidth: 560, lineHeight: 1.55 }}>
        {t('landing.ritual.subtitle')}
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
        {t('landing.ritual.footer_motto')}
      </div>
    </Section>
  )
}

/* ────────────────────────── Tracks ─────────────────────────── */
// Atlas. Sits between Ritual (day-in-the-life) and product rows so the
// reader sees «один продукт, шесть треков» before the per-app deep-dives.
//
// Tracks parallel the Postgres `track_kind` enum + Section adapter:
// dev / dev_senior / sysanalyst / product_analyst / qa / english.
// Status field reflects current launch state, not a roadmap promise:
// «live» tracks have prompts + Atlas seed shipped; «soon» = on plan but
// requires part-time content expert (sysanalyst, product_analyst — see
// docs/feature/tracks.md §«НЕ запускай сам»).
function Tracks() {
  const { t } = useTranslation('welcome')
  type Status = 'live' | 'soon'
  const tracks: { id: string; title: string; sub: string; tags: string[]; status: Status }[] = [
    {
      id: 'dev',
      title: t('landing.tracks.dev_title'),
      sub: t('landing.tracks.dev_sub'),
      tags: [t('landing.tracks.tag_mock_sessions'), t('landing.tracks.tag_skill_atlas'), t('landing.tracks.tag_ml_platform')],
      status: 'live',
    },
    {
      id: 'dev_senior',
      title: t('landing.tracks.dev_senior_title'),
      sub: t('landing.tracks.dev_senior_sub'),
      tags: [t('landing.tracks.tag_senior_sd_mock'), t('landing.tracks.tag_tech_lead_star'), t('landing.tracks.tag_code_review_soon')],
      status: 'live',
    },
    {
      id: 'ml',
      title: t('landing.tracks.ml_title'),
      sub: t('landing.tracks.ml_sub'),
      tags: [t('landing.tracks.tag_mle_mock'), t('landing.tracks.tag_ml_atlas'), t('landing.tracks.tag_ml_coach')],
      status: 'live',
    },
    {
      id: 'english',
      title: t('landing.tracks.english_title'),
      sub: t('landing.tracks.english_sub'),
      tags: [t('landing.tracks.tag_hr_mock'), t('landing.tracks.tag_reading_writing_hone'), t('landing.tracks.tag_srs')],
      status: 'live',
    },
    {
      id: 'sysanalyst',
      title: t('landing.tracks.sysanalyst_title'),
      sub: t('landing.tracks.sysanalyst_sub'),
      tags: [t('landing.tracks.tag_free_form_mock'), t('landing.tracks.tag_atlas_6'), t('landing.tracks.tag_live')],
      status: 'live',
    },
    {
      id: 'product_analyst',
      title: t('landing.tracks.product_analyst_title'),
      sub: t('landing.tracks.product_analyst_sub'),
      tags: [t('landing.tracks.tag_free_form_mock'), t('landing.tracks.tag_atlas_6'), t('landing.tracks.tag_live')],
      status: 'live',
    },
    {
      id: 'qa',
      title: t('landing.tracks.qa_title'),
      sub: t('landing.tracks.qa_sub'),
      tags: [t('landing.tracks.tag_free_form_mock'), t('landing.tracks.tag_atlas_7'), t('landing.tracks.tag_live')],
      status: 'live',
    },
    {
      id: 'devops',
      title: t('landing.tracks.devops_title'),
      sub: t('landing.tracks.devops_sub'),
      tags: [t('landing.tracks.tag_free_form_mock'), t('landing.tracks.tag_atlas_7'), t('landing.tracks.tag_live')],
      status: 'live',
    },
  ]
  return (
    <Section id="tracks">
      <Eyebrow>{t('landing.tracks.eyebrow')}</Eyebrow>
      <h2 style={{
        margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
        letterSpacing: '-0.025em', lineHeight: 1.05,
      }}>
        {t('landing.tracks.title_line1')}<br />{t('landing.tracks.title_line2')}
      </h2>
      <p style={{ margin: '18px 0 0', fontSize: 15, color: 'var(--ink-60)', maxWidth: 620, lineHeight: 1.55 }}>
        {t('landing.tracks.subtitle')}
      </p>
      <div className="md-grid stagger"
           style={{ marginTop: 60, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {tracks.map((t) => (
          <div key={t.id}
               style={{
                 padding: '20px 18px 18px',
                 border: '1px solid var(--hair-2)',
                 borderRadius: 14,
                 background: '#000',
                 position: 'relative',
                 opacity: t.status === 'soon' ? 0.62 : 1,
               }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)' }}>
                {t.id.toUpperCase()}
              </span>
              <StatusPill status={t.status} />
            </div>
            <div style={{ fontSize: 19, letterSpacing: '-0.01em', marginBottom: 8 }}>{t.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.5, marginBottom: 14 }}>
              {t.sub}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {t.tags.map((tag) => (
                <span key={tag} className="mono"
                      style={{
                        fontSize: 10, letterSpacing: '.12em', padding: '4px 8px',
                        borderRadius: 999, border: '1px solid var(--hair-2)',
                        color: 'var(--ink-60)',
                      }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mono"
           style={{ marginTop: 60, fontSize: 12, color: 'var(--ink-40)', letterSpacing: '.12em', textAlign: 'center' }}>
        {t('landing.tracks.footer_motto')}
      </div>
    </Section>
  )
}

function StatusPill({ status }: { status: 'live' | 'soon' }) {
  if (status === 'live') {
    return (
      <span className="mono" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 9, letterSpacing: '.18em', padding: '3px 7px',
        borderRadius: 999, border: '1px solid var(--hair-2)', color: 'var(--ink-60)',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: 99, background: '#fff' }} />
        LIVE
      </span>
    )
  }
  return (
    <span className="mono" style={{
      fontSize: 9, letterSpacing: '.18em', padding: '3px 7px',
      borderRadius: 999, border: '1px solid var(--hair-2)', color: 'var(--ink-40)',
    }}>
      SOON
    </span>
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


/* ────────────────────────── Insights ──────────────────────── */
// The single ecosystem moat — analytics layer over web + Hone + Cue.
// Sits between product rows and Pricing so the reader sees «зачем три»
// before paying.
function Insights() {
  const { t } = useTranslation('welcome')
  return (
    <Section id="insights">
      <Eyebrow>{t('landing.insights.eyebrow')}</Eyebrow>
      <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
                   letterSpacing: '-0.025em', lineHeight: 1.05 }}>
        {t('landing.insights.title_line1')}<br />{t('landing.insights.title_line2')}
      </h2>
      <p style={{ margin: '18px 0 0', fontSize: 15, color: 'var(--ink-60)', maxWidth: 560, lineHeight: 1.55 }}>
        {t('landing.insights.subtitle')}
      </p>
      <div className="md-grid stagger"
           style={{ marginTop: 56, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <InsightCard
          eyebrow="WEEKLY DIGEST"
          metric="14h"
          delta={t('landing.insights.card1_delta')}
          note={t('landing.insights.card1_note')}
        />
        <InsightCard
          eyebrow="MOCK · STRICT 2 / 3"
          metric="78"
          delta={t('landing.insights.card2_delta')}
          note={t('landing.insights.card2_note')}
        />
        <InsightCard
          eyebrow="READINESS · SD"
          metric="62"
          delta={t('landing.insights.card3_delta')}
          note={t('landing.insights.card3_note')}
        />
      </div>
      <div className="mono"
           style={{ marginTop: 56, fontSize: 12, color: 'var(--ink-40)',
             letterSpacing: '.12em', textAlign: 'center' }}>
        {t('landing.insights.footer_motto')}
      </div>
    </Section>
  )
}
function InsightCard({ eyebrow, metric, delta, note }: {
  eyebrow: string; metric: string; delta: string; note: string
}) {
  return (
    <div style={{
      padding: '24px 22px 22px',
      border: '1px solid var(--hair-2)',
      borderRadius: 14,
      background: '#000',
    }}>
      <div className="mono"
           style={{ fontSize: 9.5, letterSpacing: '.22em', color: 'var(--ink-40)',
             textTransform: 'uppercase' }}>
        {eyebrow}
      </div>
      <div className="mono"
           style={{ marginTop: 14, fontSize: 44, fontWeight: 300,
             letterSpacing: '-0.03em', lineHeight: 1 }}>
        {metric}
      </div>
      <div className="mono"
           style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-60)',
             letterSpacing: '.06em' }}>
        {delta}
      </div>
      <div style={{ marginTop: 18, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
        {note}
      </div>
    </div>
  )
}

/* ────────────────────────── Pricing ───────────────────────── */
function Pricing() {
  const { t } = useTranslation('welcome')
  return (
    <Section id="pricing">
      <Eyebrow>{t('landing.pricing.eyebrow')}</Eyebrow>
      <h2 style={{ margin: '16px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 400,
                   letterSpacing: '-0.025em', lineHeight: 1.05 }}>
        {t('landing.pricing.title_line1')}<br />{t('landing.pricing.title_line2')}
      </h2>
      <div className="md-grid"
           style={{ marginTop: 60, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <PlanCard
          name="Free" price="0 ₽" tag={t('landing.pricing.free_tag')}
          features={[
            t('landing.pricing.free_feat1'),
            t('landing.pricing.free_feat2'),
            t('landing.pricing.free_feat3'),
            t('landing.pricing.free_feat4'),
          ]}
          cta={t('landing.pricing.free_cta')}
        />
        <PlanCard
          featured
          name="druz9 Pro" price="990 ₽" priceSuffix={t('landing.pricing.pro_period')} tag={t('landing.pricing.pro_tag')}
          features={[
            t('landing.pricing.pro_feat1'),
            t('landing.pricing.pro_feat2'),
            t('landing.pricing.pro_feat3'),
            t('landing.pricing.pro_feat4'),
            t('landing.pricing.pro_feat5'),
            t('landing.pricing.pro_feat6'),
          ]}
          cta={t('landing.pricing.pro_cta')}
        />
      </div>
      <p style={{ marginTop: 28, fontSize: 12.5, color: 'var(--ink-40)', textAlign: 'center' }}>
        {t('landing.pricing.footnote')}
      </p>
    </Section>
  )
}
function PlanCard({ name, price, priceSuffix, tag, features, cta, featured }: {
  name: string; price: string; priceSuffix?: string; tag: string;
  features: string[]; cta: string; featured?: boolean
}) {
  const { t } = useTranslation('welcome')
  return (
    <div style={{ position: 'relative', padding: '32px 32px 28px', borderRadius: 16,
      border: `1px solid ${featured ? 'rgba(255,255,255,0.2)' : 'var(--hair)'}`,
      background: featured ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
      {featured && (
        <div className="mono"
             style={{ position: 'absolute', top: -10, right: 24,
               display: 'inline-flex', alignItems: 'center', gap: 6,
               padding: '3px 10px', borderRadius: 999,
               fontSize: 9.5, letterSpacing: '.2em',
               background: '#000', border: '1px solid var(--hair-2)',
               color: 'rgb(var(--ink))' }}>
          <span className="red-pulse"
                style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--red)' }} />
          {t('landing.pricing.recommended')}
        </div>
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
  const { t } = useTranslation('welcome')
  const [open, setOpen] = useState(0)
  const items = [
    { q: t('landing.faq.q1_q'), a: t('landing.faq.q1_a') },
    { q: t('landing.faq.q2_q'), a: t('landing.faq.q2_a') },
    { q: t('landing.faq.q3_q'), a: t('landing.faq.q3_a') },
    { q: t('landing.faq.q4_q'), a: t('landing.faq.q4_a') },
    { q: t('landing.faq.q5_q'), a: t('landing.faq.q5_a') },
    { q: t('landing.faq.q6_q'), a: t('landing.faq.q6_a') },
    { q: t('landing.faq.q7_q'), a: t('landing.faq.q7_a') },
    { q: t('landing.faq.q8_q'), a: t('landing.faq.q8_a') },
    { q: t('landing.faq.q9_q'), a: t('landing.faq.q9_a') },
  ]
  return (
    <Section id="faq">
      <Eyebrow>{t('landing.faq.eyebrow')}</Eyebrow>
      <h2 style={{ margin: '16px 0 44px', fontSize: 'clamp(30px, 4.2vw, 48px)', fontWeight: 400,
                   letterSpacing: '-0.02em', lineHeight: 1.05 }}>
        {t('landing.faq.title')}
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
  const { t } = useTranslation('welcome')
  return (
    <footer style={{ borderTop: '1px solid var(--hair)', padding: '48px 28px 60px' }}>
      <div className="md-grid"
           style={{ maxWidth: 1200, margin: '0 auto', display: 'grid',
             gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'flex-end' }}>
        <div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.28em' }}>DRUZ9</div>
          <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <FooterLink href="#arena">druz9.online</FooterLink>
            <FooterLink href="#hone">Hone</FooterLink>
            <FooterLink href="#cue">Cue</FooterLink>
            <FooterLink href="#pricing">{t('landing.footer.links_pricing')}</FooterLink>
            <FooterLink href="/insights" router>Insights</FooterLink>
            <FooterLink href="/help" router>{t('landing.footer.links_help')}</FooterLink>
            <FooterLink href="/legal/terms" router>{t('landing.footer.links_terms')}</FooterLink>
            <FooterLink href="/legal/privacy" router>{t('landing.footer.links_privacy')}</FooterLink>
            <FooterLink href="https://github.com/dobriygolang/druzya">GitHub</FooterLink>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <a href="https://t.me/druz9" target="_blank" rel="noopener noreferrer"
             style={{ fontSize: 13, color: 'var(--ink-90)', textDecoration: 'none' }}>
            t.me/druz9
          </a>
          <div className="mono"
               style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)', letterSpacing: '.14em' }}>
            {t('landing.footer.made_in')} {new Date().getFullYear()}
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
type ExpandedDemo = 'hone' | 'cue' | 'watermark' | null

export default function WelcomePage() {
  const { t } = useTranslation('welcome')
  const [expanded, setExpanded] = useState<ExpandedDemo>(null)

  // body must lose .v2 here — landing wants pure black, not the v2 token bg.
  useEffect(() => {
    const had = document.body.classList.contains('v2')
    document.body.classList.remove('v2')
    document.body.style.background = '#000'
    document.body.style.color = '#fff'
    document.body.style.overflowX = 'hidden'
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => {
      if (had) document.body.classList.add('v2')
      document.body.style.background = ''
      document.body.style.color = ''
      document.body.style.overflowX = ''
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
      <Tracks />

      <ProductRow
        id="atlas" sideLeft
        name="druz9.online" tag={t('landing.products.atlas_tag')}
        title={t('landing.products.atlas_title')}
        desc={t('landing.products.atlas_desc')}
        bullets={[
          t('landing.products.atlas_bullet1'),
          t('landing.products.atlas_bullet2'),
          t('landing.products.atlas_bullet3'),
          t('landing.products.atlas_bullet4'),
        ]}
        cta={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to="/login?next=/mock"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                    borderRadius: 999, background: '#fff', color: '#000',
                    fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
              {t('landing.products.atlas_cta_mock')} <Icon name="arrow" size={12} />
            </Link>
            <Link to="/atlas"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                    borderRadius: 999, border: '1px solid var(--hair-2)', color: 'rgb(var(--ink))',
                    fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
              {t('landing.products.atlas_cta_atlas')}
            </Link>
          </div>
        }
        mock={<MockWatermarkDemo onExpand={() => setExpanded('watermark')} />}
      />

      <ProductRow
        id="hone" sideLeft={false}
        name="Hone" tag={t('landing.products.hone_tag')}
        title={t('landing.products.hone_title')}
        desc={t('landing.products.hone_desc')}
        bullets={[
          t('landing.products.hone_bullet1'),
          t('landing.products.hone_bullet2'),
          t('landing.products.hone_bullet3'),
          t('landing.products.hone_bullet4'),
        ]}
        cta={
          <Link to="/login?next=/profile"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                  borderRadius: 999, background: '#fff', color: '#000',
                  fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
            <Icon name="apple" size={14} /> {t('landing.products.hone_cta_download')}
          </Link>
        }
        mock={<HoneDemo onExpand={() => setExpanded('hone')} />}
      />

      <ProductRow
        id="cue" sideLeft
        name="Cue" tag={t('landing.products.cue_tag')}
        title={t('landing.products.cue_title')}
        desc={t('landing.products.cue_desc')}
        bullets={[
          t('landing.products.cue_bullet1'),
          t('landing.products.cue_bullet2'),
          t('landing.products.cue_bullet3'),
          t('landing.products.cue_bullet4'),
        ]}
        cta={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to="/pricing"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '11px 18px',
                    borderRadius: 999, background: '#fff', color: '#000',
                    fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
              <Icon name="apple" size={14} /> {t('landing.products.cue_cta_download')}
            </Link>
            <span className="mono"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 999,
                    border: '1px solid var(--hair-2)',
                    background: 'transparent',
                    fontSize: 11, color: 'var(--ink-60)' }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: '#fff' }} />
              {t('landing.products.cue_tested')}
            </span>
          </div>
        }
        mock={<CueDemo onExpand={() => setExpanded('cue')} />}
      />

      <Insights />
      <Pricing />
      <FAQ />
      <Footer />

      <DemoModal
        open={expanded === 'hone'}
        onClose={() => setExpanded(null)}
        title="HONE · DAILY COCKPIT"
      >
        <div style={{ aspectRatio: '4/3', maxHeight: '70vh' }}>
          <HoneDemo />
        </div>
      </DemoModal>
      <DemoModal
        open={expanded === 'cue'}
        onClose={() => setExpanded(null)}
        title="CUE · STEALTH COPILOT"
      >
        <div style={{ aspectRatio: '4/3', maxHeight: '70vh' }}>
          <CueDemo />
        </div>
      </DemoModal>
      <DemoModal
        open={expanded === 'watermark'}
        onClose={() => setExpanded(null)}
        title="DRUZ9.ONLINE · MOCK · WATERMARK"
      >
        <div style={{ aspectRatio: '4/3', maxHeight: '70vh' }}>
          <MockWatermarkDemo />
        </div>
      </DemoModal>
    </div>
  )
}
