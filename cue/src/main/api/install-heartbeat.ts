// Cue main process fires this once on launch (after auth session is
// valid). Idempotent: backend uses ON CONFLICT (user_id, app) DO UPDATE
// SET last_seen_at = now(), so any number of restarts only refresh the
// timestamp.
//
// First-install reward: when this is the user's FIRST install row
// across web/hone/cue, backend issues a 7-day Pro trial. The response
// carries trial_pro_granted; we surface it via the existing 'session'
// IPC channel so the renderer can show a celebratory toast.
//
// Why fetch, not Connect: install-tracking is a fire-and-forget single
// request; the existing CopilotClient is tuned for streaming chat. Going
// REST keeps this file dependency-free and lets us share the same shape
// the hone renderer uses.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface RecordInstallResult {
  ok: boolean;
  trialProGranted: boolean;
  /** RFC3339 — empty when no trial issued. */
  trialProUntil: string;
}

export async function recordCueInstall(
  cfg: RuntimeConfig,
  version: string,
): Promise<RecordInstallResult> {
  // Need a session — heartbeat is authenticated. If the user isn't
  // signed in yet (first launch before OAuth callback), silently skip;
  // next time the app starts with a session we'll try again.
  const session = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
  if (!session) return { ok: false, trialProGranted: false, trialProUntil: '' };

  // Body uses wire snake_case mirroring proto JSON encoding; matches
  // intelligence.ts companion. app enum encoded as the wire name.
  const body = {
    app: 'APP_SURFACE_CUE',
    app_version: version,
  };
  try {
    const resp = await fetch(`${cfg.apiBaseURL.replace(/\/+$/, '')}/api/v1/profile/me/installs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return { ok: false, trialProGranted: false, trialProUntil: '' };
    }
    const json = (await resp.json()) as {
      trial_pro_granted?: boolean;
      trialProGranted?: boolean;
      trial_pro_until?: string;
      trialProUntil?: string;
    };
    return {
      ok: true,
      trialProGranted: Boolean(json.trial_pro_granted ?? json.trialProGranted),
      trialProUntil: json.trial_pro_until ?? json.trialProUntil ?? '',
    };
  } catch {
    // Network down / DNS hiccup — heartbeat is best-effort, retry next
    // launch. Never surfaces an error to the user.
    return { ok: false, trialProGranted: false, trialProUntil: '' };
  }
}
