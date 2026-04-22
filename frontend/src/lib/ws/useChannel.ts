import { useCallback, useEffect, useRef, useState } from 'react'
import { wsClient, type WSStatus } from './client'
import { channelPrefix } from './events'

export interface UseChannelResult<T> {
  data: T | null
  lastEvent: string | null
  status: WSStatus
  send: (event: string, payload: unknown) => void
}

// React hook subscribing to a WS channel. In MSW mode we don't open a real
// socket — instead we synthesize events on a schedule.
export function useChannel<T = unknown>(channel: string): UseChannelResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [status, setStatus] = useState<WSStatus>('idle')
  const channelRef = useRef(channel)
  channelRef.current = channel

  const useMock = import.meta.env.VITE_USE_MSW === 'true'

  useEffect(() => {
    if (!channel) return

    if (useMock) {
      // MOCK: replace with real WS when backend up
      setStatus('open')
      const stop = startMockEmitter(channel, (event, payload) => {
        setLastEvent(event)
        setData(payload as T)
      })
      return () => {
        stop()
        setStatus('closed')
      }
    }

    wsClient.connect(channel)
    const offMsg = wsClient.on(channel, (event, payload) => {
      setLastEvent(event)
      setData(payload as T)
    })
    const offStatus = wsClient.onStatus(channel, (s) => setStatus(s))
    return () => {
      offMsg()
      offStatus()
      wsClient.disconnect(channel)
    }
  }, [channel, useMock])

  const send = useCallback(
    (event: string, payload: unknown) => {
      if (useMock) return
      wsClient.send(channelRef.current, event, payload)
    },
    [useMock],
  )

  return { data, lastEvent, status, send }
}

// MOCK: replace with real WS when backend up
function startMockEmitter(
  channel: string,
  emit: (event: string, payload: unknown) => void,
): () => void {
  const prefix = channelPrefix(channel)
  const timers: number[] = []
  const t = (fn: () => void, ms: number) => {
    const id = window.setInterval(fn, ms)
    timers.push(id)
  }

  if (prefix === 'arena') {
    let typing = false
    let passed = 8
    t(() => {
      typing = !typing
      emit('opponent_typing', { active: typing })
    }, 2000)
    t(() => {
      passed = Math.min(15, passed + 1)
      emit('opponent_run', { tests: `${passed}/15` })
    }, 8000)
  } else if (prefix === 'spectator') {
    let viewers = 142
    const users = [
      { nick: '@dasha', color: 'text-pink' },
      { nick: '@maks', color: 'text-cyan' },
      { nick: '@kira', color: 'text-warn' },
      { nick: '@ivan', color: 'text-success' },
      { nick: '@petya', color: 'text-pink' },
      { nick: '@ann', color: 'text-cyan' },
    ]
    const messages = [
      'двиньте ему пива',
      'красавчик!',
      'wow',
      'ну вообще',
      'GG',
      'haha',
      '+1',
    ]
    t(() => {
      viewers += 2
      emit('viewer_count', { count: viewers })
    }, 5000)
    t(() => {
      const u = users[Math.floor(Math.random() * users.length)]
      const m = messages[Math.floor(Math.random() * messages.length)]
      emit('chat_message', { nick: u.nick, color: u.color, text: m })
    }, 3000)
  } else if (prefix === 'mock') {
    t(() => {
      emit('ai_evaluation', {
        metrics: [
          { label: 'Корректность', value: 80 + Math.floor(Math.random() * 20) },
          { label: 'Эффективность', value: 60 + Math.floor(Math.random() * 35) },
          { label: 'Чистота кода', value: 70 + Math.floor(Math.random() * 25) },
          { label: 'Коммуникация', value: 60 + Math.floor(Math.random() * 30) },
        ],
      })
    }, 10000)
  } else if (prefix === 'warroom') {
    const sample = [
      { color: 'bg-cyan', text: '[live] @kirill: pushing cache layer' },
      { color: 'bg-warn', text: '[live] errors at 9% trending down' },
      { color: 'bg-success', text: '[live] @nastya: index applied' },
      { color: 'bg-accent', text: '[live] @you: pprof shows hotspot fixed' },
      { color: 'bg-pink', text: '[live] @misha: rollback aborted, holding' },
    ]
    let i = 0
    const names = ['@you', '@nastya', '@kirill_dev', '@misha']
    let toggle = 0
    t(() => {
      const e = sample[i % sample.length]
      i++
      emit('log_event', { ...e, time: 'now' })
    }, 4000)
    t(() => {
      const n = names[toggle % names.length]
      toggle++
      emit('member_status', {
        name: n,
        progress: Math.min(100, 30 + Math.floor(Math.random() * 70)),
        status: ['coding', 'querying', 'thinking', 'monitoring'][toggle % 4],
      })
    }, 2000)
  }

  return () => {
    timers.forEach((id) => window.clearInterval(id))
  }
}
