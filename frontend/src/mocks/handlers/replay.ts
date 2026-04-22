import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const replayHandlers = [
  http.get(`${base}/mock/session/:id/replay`, ({ params }) =>
    HttpResponse.json({
      session_id: params.id,
      title: 'LRU Cache · 28 апр',
      status: 'PASSED',
      total_frames: 287,
      current_frame: 142,
      duration: '4:21',
      events: [
        { id: 'e1', color: 'cyan', label: 'Start typing', sub: 'lru.go open', time: '0:08' },
        { id: 'e2', color: 'warn', label: 'Long pause', sub: '28s thinking', time: '0:34' },
        { id: 'e3', color: 'accent', label: 'Refactor', sub: 'extracted helper', time: '1:12' },
        { id: 'e4', color: 'danger', label: 'Test fail', sub: 'eviction order', time: '1:42' },
        { id: 'e5', color: 'success', label: 'Test pass', sub: '15/15 ok', time: '2:55' },
        { id: 'e6', color: 'pink', label: 'Submit', sub: 'final answer', time: '4:21' },
      ],
    }),
  ),
]
