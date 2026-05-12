// Auto-update via electron-updater.
//
// Philosophy: quiet. We check on app-ready and then every hour, download
// in the background, and only prompt the user once the update is fully
// ready to install. Restart happens when the user clicks "Update now"
// in the Settings → About tab (or the banner in compact, Phase 6+).
//
// The feed URL is server-driven: DesktopConfig.UpdateFeedURL. If it's
// empty, the updater stays silent — users get no "update failed" noise
// on local dev builds that have no feed.

import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { app } from 'electron';

import { eventChannels } from '@shared/ipc';
import { broadcast } from '../windows/window-manager';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string; releaseNotes?: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

let current: UpdateStatus = { kind: 'idle' };
let wired = false;

export function getStatus(): UpdateStatus {
  return current;
}

/**
 * Wire up electron-updater and kick off the first check. Idempotent —
 * safe to call on every DesktopConfig refresh as long as the feedURL
 * hasn't changed.
 */
export function wireAutoUpdate(feedURL: string): void {
  if (wired) return;
  if (!feedURL) {
    // Silently disabled — no feed yet, nothing to check.
    return;
  }
  if (!app.isPackaged) {
    // electron-updater refuses to run in dev; don't spam the console.
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // prompt to install instead

  // Generic provider — JSON manifest at <feedURL>/latest-mac.yml. Other
  // providers (github, s3) can be plugged in here.
  autoUpdater.setFeedURL({ provider: 'generic', url: feedURL });

  autoUpdater.logger = {
    info: () => {},
    warn: (m: unknown) => console.warn('updater:', m),
    error: (m: unknown) => console.error('updater:', m),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    current = { kind: 'checking' };
    broadcast(eventChannels.updateStatus, current);
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    current = {
      kind: 'available',
      version: info.version,
      releaseNotes: asString(info.releaseNotes),
    };
    broadcast(eventChannels.updateStatus, current);
  });
  autoUpdater.on('update-not-available', () => {
    current = { kind: 'not-available' };
    broadcast(eventChannels.updateStatus, current);
  });
  autoUpdater.on('download-progress', (p) => {
    current = { kind: 'downloading', percent: Math.round(p.percent) };
    broadcast(eventChannels.updateStatus, current);
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    current = {
      kind: 'ready',
      version: info.version,
      releaseNotes: asString(info.releaseNotes),
    };
    broadcast(eventChannels.updateStatus, current);
  });
  autoUpdater.on('error', (err) => {
    current = { kind: 'error', message: (err as Error).message };
    broadcast(eventChannels.updateStatus, current);
  });

  wired = true;
  // First check right after the user's onboarding noise settles.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      /* surfaced via the 'error' handler above */
    });
  }, 10_000);
  // Thereafter every hour.
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }, 60 * 60 * 1000);
}

export async function checkNow(): Promise<UpdateStatus> {
  if (!wired) return { kind: 'idle' };
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    current = { kind: 'error', message: (err as Error).message };
  }
  return current;
}

export function installNow(): void {
  if (current.kind !== 'ready') return;
  // true, true = isSilent, isForceRunAfter.
  autoUpdater.quitAndInstall(false, true);
}

// electron-updater types releaseNotes as string | ReleaseNoteInfo[] | null.
function asString(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (!notes) return undefined;
  if (typeof notes === 'string') return notes;
  return notes.map((n) => n.note ?? '').join('\n\n');
}
