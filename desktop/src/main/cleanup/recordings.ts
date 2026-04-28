// recordings.ts — boot-time cleanup for audio recording chunks.
//
// AudioCaptureMac writes every transcription chunk to
//   userData/recordings/<source>/meeting-<ts>/chunk-XXXX.wav
// These accumulate indefinitely. On daily Cue usage that's ~100-300 MB/week.
// We delete meeting dirs older than MAX_AGE_DAYS on each boot — silent,
// best-effort (errors are logged but never surface to the user).

import { rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function cleanupOldRecordings(): Promise<void> {
  const root = join(app.getPath('userData'), 'recordings');
  const now = Date.now();

  let sourceDirs: string[];
  try {
    sourceDirs = await readdir(root);
  } catch {
    return; // recordings/ doesn't exist yet — first boot, nothing to clean.
  }

  for (const source of sourceDirs) {
    const sourcePath = join(root, source);
    let meetingDirs: string[];
    try {
      meetingDirs = await readdir(sourcePath);
    } catch {
      continue;
    }

    for (const meeting of meetingDirs) {
      const meetingPath = join(sourcePath, meeting);
      try {
        const s = await stat(meetingPath);
        if (now - s.mtimeMs > MAX_AGE_MS) {
          await rm(meetingPath, { recursive: true, force: true });
          console.log(`[cleanup] removed old recording dir: ${meetingPath}`);
        }
      } catch {
        // stat or rm failed (permission, concurrent deletion, etc.) — skip.
      }
    }
  }
}
