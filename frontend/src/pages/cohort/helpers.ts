// Shared helpers for the /cohort views (tier/role labels, chip styles).

// TIERS is kept for the discovery page filter chips. New cohorts always start
// at the lowest tier ("bronze") and are promoted automatically by the backend
// based on the cohort's aggregate ELO — see HandleCreate in
// services/cohort/ports/discovery_handler.go.
export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'] as const

export function tierFor(elo: number): string {
  if (elo >= 2200) return 'master'
  if (elo >= 1900) return 'diamond'
  if (elo >= 1600) return 'platinum'
  if (elo >= 1300) return 'gold'
  if (elo >= 1100) return 'silver'
  return 'bronze'
}

export function tierLabel(t: string): string {
  switch (t) {
    case 'master':
      return 'Master'
    case 'diamond':
      return 'Diamond'
    case 'platinum':
      return 'Platinum'
    case 'gold':
      return 'Gold'
    case 'silver':
      return 'Silver'
    case 'bronze':
      return 'Bronze'
    default:
      return '—'
  }
}

export function roleLabel(role: string): string {
  if (role === 'captain') return 'Лидер'
  if (role === 'officer') return 'Офицер'
  return 'Игрок'
}

export function roleChip(role: string) {
  if (role === 'captain') return 'bg-warn/15 text-warn'
  if (role === 'officer') return 'bg-cyan/15 text-cyan'
  return 'bg-border-strong text-text-muted'
}
