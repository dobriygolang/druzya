import { http, HttpResponse } from 'msw'

const base = '/api/v1'

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
  { id: 'n1', kind: 'challenge', unread: true, title: '@kirill_dev бросил вызов · Ranked 1v1', subtitle: 'Diamond I · принять до 18:30', time: '5 мин', bucket: 'today' },
  { id: 'n2', kind: 'win', unread: true, title: 'Победа vs @vasya_rs · +18 LP', subtitle: 'Median of Two Sorted Arrays · O(log n)', time: '1 ч', bucket: 'today' },
  { id: 'n3', kind: 'ai', unread: true, title: 'AI наставник: новый план на неделю готов', subtitle: 'Фокус: dynamic programming · 5 шагов', time: '3 ч', bucket: 'today' },
  { id: 'n4', kind: 'cohort', unread: true, title: 'Война когорт: Ironclad ведёт 2 140 — 1 670', subtitle: 'твой вклад: 240 очков · финал через 2д 4ч', time: '5 ч', bucket: 'today' },
  { id: 'n5', kind: 'achievement', unread: true, title: 'Получен ачивмент Speed Demon · +500 XP', subtitle: '10 задач под 5 минут подряд', time: '8 ч', bucket: 'today' },
  { id: 'n6', kind: 'friend', unread: false, title: '@nastya_codes добавила тебя в друзья', subtitle: '12 общих друзей', time: 'вчера 21:14', bucket: 'yesterday' },
  { id: 'n7', kind: 'rank', unread: false, title: 'Поднялся в рейтинге: Diamond III', subtitle: '+124 LP за день · топ-12 друзей', time: 'вчера 19:02', bucket: 'yesterday' },
  { id: 'n8', kind: 'streak', unread: false, title: 'Streak Freeze активирован автоматически', subtitle: 'у тебя 2 заморозки осталось', time: 'вчера 04:00', bucket: 'yesterday' },
  { id: 'n9', kind: 'system', unread: false, title: 'Релиз v2.4 · новые AI-модели', subtitle: 'Sonnet 4.5 теперь по умолчанию', time: 'вчера 12:30', bucket: 'yesterday' },
]

export const notificationsHandlers = [
  http.get(`${base}/notifications`, () =>
    HttpResponse.json({
      unread: 12,
      total: 47,
      filters: { challenges: 4, wins: 9, requests: 3, cohort: 9, system: 12 },
      tabs: { all: 47, unread: 12, social: 8, match: 18, cohort: 9, system: 12 },
      items,
    }),
  ),
]
