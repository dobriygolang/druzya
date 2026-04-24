import type { Profile, PublicProfile } from '../../lib/queries/profile'

// ProfileViewModel is the union of /profile/me and /profile/{username}
// rendered fields. Public-only routes get a partial — the UI degrades
// gracefully when private fields (xp, ai_credits, etc.) are absent.
export type ProfileViewModel = {
  isOwn: boolean
  username: string
  display: string
  initial: string
  title: string
  level: number
  charClass: string
  careerStage: string
  globalPowerScore: number
}

export function toViewModel(args: {
  isOwn: boolean
  own?: Profile
  pub?: PublicProfile
  fallbackScore?: number
}): ProfileViewModel | null {
  const { isOwn, own, pub, fallbackScore } = args
  if (isOwn) {
    if (!own) return null
    return {
      isOwn: true,
      username: own.username,
      display: own.display_name || own.username,
      initial: (own.display_name || own.username || 'D').charAt(0).toUpperCase(),
      title: own.title || '—',
      level: own.level ?? 0,
      charClass: own.char_class || '—',
      careerStage: own.career_stage || '',
      globalPowerScore: own.global_power_score ?? fallbackScore ?? 0,
    }
  }
  if (!pub) return null
  return {
    isOwn: false,
    username: pub.username,
    display: pub.display_name || pub.username,
    initial: (pub.display_name || pub.username || 'D').charAt(0).toUpperCase(),
    title: pub.title || '—',
    level: pub.level ?? 0,
    charClass: pub.char_class || '—',
    careerStage: pub.career_stage || '',
    globalPowerScore: pub.global_power_score ?? 0,
  }
}

export const SECTION_LABELS: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

export const PROFILE_TABS_OWN = ['Overview', 'Matches', 'Achievements', 'Cohorts', 'Stats', 'Bookings'] as const
export const PROFILE_TABS_PUBLIC = ['Overview', 'Matches', 'Achievements', 'Cohorts', 'Stats'] as const
export type ProfileTab = (typeof PROFILE_TABS_OWN)[number]
