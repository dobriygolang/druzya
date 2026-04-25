// ConfettiBurst — canvas-based particle burst, no library
// (Wave-10, design-review v4 shared component #2).
//
// Why we wrote our own vs canvas-confetti / react-confetti: bundle size.
// Both libs ship 12-30kb gzipped of physics + presets we don't need.
// Our 60-particle hand-rolled version is ~1kb when minified, with the
// same emotional payoff for the win-promote moment.
//
// API: pass `trigger=true` once when you want a burst. Component
// internally captures the rising edge and runs ONE burst; toggling
// trigger off-on later fires another burst.

import { useEffect, useRef } from 'react'

// Phase-1: monochrome confetti — white particles + the single accent red.
// Confetti itself is on the chopping block in Phase 3 (RPG-effect, doesn't
// fit "quiet ecosystem"), but neutralizing the palette here first stops
// the rainbow regression in the meantime.
const COLORS = ['#FFFFFF', '#D9D9D9', '#FF3B30', '#8C8C8C']

export type ConfettiBurstProps = {
  /** Set to true to fire a burst. Toggling false→true fires again. */
  trigger: boolean
  /** Particle count. 60 is the design-default; reduce to 30 on mobile if needed. */
  count?: number
  /** Total animation length in ms. */
  duration?: number
}

export function ConfettiBurst({ trigger, count = 60, duration = 2600 }: ConfettiBurstProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!trigger || !ref.current) return
    const c = ref.current
    const ctx = c.getContext('2d')
    if (!ctx) return
    // Match the device pixel ratio so confetti is crisp on Retina/4K.
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    ctx.scale(dpr, dpr)
    const W = c.clientWidth
    const H = c.clientHeight
    const particles = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 40,
      y: H / 3 + (Math.random() - 0.5) * 20,
      vx: (Math.random() - 0.5) * 8,
      vy: -6 - Math.random() * 6,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 4 + Math.random() * 4,
    }))
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const dt = 1 / 60
      ctx.clearRect(0, 0, W, H)
      const life = (t - t0) / duration
      for (const p of particles) {
        p.vy += 22 * dt // gravity
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        ctx.save()
        ctx.globalAlpha = Math.max(0, 1 - life)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size * 0.8, p.size, p.size * 1.6)
        ctx.restore()
      }
      if (life < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [trigger, count, duration])

  return <canvas ref={ref} className="absolute inset-0 pointer-events-none w-full h-full" aria-hidden="true" />
}
