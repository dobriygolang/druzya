import { http, HttpResponse } from 'msw'

const base = '/api/v1'

// Identity 2026-05-04: arena/cohort/ranked выпилены. Mock items кружатся
// вокруг продуктовых поверхностей: coach insights, mock results, tutor
// invites, system alerts. Match-invite kind типа сохранён для backward
// compat (proto union), но мок его больше не отдаёт.
export type NotificationItem = {
  id: string
  kind: 'challenge' | 'win' | 'ai' | 'cohort' | 'achievement' | 'friend' | 'rank' | 'streak' | 'system'
  unread: boolean
  title: string
  subtitle: string
  time: string
  bucket: 'today' | 'yesterday' | 'week'
}

const items: NotificationItem[] = [
  { id: 'n1', kind: 'ai', unread: true, title: 'AI-coach: новый план на неделю готов', subtitle: 'Фокус: dynamic programming · 5 шагов', time: '5 мин', bucket: 'today' },
  { id: 'n2', kind: 'win', unread: true, title: 'Mock пройден · score 78 (strict)', subtitle: 'Median of Two Sorted Arrays · O(log n) · watermark: honest', time: '1 ч', bucket: 'today' },
  { id: 'n3', kind: 'ai', unread: true, title: 'Coach замечает: weak spot в SQL window functions', subtitle: 'Открой Atlas → SQL → Window Functions', time: '3 ч', bucket: 'today' },
  { id: 'n4', kind: 'system', unread: true, title: 'Tutor @anna_mentor пригласил тебя на сессию', subtitle: 'Завтра 18:00 · System Design', time: '5 ч', bucket: 'today' },
  { id: 'n5', kind: 'streak', unread: true, title: 'Серия 7 дней — Hone focus поднялся в Insights', subtitle: 'Best streak: 12 дней', time: '8 ч', bucket: 'today' },
  { id: 'n6', kind: 'friend', unread: false, title: '@nastya_codes добавила тебя в друзья', subtitle: '12 общих друзей', time: 'вчера 21:14', bucket: 'yesterday' },
  { id: 'n7', kind: 'ai', unread: false, title: 'Reflection ждёт: вчера ты завалил mock на dp', subtitle: 'AI-tutor подготовил разбор', time: 'вчера 19:02', bucket: 'yesterday' },
  { id: 'n8', kind: 'streak', unread: false, title: 'Hone freeze активирован автоматически', subtitle: 'у тебя 2 заморозки осталось', time: 'вчера 04:00', bucket: 'yesterday' },
  { id: 'n9', kind: 'system', unread: false, title: 'Релиз v2.4 · новые AI-модели', subtitle: 'Sonnet 4.5 теперь по умолчанию', time: 'вчера 12:30', bucket: 'yesterday' },
]

export const notificationsHandlers = [
  http.get(`${base}/notifications`, () =>
    HttpResponse.json({
      unread: 5,
      total: 9,
      filters: { challenges: 0, wins: 1, requests: 1, cohort: 0, system: 2 },
      tabs: { all: 9, unread: 5, social: 1, match: 1, cohort: 0, system: 2 },
      items,
    }),
  ),
]
