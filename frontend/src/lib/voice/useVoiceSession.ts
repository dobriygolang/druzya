// Orchestrates a two-way voice session: STT → backend turn → TTS → loop.

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../apiClient'
import { createSTT, isSTTSupported, type STTHandle } from './stt'
import { cancel as cancelTTS, speak, type TTSVoice } from './tts'

export type VoiceSessionState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface UseVoiceSession {
  state: VoiceSessionState
  transcript: string
  aiText: string
  start(): void
  stop(): void
  error?: string
}

interface Opts {
  sessionId: string
  voice: TTSVoice
  lang?: 'ru-RU' | 'en-US'
}

async function postTurn(sessionId: string, text: string): Promise<{ aiText: string }> {
  const token = (() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem('druz9_access_token') : null
    } catch {
      return null
    }
  })()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}/voice/turn`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ sessionId, text }),
  })
  if (!res.ok) {
    throw new Error(`voice/turn failed: ${res.status}`)
  }
  // Stream-aware: if SSE, parse chunks; else JSON.
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream') && res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    // SSE: lines starting with `data: <chunk>`
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n')) {
        const m = line.match(/^data:\s?(.*)$/)
        if (m) acc += m[1]
      }
    }
    return { aiText: acc.trim() }
  }
  const json = (await res.json()) as { aiText?: string }
  return { aiText: json.aiText ?? '' }
}

export function useVoiceSession(opts: Opts): UseVoiceSession {
  const [state, setState] = useState<VoiceSessionState>('idle')
  const [transcript, setTranscript] = useState('')
  const [aiText, setAiText] = useState('')
  const [error, setError] = useState<string | undefined>()

  const sttRef = useRef<STTHandle | null>(null)
  const runningRef = useRef(false)
  // Latest snapshots so the STT callback (closed over the initial render)
  // always sees current opts.
  const optsRef = useRef(opts)
  optsRef.current = opts

  // Process one final user utterance: STT pause → backend → TTS → STT resume.
  const processFinal = useCallback(async (text: string) => {
    const t = text.trim()
    if (!t) return
    if (!runningRef.current) return
    setState('thinking')
    // Pause STT so the AI's voice doesn't get re-transcribed back as input.
    sttRef.current?.stop()
    try {
      const { aiText: reply } = await postTurn(optsRef.current.sessionId, t)
      if (!runningRef.current) return
      setAiText(reply)
      setState('speaking')
      await speak(reply, {
        voice: optsRef.current.voice,
        lang: optsRef.current.lang ?? 'ru-RU',
      })
      if (!runningRef.current) return
      setState('listening')
      sttRef.current?.start()
    } catch (e) {
      if (!runningRef.current) return
      setError((e as Error).message)
      setState('error')
    }
  }, [])

  const start = useCallback(() => {
    if (runningRef.current) return
    if (!isSTTSupported()) {
      setError('Web Speech API недоступен в этом браузере')
      setState('error')
      return
    }
    runningRef.current = true
    setError(undefined)
    setTranscript('')
    setAiText('')
    const stt = createSTT({
      lang: opts.lang ?? 'ru-RU',
      continuous: true,
      onInterim: (txt) => setTranscript(txt),
      onFinal: (txt) => {
        setTranscript(txt)
        void processFinal(txt)
      },
      onError: (err) => {
        setError(err)
        setState('error')
      },
    })
    sttRef.current = stt
    setState('listening')
    stt.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.lang, processFinal])

  const stop = useCallback(() => {
    runningRef.current = false
    sttRef.current?.abort()
    sttRef.current = null
    cancelTTS()
    setState('idle')
  }, [])

  useEffect(() => {
    return () => {
      runningRef.current = false
      sttRef.current?.abort()
      cancelTTS()
    }
  }, [])

  return { state, transcript, aiText, start, stop, error }
}
