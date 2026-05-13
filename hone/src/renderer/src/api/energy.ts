// energy.ts — REST client for the Energy tracker (Phase K Wave 15).
//
// Endpoints:
//   POST /api/v1/hone/energy        — create one log row
//   GET  /api/v1/hone/energy?days=N — list recent rows
import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export interface EnergyLog {
  id: string;
  level: number; // 1..5
  note?: string;
  loggedAt: string; // ISO
}

export async function logEnergy(level: number, note?: string): Promise<EnergyLog> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/hone/energy`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ level, note: note ?? '' }),
  });
  if (!resp.ok) throw new Error(`logEnergy: ${resp.status}`);
  return (await resp.json()) as EnergyLog;
}

export async function listEnergyLogs(days = 7): Promise<EnergyLog[]> {
  const url = new URL(`${API_BASE_URL}/api/v1/hone/energy`);
  if (days > 0) url.searchParams.set('days', String(days));
  const resp = await fetch(url.toString(), { headers: authHeaders() });
  if (!resp.ok) throw new Error(`listEnergyLogs: ${resp.status}`);
  const j = (await resp.json()) as { logs?: EnergyLog[] };
  return j.logs ?? [];
}
