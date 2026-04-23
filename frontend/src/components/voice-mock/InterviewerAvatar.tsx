// InterviewerAvatar — generative geometric AI persona, NOT cartoon.
//
// Three personas, three shapes, three colour signatures (per voice-mock spec):
//   friendly → warm circle (pink)
//   strict   → sharp triangle (cyan)
//   neutral  → balanced hexagon (accent)
//
// `speaking` enables a pulse halo so the avatar reads as «alive» during AI
// reply. We avoid the «cute SaaS-onboarding illustration» anti-pattern from
// _rules.md by keeping geometry abstract and brand-tinted.
import { motion, useReducedMotion } from 'framer-motion'

export type InterviewerPersona = 'friendly' | 'strict' | 'neutral'

const PERSONA_LABEL: Record<InterviewerPersona, string> = {
  friendly: 'Дружелюбный',
  strict: 'Строгий',
  neutral: 'Нейтральный',
}

const PERSONA_HINT: Record<InterviewerPersona, string> = {
  friendly: 'Поддерживает, мягко наводит',
  strict: 'Жёсткие follow-ups, не прощает воды',
  neutral: 'Сбалансированный темп, без эмоций',
}

const PERSONA_COLOR: Record<InterviewerPersona, string> = {
  friendly: 'rgb(244 114 182)', // pink
  strict: 'rgb(34 211 238)', // cyan
  neutral: 'rgb(88 44 255)', // accent
}

interface Props {
  persona: InterviewerPersona
  size?: number
  speaking?: boolean
  /** Slight rotation idle to add «breathing» */
  idleSpin?: boolean
}

export function InterviewerAvatar({ persona, size = 224, speaking = false, idleSpin = true }: Props) {
  const reduced = useReducedMotion()
  const color = PERSONA_COLOR[persona]
  const halo = speaking && !reduced
  const r = size / 2

  // Inner shape per persona — render as SVG so the geometry is crisp at any size.
  // Coordinates use a 0..200 viewport so we can scale uniformly.
  const ShapeNode = () => {
    if (persona === 'friendly') {
      // Warm circle: 3 concentric arcs — outer ring, mid ring, solid centre dot
      return (
        <g>
          <circle cx={100} cy={100} r={88} stroke={color} strokeWidth={2} fill="none" opacity={0.4} />
          <circle cx={100} cy={100} r={64} stroke={color} strokeWidth={2} fill="none" opacity={0.7} />
          <circle cx={100} cy={100} r={40} fill={color} opacity={0.9} />
          <circle cx={100} cy={100} r={20} fill="rgb(10 10 15)" />
        </g>
      )
    }
    if (persona === 'strict') {
      // Sharp triangle: equilateral pointing up + inner inverted triangle (tension)
      return (
        <g>
          <polygon points="100,20 180,160 20,160" stroke={color} strokeWidth={2.5} fill="none" />
          <polygon points="100,140 60,60 140,60" fill={color} opacity={0.85} />
          <circle cx={100} cy={108} r={10} fill="rgb(10 10 15)" />
        </g>
      )
    }
    // neutral: balanced hexagon
    return (
      <g>
        <polygon
          points="100,18 174,60 174,140 100,182 26,140 26,60"
          stroke={color}
          strokeWidth={2.5}
          fill="none"
          opacity={0.5}
        />
        <polygon
          points="100,52 144,76 144,124 100,148 56,124 56,76"
          fill={color}
          opacity={0.85}
        />
        <circle cx={100} cy={100} r={14} fill="rgb(10 10 15)" />
      </g>
    )
  }

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      {/* Halo pulses ONLY when speaking — keeps signal honest. */}
      {halo && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full"
            style={{ background: color, filter: 'blur(28px)', opacity: 0.35 }}
            animate={{ scale: [1, 1.1, 1], opacity: [0.25, 0.45, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="absolute rounded-full"
            style={{ width: size * 1.04, height: size * 1.04, border: `1px solid ${color}` }}
            animate={{ scale: [1, 1.08, 1], opacity: [0.7, 0.2, 0.7] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      )}
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        className="relative"
        animate={idleSpin && !reduced ? { rotate: persona === 'friendly' ? 360 : persona === 'strict' ? 0 : 360 } : undefined}
        transition={idleSpin && !reduced ? { duration: persona === 'neutral' ? 60 : 90, repeat: Infinity, ease: 'linear' } : undefined}
        aria-label={`${PERSONA_LABEL[persona]} interviewer avatar`}
      >
        <defs>
          <radialGradient id={`int-bg-${persona}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={100} cy={100} r={r * (200 / size)} fill={`url(#int-bg-${persona})`} />
        <ShapeNode />
      </motion.svg>
    </div>
  )
}

export const PERSONA_META: Record<InterviewerPersona, { label: string; hint: string; color: string }> = {
  friendly: { label: PERSONA_LABEL.friendly, hint: PERSONA_HINT.friendly, color: PERSONA_COLOR.friendly },
  strict: { label: PERSONA_LABEL.strict, hint: PERSONA_HINT.strict, color: PERSONA_COLOR.strict },
  neutral: { label: PERSONA_LABEL.neutral, hint: PERSONA_HINT.neutral, color: PERSONA_COLOR.neutral },
}
