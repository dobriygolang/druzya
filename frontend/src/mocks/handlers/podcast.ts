import { http, HttpResponse } from 'msw'

const base = '/api/v1'

const catalog = {
  sections: [
    { key: 'algorithms', title: 'Алгоритмы', count: 12 },
    { key: 'sql', title: 'SQL', count: 7 },
    { key: 'go', title: 'Go', count: 9 },
    { key: 'system_design', title: 'System Design', count: 15 },
    { key: 'behavioral', title: 'Behavioral', count: 6 },
  ],
  episodes: [
    {
      id: 'pod-1',
      title: 'Kafka vs NATS: когда какую шину выбирать',
      section: 'system_design',
      duration_min: 42,
      published_at: '2026-04-14T10:00:00Z',
      description: 'Сравниваем шины сообщений на реальных кейсах Ozon и Yandex.',
      cover: null,
      listened: false,
    },
    {
      id: 'pod-2',
      title: 'Window functions глазами DBA',
      section: 'sql',
      duration_min: 28,
      published_at: '2026-04-07T10:00:00Z',
      description: 'ROW_NUMBER, LAG, LEAD — паттерны из прода.',
      cover: null,
      listened: true,
    },
    {
      id: 'pod-3',
      title: 'Go-контекст без боли',
      section: 'go',
      duration_min: 35,
      published_at: '2026-04-01T10:00:00Z',
      description: 'Cancellation, deadlines и антипаттерны.',
      cover: null,
      listened: false,
    },
    {
      id: 'pod-4',
      title: 'DP: как увидеть подзадачу',
      section: 'algorithms',
      duration_min: 38,
      published_at: '2026-03-24T10:00:00Z',
      description: 'Memoization vs bottom-up, живые примеры с собесов.',
      cover: null,
      listened: false,
    },
    {
      id: 'pod-5',
      title: 'Как отвечать на provocative questions',
      section: 'behavioral',
      duration_min: 22,
      published_at: '2026-03-17T10:00:00Z',
      description: 'Стресс-вопросы на финальном раунде.',
      cover: null,
      listened: false,
    },
  ],
}

export const podcastHandlers = [
  http.get(`${base}/podcast`, () => HttpResponse.json(catalog)),
]
