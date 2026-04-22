// Speech-to-Text via the Web Speech API (browser-native, $0 cost).
//
// Wraps webkitSpeechRecognition || SpeechRecognition with auto-restart for
// `continuous` mode (browsers silently close the recognizer after ~60s of
// silence; we resurrect it transparently).

export type STTState = 'idle' | 'listening' | 'finalizing' | 'error'

export interface STTOptions {
  lang?: 'ru-RU' | 'en-US'
  continuous?: boolean
  onInterim?(text: string): void
  onFinal?(text: string): void
  onError?(err: string): void
  onStateChange?(state: STTState): void
}

export interface STTHandle {
  start(): void
  stop(): void
  abort(): void
  state: STTState
}

// Minimal shape to avoid pulling DOM types we may not have.
interface SRResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SREventLike {
  resultIndex: number
  results: ArrayLike<SRResultLike>
}
interface SRErrorEventLike {
  error: string
}
interface SRInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SREventLike) => void) | null
  onerror: ((e: SRErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function getCtor(): (new () => SRInstance) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition as new () => SRInstance) ??
    (w.webkitSpeechRecognition as new () => SRInstance) ?? null
}

export function isSTTSupported(): boolean {
  return getCtor() !== null
}

export function createSTT(opts: STTOptions): STTHandle {
  const Ctor = getCtor()
  const lang = opts.lang ?? 'ru-RU'
  const continuous = opts.continuous ?? true

  let rec: SRInstance | null = null
  let userWantsRunning = false
  let state: STTState = 'idle'

  const setState = (s: STTState) => {
    state = s
    handle.state = s
    opts.onStateChange?.(s)
  }

  const build = (): SRInstance | null => {
    if (!Ctor) return null
    const r = new Ctor()
    r.lang = lang
    r.continuous = continuous
    r.interimResults = true
    r.onstart = () => setState('listening')
    r.onresult = (e: SREventLike) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const txt = res[0]?.transcript ?? ''
        if (res.isFinal) final += txt
        else interim += txt
      }
      if (interim) opts.onInterim?.(interim)
      if (final) {
        setState('finalizing')
        opts.onFinal?.(final)
        if (continuous) setState('listening')
      }
    }
    r.onerror = (e: SRErrorEventLike) => {
      // 'no-speech' / 'aborted' are normal — only escalate on real errors.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setState('error')
      opts.onError?.(e.error)
    }
    r.onend = () => {
      if (userWantsRunning && continuous) {
        // Browser closed it (timeout / silence). Restart silently.
        try {
          r.start()
        } catch {
          // Already starting — ignore.
        }
      } else {
        setState('idle')
      }
    }
    return r
  }

  const handle: STTHandle = {
    state,
    start() {
      if (!Ctor) {
        opts.onError?.('stt-unsupported')
        setState('error')
        return
      }
      userWantsRunning = true
      if (!rec) rec = build()
      try {
        rec?.start()
      } catch {
        // Already running.
      }
    },
    stop() {
      userWantsRunning = false
      try {
        rec?.stop()
      } catch {
        /* noop */
      }
    },
    abort() {
      userWantsRunning = false
      try {
        rec?.abort()
      } catch {
        /* noop */
      }
      setState('idle')
    },
  }

  return handle
}
