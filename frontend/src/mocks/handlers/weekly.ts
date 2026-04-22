import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const weeklyHandlers = [
  http.get(`${base}/report/weekly`, () =>
    HttpResponse.json({
      period: '21–27 апреля',
      actions_count: 47,
      stats: {
        xp: { value: '+2 480', delta: '+47%' },
        matches: { value: '23', wins: 12, losses: 11, delta: '+18%' },
        streak: { value: '12 🔥', best: 47 },
        avg_lp: { value: '+2.4', total: '+18 lp всего' },
      },
      strong_sections: [
        { id: 'a', name: 'Algorithms', sub: '9 матчей · 78% wr', xp: '+340 XP' },
        { id: 's', name: 'Strings', sub: '6 матчей · 67% wr', xp: '+220 XP' },
        { id: 'q', name: 'SQL', sub: '4 матча · 75% wr', xp: '+180 XP' },
      ],
      weak_sections: [
        { id: 'd', name: 'DP', sub: '3 матча · 33% wr', xp: '-80 XP', tone: 'danger' },
        { id: 's2', name: 'System Design', sub: '2 матча · 50% wr', xp: '+40 XP', tone: 'warn' },
      ],
      stress_pattern: 'На этой неделе ты делаешь плохие решения когда таймер < 5 мин — 4 из 5 проигрышей пришлись на цейтнот. Попробуй замедлиться в первой половине: 60 секунд на план перед кодом.',
      actions: [
        { p: 'P1', text: 'Решить 5 DP задач (medium)', sub: 'закроет слабую секцию' },
        { p: 'P1', text: 'Mock interview по System Design', sub: 'с @alexey, среда 19:00' },
        { p: 'P2', text: 'Replay 3 проигрыша из истории', sub: 'найти общий паттерн' },
      ],
      podcast: { title: 'DP без боли', duration: '32 мин', sub: 'по твоей слабой секции' },
      compare_weeks: [
        { label: 'Эта', xp: 2480, w: '100%' },
        { label: '-1', xp: 1690, w: '68%' },
        { label: '-2', xp: 2010, w: '81%' },
        { label: '-3', xp: 1240, w: '50%' },
      ],
    }),
  ),
]
