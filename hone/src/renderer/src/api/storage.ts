// storage.ts — Phase C storage quota client.
//
// Бэкенд: GET /api/v1/storage/quota → {usedBytes, quotaBytes, tier}.
// Этот endpoint — плоский REST (не Connect-RPC), потому что storage
// service не имеет proto schema'ы и оборачивать его ради одного reader'а
// несоразмерно. Используем bare fetch с тем же bearer'ом.
import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

export type StorageTier = 'free' | 'pro' | 'pro_plus';

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
    tier: (j.tier as StorageTier) || 'free',
  };
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
    case 'pro':
      return 'Pro';
    case 'pro_plus':
      return 'Pro+';
    default:
      return 'Free';
  }
}
