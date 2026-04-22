import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type HeroCard = {
  id: string
  name: string
  tier: string
  tag: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'locked'
  power: number
  duplicate: boolean
  initials: string
  gradient: string
  description?: string
  stats?: { atk: number; def: number; spd: number }
  global_rank?: string
}

export type HeroCardsResponse = {
  total: number
  unlocked: number
  duplicates: number
  showcase: number
  showcase_max: number
  pack_price: number
  cards: HeroCard[]
  selected_id: string
  trades: { from: string; want: string; delta: string }[]
}

export function useHeroCardsQuery() {
  return useQuery({
    queryKey: ['herocards'],
    queryFn: () => api<HeroCardsResponse>('/herocards'),
  })
}
