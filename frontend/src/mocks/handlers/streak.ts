import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export const streakHandlers = [
  http.get(`${base}/kata/streak`, () =>
    HttpResponse.json({
      current: 12,
      best: 47,
      freeze_tokens: 3,
      freeze_max: 5,
      total_done: 127,
      total_missed: 12,
      total_freeze: 5,
      remaining: 121,
      year: 2026,
      months: [
        { name: 'ЯНВ', done: 31, total: 31 },
        { name: 'ФЕВ', done: 28, total: 28 },
        { name: 'МАР', done: 31, total: 31 },
        { name: 'АПР', done: 22, total: 30 },
        { name: 'МАЙ', done: 0, total: 31 },
        { name: 'ИЮН', done: 0, total: 30 },
        { name: 'ИЮЛ', done: 0, total: 31 },
        { name: 'АВГ', done: 0, total: 31 },
        { name: 'СЕН', done: 0, total: 30 },
        { name: 'ОКТ', done: 0, total: 31 },
        { name: 'НОЯ', done: 0, total: 30 },
        { name: 'ДЕК', done: 0, total: 31 },
      ],
      today: {
        title: 'Binary Search Rotated',
        difficulty: 'Medium',
        section: 'Algorithms',
        complexity: 'O(log n)',
        time_left: 'осталось 14ч 32м',
        day: 12,
      },
    }),
  ),
]
