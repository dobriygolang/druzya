// MSW: каталог подкастов в каноничной форме (см. proto Podcast).
//
// Раньше выдавали legacy-shape `{episodes, sections}`, frontend нормализовал
// — оставлен на будущее. Сейчас возвращаем `{items: [Podcast]}` чтобы UI
// мокался один-в-один в продовую форму ответа.
import { http, HttpResponse } from 'msw'

const base = '/api/v1'

interface MockPodcast {
  id: string
  title: string
  description: string
  section: string
  duration_sec: number
  audio_url: string
  progress_sec: number
  completed: boolean
  published_at: string
}

const items: MockPodcast[] = [
  {
    id: 'pod-1',
    title: 'Kafka vs NATS: когда какую шину выбирать',
    description: 'Сравниваем шины сообщений на реальных кейсах Ozon и Yandex.',
    section: 'SECTION_SYSTEM_DESIGN',
    duration_sec: 42 * 60,
    audio_url: '',
    progress_sec: 0,
    completed: false,
    published_at: '2026-04-14T10:00:00Z',
  },
  {
    id: 'pod-2',
    title: 'Window functions глазами DBA',
    description: 'ROW_NUMBER, LAG, LEAD — паттерны из прода.',
    section: 'SECTION_SQL',
    duration_sec: 28 * 60,
    audio_url: '',
    progress_sec: 28 * 60,
    completed: true,
    published_at: '2026-04-07T10:00:00Z',
  },
  {
    id: 'pod-3',
    title: 'Go-контекст без боли',
    description: 'Cancellation, deadlines и антипаттерны.',
    section: 'SECTION_GO',
    duration_sec: 35 * 60,
    audio_url: '',
    progress_sec: 5 * 60,
    completed: false,
    published_at: '2026-04-01T10:00:00Z',
  },
  {
    id: 'pod-4',
    title: 'DP: как увидеть подзадачу',
    description: 'Memoization vs bottom-up, живые примеры с собесов.',
    section: 'SECTION_ALGORITHMS',
    duration_sec: 38 * 60,
    audio_url: '',
    progress_sec: 0,
    completed: false,
    published_at: '2026-03-24T10:00:00Z',
  },
  {
    id: 'pod-5',
    title: 'Как отвечать на provocative questions',
    description: 'Стресс-вопросы на финальном раунде.',
    section: 'SECTION_BEHAVIORAL',
    duration_sec: 22 * 60,
    audio_url: '',
    progress_sec: 0,
    completed: false,
    published_at: '2026-03-17T10:00:00Z',
  },
]

export const podcastHandlers = [
  http.get(`${base}/podcast`, () => HttpResponse.json({ items })),
  http.put(`${base}/podcast/:id/progress`, async ({ request, params }) => {
    const body = (await request.json()) as { progress_sec?: number; completed?: boolean }
    return HttpResponse.json({
      podcast_id: String(params.id ?? ''),
      progress_sec: body.progress_sec ?? 0,
      completed: Boolean(body.completed),
    })
  }),
]
