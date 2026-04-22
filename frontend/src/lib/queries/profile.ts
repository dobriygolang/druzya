import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Attributes = {
  intellect: number
  strength: number
  dexterity: number
  will: number
}

export type Subscription = {
  plan: string
  current_period_end: string
}

export type Profile = {
  id: string
  username: string
  display_name: string
  level: number
  xp: number
  xp_to_next: number
  char_class: string
  title: string
  attributes: Attributes
  global_power_score: number
  career_stage: string
  subscription: Subscription
  tier?: 'free' | 'premium' | 'pro'
  ai_credits: number
  created_at: string
  achievements?: Achievement[]
  avatar_frame?: string
}

export type Achievement = {
  key: string
  title: string
  description: string
  earned_at: string
}

export type AtlasNode = {
  key: string
  title: string
  section: string
  kind: string
  progress: number
  unlocked: boolean
  decaying: boolean
  description: string
}

export type AtlasEdge = { from: string; to: string }

export type Atlas = {
  center_node: string
  nodes: AtlasNode[]
  edges: AtlasEdge[]
}

export type WeeklyReport = {
  week_start: string
  week_end: string
  metrics: {
    tasks_solved: number
    matches_won: number
    rating_change: number
    xp_earned: number
    time_minutes: number
  }
  heatmap: number[]
  strengths: string[]
  weaknesses: { atlas_node_key: string; reason: string }[]
  stress_analysis: string
  recommendations: {
    title: string
    action: { kind: string; params?: Record<string, unknown> }
  }[]
}

export function useProfileQuery() {
  return useQuery({
    queryKey: ['profile', 'me'],
    queryFn: () => api<Profile>('/profile/me'),
  })
}

export function useAtlasQuery() {
  return useQuery({
    queryKey: ['profile', 'me', 'atlas'],
    queryFn: () => api<Atlas>('/profile/me/atlas'),
  })
}

export function useWeeklyReportQuery() {
  return useQuery({
    queryKey: ['profile', 'me', 'report'],
    queryFn: () => api<WeeklyReport>('/profile/me/report'),
  })
}
