// SoundHook — placeholder hook-point for emotion-peak sound cues
// (Wave-10, design-review v4 shared component #5).
//
// Three planned cues, files to be added later under /public/sounds/:
//   tier-up.wav  — chime, ≤400ms, used on win+promote rank-up reveal
//   xp-tick.wav  — subtle tick, ≤80ms, fired per integer step in EloRing
//   loss.wav     — soft single tone, ≤500ms; minor key NOT allowed
//                  (we don't want to amplify negative emotion)
//
// API: <SoundHook cue="tier-up" when={someCondition} /> — fires once
// when `when` flips false→true. Pass `interval` to repeat (used for
// xp-tick during EloRing tween).
//
// Currently a noop with dev-mode console.info so we can verify trigger
// timing during build. When audio files land, uncomment the Audio() line.

import { useEffect, useRef } from 'react'

export type SoundCue = 'tier-up' | 'xp-tick' | 'loss'

const SOURCES: Record<SoundCue, string> = {
  'tier-up': '/sounds/tier-up.wav',
  'xp-tick': '/sounds/xp-tick.wav',
  loss: '/sounds/loss.wav',
}

export type SoundHookProps = {
  cue: SoundCue
  /** Rising-edge trigger — sound fires once when this flips false→true. */
  when: boolean
  /** Set to repeat playback every N ms while `when` stays true. */
  interval?: number
}

export function SoundHook({ cue, when, interval }: SoundHookProps) {
  const fired = useRef(false)
  useEffect(() => {
    if (!when) {
      fired.current = false
      return
    }
    const play = () => {
      // TODO(audio): when /public/sounds/*.wav land, replace the dev-log
      // line below with the commented Audio() construct. Volume 0.6 keeps
      // it well below voice/system sounds.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info('[sound]', cue, SOURCES[cue])
      }
      // const a = new Audio(SOURCES[cue]); a.volume = 0.6; a.play().catch(() => {})
    }
    if (interval) {
      const id = window.setInterval(play, interval)
      return () => window.clearInterval(id)
    }
    if (!fired.current) {
      fired.current = true
      play()
    }
  }, [cue, when, interval])
  return null
}
