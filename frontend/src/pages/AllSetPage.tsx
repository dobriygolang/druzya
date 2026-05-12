// AllSet — celebratory exit screen after onboarding.
//
// 2026-05-12: v2 visual language — hairline logo box, hairline reward
// cards, ghost CTA pills, display-family h1 with v2 weight (600 lighter
// than legacy 800/extrabold). Confetti unchanged — already b/w + #FF3B30.

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Check, Sparkles, Map as MapIcon, MessageSquare, ArrowRight } from 'lucide-react'

import { InstallHoneCTA } from '../components/InstallHoneCTA'

// Inline minimal top-bar — celebratory exit screen, just logo + hairline.
function AllSetTopBar() {
  return (
    <header
      className="flex items-center px-4 sm:px-8 lg:px-20"
      style={{ height: 64, borderBottom: '1px solid var(--hair)' }}
    >
      <Link to="/welcome" className="flex items-center gap-2.5 focus-ring">
        <span
          className="grid place-items-center"
          style={{
            width: 28,
            height: 28,
            border: '1px solid var(--hair-2)',
            borderRadius: 8,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontWeight: 600,
            fontSize: 14,
            color: 'rgb(var(--ink))',
          }}
        >
          9
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.005em',
            color: 'rgb(var(--ink))',
          }}
        >
          druz9
        </span>
      </Link>
    </header>
  )
}

function Confetti() {
  // B/W only — single #FF3B30 spark for the Hone-red signal accent.
  const pieces = [
    { top: -20, left: -40, color: '#FFFFFF', rot: 12 },
    { top: 30, left: -70, color: 'rgba(255,255,255,0.6)', rot: -18 },
    { top: 140, left: -50, color: '#FFFFFF', rot: 30 },
    { top: -10, left: 180, color: '#FF3B30', rot: -10 },
    { top: 60, left: 200, color: 'rgba(255,255,255,0.4)', rot: 22 },
    { top: 150, left: 180, color: '#FFFFFF', rot: -25 },
  ]
  return (
    <>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute block"
          style={{
            top: p.top,
            left: p.left,
            width: 14,
            height: 18,
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
          }}
        />
      ))}
    </>
  )
}

function RewardCard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        width: 220,
        maxWidth: '100%',
        padding: '20px 18px',
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        background: 'transparent',
        gap: 10,
      }}
    >
      <span
        className="grid place-items-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          border: '1px solid var(--hair-2)',
          color: 'rgb(var(--ink))',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          fontSize: 'var(--type-h3-size)',
          lineHeight: 'var(--type-h3-lh)',
          letterSpacing: 'var(--type-h3-ls)',
          fontWeight: 'var(--type-h3-weight)',
          color: 'rgb(var(--ink))',
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-60)' }}>{sub}</span>
    </div>
  )
}

const ghostPill: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid var(--hair-2)',
  borderRadius: 999,
  background: 'transparent',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink-60)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
}

export default function AllSetPage() {
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  return (
    <div className="min-h-screen text-text-primary" style={{ background: 'rgb(var(--color-bg))' }}>
      <AllSetTopBar />
      <main
        className="flex flex-col items-center justify-center px-4 py-8 sm:px-8 lg:px-16 lg:py-14"
        style={{ gap: 32 }}
      >
        <div className="relative">
          <Confetti />
          <div
            className="grid place-items-center"
            style={{
              width: 160,
              height: 160,
              borderRadius: 80,
              background: 'rgb(var(--ink))',
              boxShadow: '0 8px 40px rgba(255,255,255,0.12)',
            }}
          >
            <Check style={{ width: 80, height: 80, color: '#000', strokeWidth: 3 }} />
          </div>
        </div>

        <h1
          className="text-center"
          style={{
            margin: 0,
            fontSize: 'clamp(40px, 6vw, 64px)',
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            fontWeight: 600,
            color: 'rgb(var(--ink))',
          }}
        >
          Готово!
        </h1>
        <p
          className="text-center"
          style={{
            margin: 0,
            maxWidth: 640,
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-lh)',
            color: 'var(--ink-60)',
          }}
        >
          Трек выбран, Atlas построен. Дальше — первый mock и AI-coach с памятью.
        </p>

        <div className="flex flex-wrap-row" style={{ gap: 12, justifyContent: 'center' }}>
          <RewardCard
            icon={<Sparkles style={{ width: 22, height: 22 }} />}
            title="Mock unlocked"
            sub="Strict + AI-режимы доступны"
          />
          <RewardCard
            icon={<MapIcon style={{ width: 22, height: 22 }} />}
            title="Skill Atlas"
            sub="Карта прогресса по треку"
          />
          <RewardCard
            icon={<MessageSquare style={{ width: 22, height: 22 }} />}
            title="AI-coach"
            sub="Помнит твой контекст"
          />
        </div>

        <div
          className="flex-wrap-row"
          style={{
            width: '100%',
            maxWidth: 700,
            padding: '20px 24px',
            border: '1px solid var(--hair-2)',
            borderRadius: 'var(--radius-outer)',
            background: 'transparent',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div className="flex flex-col" style={{ minWidth: 0, gap: 6 }}>
            <span
              style={{
                fontSize: 'var(--type-h3-size)',
                lineHeight: 'var(--type-h3-lh)',
                letterSpacing: 'var(--type-h3-ls)',
                fontWeight: 'var(--type-h3-weight)',
                color: 'rgb(var(--ink))',
              }}
            >
              Запусти первый mock
            </span>
            <span style={{ fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
              Strict-режим без AI с watermark — честная оценка готовности за 25 минут
            </span>
          </div>
          <Link
            to="/mock"
            className="focus-ring motion-press"
            style={{
              padding: '10px 22px',
              background: 'rgb(var(--ink))',
              color: 'rgb(var(--color-bg))',
              border: 0,
              borderRadius: 'var(--radius-inner)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              flex: '0 0 auto',
              transition:
                'background-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
            }}
          >
            Запустить <ArrowRight style={{ width: 16, height: 16 }} />
          </Link>
        </div>

        {/*
          Phase J / X1 (P0) — single onboarding funnel. After web signup
          we offer Hone as the next step (daily focus cockpit). Dismissible;
          localStorage flag prevents nagging on re-visits.
        */}
        <InstallHoneCTA />

        <div className="flex flex-wrap-row" style={{ gap: 10, justifyContent: 'center' }}>
          <Link
            to="/atlas"
            className="focus-ring motion-press"
            style={ghostPill}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            Открыть Atlas
          </Link>
          <Link
            to="/tutor"
            className="focus-ring motion-press"
            style={ghostPill}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            Поговорить с coach
          </Link>
          <Link
            to="/codex"
            className="focus-ring motion-press"
            style={ghostPill}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            Прочитать Codex
          </Link>
        </div>
      </main>
    </div>
  )
}
