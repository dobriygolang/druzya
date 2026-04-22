import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const calendarHandlers = [
  http.get(`${base}/interview/calendar`, () =>
    HttpResponse.json({
      target_date: '2026-05-09T14:00:00+03:00',
      countdown: '17д 04ч 12м',
      days_left: 17,
      company: 'Yandex',
      role: 'Senior Backend',
      sections: 'Алгоритмы + System Design + Behavioral',
      readiness_pct: 62,
      today_tasks: [
        { id: 't1', title: 'Two Pointers · Easy', sub: '15 мин · 2 задачи', status: 'done' },
        { id: 't2', title: 'Mock System Design · кэш-инвалидация', sub: '40 мин · с AI-интервьюером', status: 'active' },
        { id: 't3', title: 'Behavioral · STAR-история про конфликт', sub: '20 мин · запись + разбор', status: 'future' },
      ],
      schedule_days: 21,
      strengths: [
        { label: 'Алгоритмы — Easy/Medium', value: 92 },
        { label: 'Go · конкурентность', value: 84 },
        { label: 'SQL · оконные функции', value: 78 },
      ],
      weaknesses: [
        { label: 'Dynamic Programming', value: 38 },
        { label: 'System Design — большие масштабы', value: 44 },
        { label: 'Behavioral на английском', value: 52 },
        { label: 'Tree DP / Segment Tree', value: 31 },
      ],
      ai_recommendation: 'Завтра — 60 минут на DP: Knapsack + LIS. После — 1 mock с AI-интервьюером (System Design: дизайн ленты Twitter). Это закроет 2 главных пробела перед собесом.',
    }),
  ),
]
