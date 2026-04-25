// storage.ts — Phase C storage quota client.
//
// Бэкенд: GET /api/v1/storage/quota → {usedBytes, quotaBytes, tier}.
// Этот endpoint — плоский REST (не Connect-RPC), потому что storage
// service не имеет proto schema'ы и оборачивать его ради одного reader'а
// несоразмерно. Используем bare fetch с тем же bearer'ом.
import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

// StorageTier унифицирован с subscription.Tier (`free` | `seeker` | `ascended`).
// Старые значения 'pro' / 'pro_plus' deprecated — backend mapping добавлен в
// services/storage для backward compat но fronted принимает обе формы и
// нормализует.
export type StorageTier = 'free' | 'seeker' | 'ascended' | 'pro' | 'pro_plus';

export interface StorageQuota {
  usedBytes: number;
  quotaBytes: number;
  tier: StorageTier;
}

export async function getStorageQuota(): Promise<StorageQuota> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const resp = await fetch(`${API_BASE_URL}/api/v1/storage/quota`, { headers });
  if (!resp.ok) {
    throw new Error(`storage quota: ${resp.status}`);
  }
  const j = (await resp.json()) as StorageQuota;
  return {
    usedBytes: Number(j.usedBytes ?? 0),
    quotaBytes: Number(j.quotaBytes ?? 0),
    tier: normalizeTier(j.tier),
  };
}

// normalizeTier — backward compat: legacy `pro`/`pro_plus` → `seeker`/`ascended`.
function normalizeTier(t: unknown): StorageTier {
  if (typeof t !== 'string') return 'free';
  if (t === 'pro') return 'seeker';
  if (t === 'pro_plus') return 'ascended';
  if (t === 'free' || t === 'seeker' || t === 'ascended') return t;
  return 'free';
}

// formatBytes — компактный «1.4 GB / 1 GB» формат для usage-bar'а.
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function tierLabel(tier: StorageTier): string {
  switch (tier) {
    case 'seeker':
    case 'pro': // legacy alias
      return 'Seeker';
    case 'ascended':
    case 'pro_plus': // legacy alias
      return 'Ascended';
    default:
      return 'Free';
  }
}

// ─── Archive ──────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const h: Record<string, string> = {};
  if (token) h.authorization = `Bearer ${token}`;
  // X-Device-ID — Phase C-3.1. Читаем напрямую из localStorage чтобы
  // избежать циклической зависимости (device.ts импортирует
  // registerDevice/DeviceLimitError отсюда).
  try {
    const did = window.localStorage.getItem('hone:device-id');
    if (did) h['x-device-id'] = did;
  } catch {
    /* private mode — skip */
  }
  return h;
}

/** Archives the N oldest active notes. Returns count actually archived. */
export async function archiveOldestNotes(count = 10): Promise<number> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/storage/archive/notes/oldest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ count }),
  });
  if (!resp.ok) throw new Error(`archive oldest: ${resp.status}`);
  const j = (await resp.json()) as { archived: number };
  return Number(j.archived ?? 0);
}

export async function archiveNote(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/storage/archive/note/${id}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`archive note: ${resp.status}`);
}

export async function restoreNote(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/storage/archive/note/${id}/restore`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`restore note: ${resp.status}`);
}

// ─── Quota error detection ────────────────────────────────────────────────
//
// Backend возвращает 413 Payload Too Large с body
// {error:{code:"quota_exceeded", usedBytes, quotaBytes, tier}}.
// Connect-RPC оборачивает HTTP-ошибки в ConnectError с code=resource_exhausted —
// проверяем оба варианта (REST путь и Connect путь).

export interface QuotaExceeded {
  usedBytes: number;
  quotaBytes: number;
  tier: StorageTier;
}

export function isQuotaExceeded(err: unknown): QuotaExceeded | null {
  if (!err) return null;
  const e = err as { code?: string; rawMessage?: string; message?: string };
  // Connect error → code "resource_exhausted" обычно мапится сюда
  if (e.code === 'resource_exhausted' || e.code === 'quota_exceeded') {
    return parseQuotaPayload(e.rawMessage ?? e.message ?? '');
  }
  // Fetch path: error message содержит «413»
  if ((e.message ?? '').includes('413')) {
    return { usedBytes: 0, quotaBytes: 0, tier: 'free' };
  }
  return null;
}

function parseQuotaPayload(raw: string): QuotaExceeded | null {
  try {
    const parsed = JSON.parse(raw) as { usedBytes?: number; quotaBytes?: number; tier?: string };
    return {
      usedBytes: Number(parsed.usedBytes ?? 0),
      quotaBytes: Number(parsed.quotaBytes ?? 0),
      tier: (parsed.tier as StorageTier) || 'free',
    };
  } catch {
    return { usedBytes: 0, quotaBytes: 0, tier: 'free' };
  }
}

// ─── Devices (sync foundation) ────────────────────────────────────────────

export type DevicePlatform = 'mac' | 'ios' | 'android' | 'web' | 'linux' | 'windows';

export interface Device {
  id: string;
  name: string;
  platform: DevicePlatform;
  appVersion: string;
  lastSeenAt: string;
  createdAt: string;
}

export async function registerDevice(input: {
  name: string;
  platform: DevicePlatform;
  appVersion: string;
}): Promise<Device> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/sync/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (resp.status === 409) {
    const body = await resp.json().catch(() => ({}));
    const msg = body?.error?.message ?? 'Device limit reached';
    throw new DeviceLimitError(msg);
  }
  if (!resp.ok) throw new Error(`register device: ${resp.status}`);
  return (await resp.json()) as Device;
}

export async function listDevices(): Promise<Device[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/sync/devices`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`list devices: ${resp.status}`);
  const j = (await resp.json()) as { devices: Device[] };
  return j.devices ?? [];
}

export async function revokeDevice(id: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/sync/devices/${id}/revoke`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`revoke device: ${resp.status}`);
}

/** Thrown when Free-tier hits 1-device cap. UI catches and shows upgrade. */
export class DeviceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceLimitError';
  }
}

// ─── Publish to web (Phase C-4) ───────────────────────────────────────────

export interface PublishStatus {
  published: boolean;
  slug?: string;
  url?: string;
  publishedAt?: string;
}

export async function publishNote(noteId: string): Promise<PublishStatus> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/notes/${noteId}/publish`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`publish: ${resp.status}`);
  const j = (await resp.json()) as { slug: string; url: string; publishedAt: string };
  return { published: true, slug: j.slug, url: j.url, publishedAt: j.publishedAt };
}

export async function unpublishNote(noteId: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/notes/${noteId}/unpublish`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`unpublish: ${resp.status}`);
}

export async function getPublishStatus(noteId: string): Promise<PublishStatus> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/notes/${noteId}/publish-status`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`publish status: ${resp.status}`);
  return (await resp.json()) as PublishStatus;
}

// ─── Bulk note meta (Phase C-7 follow-up) ─────────────────────────────────
//
// Возвращает per-note flags (encrypted, published) для всех active notes.
// Используется sidebar'ом для отрисовки lock-icons без N+1 hover-запросов.

export interface NoteMeta {
  id: string;
  encrypted: boolean;
  published: boolean;
}

export async function getNotesMeta(): Promise<NoteMeta[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/notes/meta`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`notes meta: ${resp.status}`);
  const j = (await resp.json()) as { notes: NoteMeta[] };
  return j.notes ?? [];
}
