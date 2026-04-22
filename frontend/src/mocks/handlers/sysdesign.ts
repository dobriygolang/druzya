import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const sysdesignHandlers = [
  http.get(`${base}/sysdesign/session/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      problem: {
        title: 'Спроектируй Twitter Timeline',
        description: 'Хронологическая лента для 300M DAU. Учти fanout, кеш и реалтайм.',
      },
      functional: [
        { ok: true, text: 'Публикация твитов (≤280 символов)' },
        { ok: true, text: 'Чтение Home Timeline' },
        { ok: true, text: 'Подписка на пользователей' },
        { ok: true, text: 'Лайки и ретвиты' },
        { ok: false, text: 'Уведомления (push) — обсуждаем' },
      ],
      non_functional: [
        { l: 'Latency p99', v: '< 200ms', tone: 'cyan' },
        { l: 'Доступность', v: '99.95%', tone: 'success' },
        { l: 'Throughput', v: '600k tw/s', tone: 'cyan' },
        { l: 'Read:Write', v: '100:1', tone: 'warn' },
        { l: 'Consistency', v: 'Eventual', tone: 'pink' },
      ],
      constraints: [
        { l: 'DAU', v: '300M' },
        { l: 'Tweets / day', v: '100M' },
        { l: 'Avg followers', v: '200' },
      ],
      evaluation: [
        { l: 'Requirements', v: 9.0, tone: 'success' },
        { l: 'High-level', v: 8.5, tone: 'cyan' },
        { l: 'Deep dive', v: 7.5, tone: 'warn' },
        { l: 'Trade-offs', v: 8.0, tone: 'cyan' },
        { l: 'Communication', v: 9.0, tone: 'success' },
      ],
      phases: [
        { t: 'Requirements', s: 'done' },
        { t: 'High-level design', s: 'done' },
        { t: 'Deep dive', s: 'active' },
        { t: 'Trade-offs', s: 'pending' },
      ],
      ai_credits_used: 3,
      ai_credits_max: 10,
      time_elapsed_sec: 2843,
      time_total_sec: 3600,
      current_phase: 'Phase 2 · Deep dive',
    }),
  ),
]
