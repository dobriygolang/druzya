// NotesService — persists meeting notes locally after a session ends.
//
// Abstraction seam: swap `writeLocalNotes` for a POST /api/notes call
// and Hone/backend integration becomes a one-liner — everything above
// this layer (manager.ts, handlers.ts) stays unchanged.

import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionAnalysis } from '@shared/types';

export interface SavedNotes {
  filePath: string;
  sessionId: string;
}

export async function saveNotes(analysis: SessionAnalysis): Promise<SavedNotes> {
  const dir = join(app.getPath('userData'), 'notes');
  await mkdir(dir, { recursive: true });

  const slug = analysis.sessionId.slice(0, 8);
  const dateStr = new Date(analysis.startedAt || Date.now()).toISOString().slice(0, 10);
  const filename = `${dateStr}_${slug}.json`;
  const filePath = join(dir, filename);

  await writeFile(filePath, JSON.stringify(analysis, null, 2), 'utf-8');

  // --- Future backend swap ---
  // await apiClient.post('/api/notes', analysis);
  // ----------------------------

  return { filePath, sessionId: analysis.sessionId };
}

export function notesDir(): string {
  return join(app.getPath('userData'), 'notes');
}
