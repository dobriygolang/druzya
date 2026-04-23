import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type NotifyPreferences = {
  email_weekly: boolean
  email_calendar: boolean
  telegram_daily: boolean
  push_arena_invite: boolean
  push_guild_war: boolean
  quiet_hours_start: string
  quiet_hours_end: string
}

export type UserSettings = {
  locale: 'ru' | 'en'
  theme: 'dark' | 'auto'
  motion: 'on' | 'off'
  public_profile: boolean
}

// ProfileSettings is the PUT /profile/me/settings payload. Mirrors the proto
// ProfileSettings message — not to be confused with UserSettings above which
// is a distinct (legacy) shape.
export type ProfileSettings = {
  display_name?: string
  locale?: string
  voice_mode_enabled?: boolean
  // ai_insight_model — OpenRouter model id the user picked for their weekly
  // AI Coach insight. Empty string ⇒ server-default free model. Premium ids
  // are rejected server-side for free-tier users.
  ai_insight_model?: string
}

export function useUpdateProfileSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: ProfileSettings) =>
      api<{ settings: ProfileSettings }>('/profile/me/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'settings'] })
    },
  })
}


export function useNotifyPreferencesQuery() {
  return useQuery({
    queryKey: ['notify', 'preferences'],
    queryFn: () => api<NotifyPreferences>('/notify/preferences'),
  })
}

export function useUpdateNotifyPreferences() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: NotifyPreferences) =>
      api<NotifyPreferences>('/notify/preferences', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['notify', 'preferences'], data)
    },
  })
}

export function useUpdateUserSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: UserSettings) =>
      api<UserSettings>('/profile/me/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', 'me'] })
    },
  })
}
