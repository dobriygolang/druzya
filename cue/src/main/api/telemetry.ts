// Cue main-process REST adapter for the backend telemetry endpoints.
// Renderer batches events + flips consent through IPC; main attaches the
// bearer token (lives in keychain, never crosses the bridge) and POSTs.
//
// Why fetch, not Connect: fire-and-forget batching; existing CopilotClient
// is tuned for streaming chat, install-heartbeat already proved the REST
// path is the cleanest for write-only endpoints.

import { getValidSession } from '../auth/refresh';

interface TelemetryEventInput {
  name: string;
  occurredAt: string;
  properties: Record<string, string>;
}

interface TelemetryConsentInput {
  optedIn: boolean;
  consentVersion: number;
}

const SURFACE = 'cue';

/**
 * recordEvents — fan-out a batch to /api/v1/telemetry/events.
 * Best-effort: returns accepted=0 on auth miss / network failure, never throws.
 */
export async function recordEvents(
  apiBaseURL: string,
  batch: TelemetryEventInput[],
): Promise<{ accepted: number }> {
  if (batch.length === 0) return { accepted: 0 };
  // Defensive cap mirrors backend's 100-event hard cap.
  const events = batch.slice(0, 100).map((ev) => ({
    name: ev.name,
    occurred_at: ev.occurredAt,
    properties: ev.properties,
    surface: SURFACE,
  }));
  const session = await getValidSession({ apiBaseURL });
  if (!session) return { accepted: 0 };
  try {
    const resp = await fetch(`${apiBaseURL.replace(/\/+$/, '')}/api/v1/telemetry/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ events }),
    });
    if (!resp.ok) return { accepted: 0 };
    const json = (await resp.json()) as { accepted?: number };
    return { accepted: typeof json.accepted === 'number' ? json.accepted : events.length };
  } catch {
    return { accepted: 0 };
  }
}

/**
 * setConsent — best-effort cross-device sync of opt-in toggle.
 * Local localStorage in renderer remains primary truth; this call just
 * mirrors to the backend so other devices (web, hone) see consistent
 * state.
 */
export async function setConsent(
  apiBaseURL: string,
  input: TelemetryConsentInput,
): Promise<{ ok: boolean }> {
  const session = await getValidSession({ apiBaseURL });
  if (!session) return { ok: false };
  try {
    const resp = await fetch(`${apiBaseURL.replace(/\/+$/, '')}/api/v1/telemetry/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        surface: SURFACE,
        opted_in: input.optedIn,
        consent_version: input.consentVersion,
      }),
    });
    return { ok: resp.ok };
  } catch {
    return { ok: false };
  }
}
