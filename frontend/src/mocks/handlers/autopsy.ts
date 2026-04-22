import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const autopsyHandlers = [
  http.get(`${base}/interview/:id/autopsy`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      title: 'Не взяли в Yandex — разбираем почему',
      role: 'Senior Backend',
      date: '28 апреля',
      duration_min: 60,
      verdict: 'REJECTED',
      verdict_sub: 'после фидбека HR',
      timeline: [
        { time: '0:08', label: 'Two Sum — оптимально', status: 'PASSED', color: 'success' },
        { time: '0:18', label: 'String parsing — частично', status: 'PARTIAL', color: 'warn' },
        { time: '0:42', label: 'System Design — Twitter feed', status: 'FAILED', color: 'danger' },
        { time: '0:58', label: 'Behavioral — конфликт в команде', status: 'SKIPPED', color: 'danger' },
      ],
      failures: [
        { tag: 'SD', title: 'CACHING', sub: 'не упомянул Redis для hot-feed', level: 'critical' },
        { tag: 'BEH', title: 'STAR', sub: 'ответ без структуры (Situation-Task-Action-Result)', level: 'critical' },
        { tag: 'ENG', title: 'ENGAGEMENT', sub: 'не задал ни одного вопроса интервьюеру', level: 'red flag' },
      ],
      ai_verdict: '«Для горячего feed — Redis Sorted Set с TTL 5 мин, fallback в БД. Для celebrity-аккаунтов переходим на pull-модель, чтобы не флудить миллион очередей при каждом твите».',
      action_plan: [
        { p: 'P1', text: 'Прорешать 5 system design кейсов (caching focus)' },
        { p: 'P1', text: 'Записать 3 STAR-истории про конфликты' },
        { p: 'P2', text: 'Подготовить 5 умных вопросов интервьюеру' },
        { p: 'P3', text: 'Mock-собес с senior через 7 дней' },
      ],
      next_attempt_weeks: '6-8',
    }),
  ),
]
