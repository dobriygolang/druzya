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
        { name: 'ЯНВ', done: 31, missed: 0, freeze: 0, total: 31 },
        { name: 'ФЕВ', done: 27, missed: 1, freeze: 0, total: 28 },
        { name: 'МАР', done: 28, missed: 2, freeze: 1, total: 31 },
        { name: 'АПР', done: 22, missed: 0, freeze: 0, total: 30 },
        { name: 'МАЙ', done: 0, missed: 0, freeze: 0, total: 31 },
        { name: 'ИЮН', done: 0, missed: 0, freeze: 0, total: 30 },
        { name: 'ИЮЛ', done: 0, missed: 0, freeze: 0, total: 31 },
        { name: 'АВГ', done: 0, missed: 0, freeze: 0, total: 31 },
        { name: 'СЕН', done: 0, missed: 0, freeze: 0, total: 30 },
        { name: 'ОКТ', done: 0, missed: 0, freeze: 0, total: 31 },
        { name: 'НОЯ', done: 0, missed: 0, freeze: 0, total: 30 },
        { name: 'ДЕК', done: 0, missed: 0, freeze: 0, total: 31 },
      ],
    }),
  ),
]
