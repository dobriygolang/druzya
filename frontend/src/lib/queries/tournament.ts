// Tournament queries — INTENTIONALLY NOT WIRED.
//
// There is no `tournament` bounded context in backend/services/ today and
// there is no `/tournament/*` route on the BFF. The TournamentPage UI now
// renders a ComingSoon banner; this module is preserved as a place to land
// real types once the backend ships, so we don't have to thread imports
// through the page again at that point.
//
// Until then, every export here is unused on purpose. Do NOT call
// useTournamentQuery — it will 404.

export type BracketMatch = {
  p1: string
  p2: string
  s1?: number
  s2?: number
  live?: boolean
  yours?: boolean
  tbd?: boolean
}

export type TournamentResponse = {
  id: string
  name: string
  tier: string
  format: string
  prize_pool: number
  finals_in: string
  registered: boolean
  participants: number
  total_matches: number
  bracket: { r16: BracketMatch[]; qf: BracketMatch[]; sf: BracketMatch[] }
  next_match: { opponent: string; in: string }
  predictions: { label: string; odds: string[]; yours?: boolean }[]
  standings: { rank: number; name: string; score: string; you?: boolean }[]
}
