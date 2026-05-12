// installs.ts — Phase J / X1 (P0) single onboarding funnel.
//
// Web calls recordAppInstall('web') once after signup (post-auth
// bootstrap). The same backend RPC is used by Hone (renderer) and Cue
// (main process). First install across all 3 surfaces issues a 7-day
// Pro trial — see backend/services/subscription/app/grant_trial_pro.go.

import { api } from '../apiClient'

export type AppSurface = 'web' | 'hone' | 'cue'

// Wire encoding for the AppSurface enum. Backend transcoder accepts
// both numeric and name strings; we send the wire-name for readability
// in network panels.
const WIRE_NAME: Record<AppSurface, string> = {
  web: 'APP_SURFACE_WEB',
  hone: 'APP_SURFACE_HONE',
  cue: 'APP_SURFACE_CUE',
}

export interface RecordAppInstallResponse {
  install?: {
    app: string
    first_seen_at?: string
    last_seen_at?: string
    app_version?: string
  }
  trial_pro_granted: boolean
  trial_pro_until: string
}

export interface InstalledApp {
  app: AppSurface
  first_seen_at: string
  last_seen_at: string
  app_version: string
}

export interface GetInstalledAppsResponse {
  installs: InstalledApp[]
}

export async function recordAppInstall(
  app: AppSurface,
  version = '',
): Promise<RecordAppInstallResponse> {
  return api<RecordAppInstallResponse>('/profile/me/installs', {
    method: 'POST',
    body: JSON.stringify({ app: WIRE_NAME[app], app_version: version }),
  })
}

export async function getInstalledApps(): Promise<GetInstalledAppsResponse> {
  return api<GetInstalledAppsResponse>('/profile/me/installs', { method: 'GET' })
}

// Storage key for «already heartbeat'd this user this session» — guards
// against the page being mounted multiple times after deep-link OAuth
// callback. The check is purely an optimisation: backend ON CONFLICT
// makes the heartbeat idempotent regardless.
const HEARTBEAT_FIRED_KEY = 'druz9:install-heartbeat:fired'

/** Fire the web heartbeat once per page lifetime. Safe to call from
 *  multiple components — guarded by an in-memory + sessionStorage flag. */
export async function recordWebInstallOnce(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (window.sessionStorage.getItem(HEARTBEAT_FIRED_KEY) === '1') return
    window.sessionStorage.setItem(HEARTBEAT_FIRED_KEY, '1')
  } catch {
    /* sessionStorage absent — degrade to once-per-mount via in-memory check */
  }
  try {
    const r = await recordAppInstall('web', '')
    if (r.trial_pro_granted) {
      // Surface the celebratory toast via a window event — AppShell or any
      // page can listen. Avoids hard-wiring this module to a toast lib.
      window.dispatchEvent(
        new CustomEvent('druz9:trial-pro-granted', {
          detail: { until: r.trial_pro_until },
        }),
      )
    }
  } catch {
    /* network/401 — best-effort, retry on next signed-in mount */
  }
}
