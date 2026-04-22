// Text-to-Speech: browser SpeechSynthesis (free) + premium proxy fallback.
//
// `voice: 'browser'` runs entirely in the browser via window.speechSynthesis.
// `voice: 'premium-*'` POSTs to /api/v1/voice/tts and plays the returned MP3.
// On 402 (Payment Required) we fall back to the browser voice with a console
// warning so the UX never silently breaks.

import { API_BASE } from '../apiClient'

export type TTSVoice = 'browser' | 'premium-male' | 'premium-female'

export interface TTSOptions {
  voice?: TTSVoice
  lang?: 'ru-RU' | 'en-US'
  rate?: number
  pitch?: number
}

let currentAudio: HTMLAudioElement | null = null
let currentObjectURL: string | null = null

export function isPremiumTTSAvailable(userTier: string): boolean {
  return userTier === 'premium' || userTier === 'pro'
}

function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? []
  if (!voices.length) return null
  const exact = voices.find((v) => v.lang === lang)
  if (exact) return exact
  const prefix = lang.split('-')[0]
  const partial = voices.find((v) => v.lang.toLowerCase().startsWith(prefix.toLowerCase()))
  return partial ?? voices[0] ?? null
}

function speakBrowser(text: string, opts: TTSOptions): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    // If voices not loaded yet, wait briefly for them.
    const trySpeak = () => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = opts.lang ?? 'ru-RU'
      u.rate = opts.rate ?? 1
      u.pitch = opts.pitch ?? 1
      const voice = pickBrowserVoice(u.lang)
      if (voice) u.voice = voice
      u.onend = () => resolve()
      u.onerror = () => resolve()
      synth.speak(u)
    }
    if ((synth.getVoices?.() ?? []).length > 0) {
      trySpeak()
    } else {
      const onVoices = () => {
        synth.removeEventListener?.('voiceschanged', onVoices)
        trySpeak()
      }
      synth.addEventListener?.('voiceschanged', onVoices)
      // Safari sometimes never fires voiceschanged — give it a 300ms grace.
      setTimeout(trySpeak, 300)
    }
  })
}

async function speakPremium(text: string, opts: TTSOptions): Promise<void> {
  const token = (() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem('druz9_access_token') : null
    } catch {
      return null
    }
  })()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/voice/tts`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      text,
      voice: opts.voice,
      lang: opts.lang ?? 'ru-RU',
    }),
  })
  if (res.status === 402) {
    console.warn('[tts] premium voice gated (402) — falling back to browser')
    await speakBrowser(text, { ...opts, voice: 'browser' })
    return
  }
  if (res.status === 501) {
    console.warn('[tts] premium voice backend stub (501) — falling back to browser')
    await speakBrowser(text, { ...opts, voice: 'browser' })
    return
  }
  if (!res.ok) {
    console.warn('[tts] premium failed', res.status, '— falling back to browser')
    await speakBrowser(text, { ...opts, voice: 'browser' })
    return
  }
  const blob = await res.blob()
  cancel()
  const url = URL.createObjectURL(blob)
  currentObjectURL = url
  const audio = new Audio(url)
  currentAudio = audio
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    void audio.play().catch(() => resolve())
  })
  if (currentObjectURL === url) {
    URL.revokeObjectURL(url)
    currentObjectURL = null
    currentAudio = null
  }
}

export async function speak(text: string, opts: TTSOptions = {}): Promise<void> {
  const voice = opts.voice ?? 'browser'
  cancel()
  if (voice === 'browser') {
    await speakBrowser(text, opts)
  } else {
    await speakPremium(text, opts)
  }
}

export function cancel(): void {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  } catch {
    /* noop */
  }
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      /* noop */
    }
    currentAudio = null
  }
  if (currentObjectURL) {
    try {
      URL.revokeObjectURL(currentObjectURL)
    } catch {
      /* noop */
    }
    currentObjectURL = null
  }
}
