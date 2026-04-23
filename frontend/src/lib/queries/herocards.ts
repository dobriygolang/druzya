// Hero Cards queries — INTENTIONALLY NOT WIRED.
//
// There is no `hero_cards` bounded context in backend/services/ today and
// there is no `/herocards` route on the BFF. The HeroCardsPage UI now
// renders a ComingSoon banner; this module is preserved as a place to land
// real types once the backend ships, so the page wiring is a one-line
// change later.
//
// Until then, every export here is unused on purpose. Do NOT call
// useHeroCardsQuery — it will 404.

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
