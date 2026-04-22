import { http, HttpResponse } from 'msw'

const base = '/api/v1'

export type Friend = {
  id: string
  name: string
  tier: string
  status: string
  online: boolean
  gradient: string
  wins: number
  losses: number
  win_rate: number
}

export type FriendRequest = {
  id: string
  name: string
  subtitle: string
  gradient: string
}

const online: Friend[] = [
  { id: 'f1', name: 'kirill_dev', tier: 'Diamond I · 2 980 LP', status: 'В матче', online: true, gradient: 'violet-cyan', wins: 41, losses: 23, win_rate: 64 },
  { id: 'f2', name: 'nastya_codes', tier: 'Diamond III · 2 720 LP', status: 'В лобби', online: true, gradient: 'pink-violet', wins: 38, losses: 22, win_rate: 63 },
  { id: 'f3', name: 'alexey_go', tier: 'Grandmaster · 3 420 LP', status: 'Решает Daily', online: true, gradient: 'cyan-violet', wins: 92, losses: 30, win_rate: 75 },
  { id: 'f4', name: 'maks_py', tier: 'Platinum II · 2 140 LP', status: 'Свободен', online: true, gradient: 'success-cyan', wins: 21, losses: 20, win_rate: 51 },
]

const offline: Friend[] = [
  { id: 'f5', name: 'vasya_rs', tier: 'Diamond IV · 2 510 LP', status: '2 ч назад', online: false, gradient: 'pink-red', wins: 33, losses: 27, win_rate: 55 },
  { id: 'f6', name: 'lena_ts', tier: 'Platinum I · 2 220 LP', status: '5 ч назад', online: false, gradient: 'gold', wins: 19, losses: 18, win_rate: 51 },
  { id: 'f7', name: 'ivan_arch', tier: 'Master · 3 100 LP', status: 'вчера', online: false, gradient: 'violet-cyan', wins: 64, losses: 32, win_rate: 67 },
  { id: 'f8', name: 'olya_ml', tier: 'Diamond II · 2 880 LP', status: '2 дня назад', online: false, gradient: 'cyan-violet', wins: 47, losses: 28, win_rate: 63 },
]

const requests: FriendRequest[] = [
  { id: 'r1', name: 'sergey_kt', subtitle: '12 общих друзей', gradient: 'violet-cyan' },
  { id: 'r2', name: 'tanya_dev', subtitle: 'играли вместе в гильдии', gradient: 'pink-violet' },
  { id: 'r3', name: 'anton_be', subtitle: '6 общих друзей', gradient: 'success-cyan' },
]

const suggestions: FriendRequest[] = [
  { id: 's1', name: 'mikhail_qa', subtitle: 'Diamond III', gradient: 'cyan-violet' },
  { id: 's2', name: 'katya_fe', subtitle: 'Platinum II', gradient: 'pink-red' },
  { id: 's3', name: 'pavel_sec', subtitle: 'Master', gradient: 'gold' },
  { id: 's4', name: 'dasha_ds', subtitle: 'Diamond I', gradient: 'violet-cyan' },
]

export const friendsHandlers = [
  http.get(`${base}/friends`, () =>
    HttpResponse.json({
      counts: { online: 47, total: 124, requests: 3, guild: 32 },
      friend_code: 'DRUZ9-K7M2-X9P',
      online,
      offline,
      requests,
      suggestions,
    }),
  ),
]
