// deeplink.ts — Hone druz9:// intent router (X5 Phase J P2 2026-05-12).
//
// Previously deep-link parsing lived inline in hone/src/main/index.ts as a
// chain of `if (url.startsWith('druz9://auth')) {…}`. X5 (bidirectional
// cross-product handoff) added enough new intents — focus.start with goal,
// task.open, note.open, coach.open, english.exercise — that the inline chain
// became unreadable and easy to break.
//
// This module centralises:
//   1. parseDeepLink(url) — pure URL → typed Intent | null. Easy to unit-test.
//   2. dispatchIntent(intent, ctx) — side-effects (file read, IPC broadcast,
//      keychain write). Takes a context object so we don't have to import the
//      mutable main-process state directly.
//
// Scheme `druz9://` is owned by Hone. Cue owns `druz9-cue://`. Don't change
// these — they're registered with the OS via electron-builder.yml and
// changing the scheme breaks installed apps.
//
// Intent contract (also documented in CLAUDE.md / docs/tech/conventions.md):
//
//   druz9://auth?token=…&refresh=…&user=…&exp=…    → AuthIntent
//   druz9://notes/import?path=<base64>             → NoteImportIntent (F10 Cue→Hone)
//   druz9://focus[.start]?goal=…&duration=…        → FocusStartIntent (X5)
//   druz9://focus.start?task=<id>&title=<urlenc>   → FocusStartIntent (existing pinned)
//   druz9://task.open?id=<task-id>                 → TaskOpenIntent (X5)
//   druz9://note.open?id=<note-id>                 → NoteOpenIntent (X5)
//   druz9://coach.open[?topic=mock-reflection]     → CoachOpenIntent (X5)
//   druz9://english.exercise?id=…&modality=…       → EnglishExerciseIntent (X5)
//
// Attribution: every web→hone deeplink carries `?source=web_*` for analytics
// (see frontend/src/lib/hone-handoff.ts buildURL). The router forwards source
// in the dispatched event so renderer analytics can fire follow-up tracks.

import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import type { BrowserWindow } from 'electron';

import { eventChannels, type AuthSession } from '@shared/ipc';
import { saveSession } from '../keychain';

/** Closed union of recognised intents. Unknown intents return null. */
export type DeepLinkIntent =
  | { kind: 'auth'; session: AuthSession }
  | { kind: 'note.import'; filePath: string; source?: string }
  | { kind: 'focus.start'; goal?: string; mode?: string; duration?: number; task?: string; title?: string; source?: string }
  | { kind: 'task.open'; taskId: string; source?: string }
  | { kind: 'note.open'; noteId: string; source?: string }
  | { kind: 'coach.open'; topic?: string; source?: string }
  | { kind: 'english.exercise'; exerciseId: string; modality?: string; source?: string }
  | { kind: 'generic'; url: string };

/** Dispatch context — DI'd from main-process so the router stays testable. */
export interface DispatchContext {
  window: BrowserWindow | null;
}

/**
 * Pure URL → Intent. Returns null when:
 *   • not a `druz9://` URL
 *   • known prefix but malformed payload (missing required params)
 *
 * Generic «unknown druz9:// URL» falls through to caller as kind='generic'
 * so renderer can decide whether to ignore or show an error.
 */
export function parseDeepLink(raw: string): DeepLinkIntent | null {
  if (!raw.startsWith('druz9://')) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'druz9:') return null;

  // URL parses `druz9://foo/bar?x=1` as host='foo', pathname='/bar' on most
  // platforms; but `druz9://foo.bar` becomes host='foo.bar', pathname=''.
  // We accept both shapes for «namespace.action» style to keep the contract
  // stable across older callers (`druz9://focus/start`) and new dot-notation.
  const host = u.host.toLowerCase();
  const path = u.pathname.replace(/^\/+/, '').toLowerCase();
  const route = path ? `${host}/${path}` : host;
  const source = u.searchParams.get('source') ?? undefined;

  // auth — existing
  if (host === 'auth') {
    const token = u.searchParams.get('token');
    const userId = u.searchParams.get('user');
    if (!token || !userId) return null;
    const session: AuthSession = {
      userId,
      accessToken: token,
      refreshToken: u.searchParams.get('refresh') ?? '',
      expiresAt: Number(u.searchParams.get('exp') ?? 0),
    };
    return { kind: 'auth', session };
  }

  // notes/import — existing F10 (Cue → Hone)
  if (route === 'notes/import') {
    const encoded = u.searchParams.get('path');
    if (!encoded) return null;
    let filePath: string;
    try {
      filePath = Buffer.from(encoded, 'base64').toString('utf-8');
    } catch {
      return null;
    }
    return { kind: 'note.import', filePath, source };
  }

  // focus.start / focus / focus/start — existing + X5
  if (host === 'focus' || route === 'focus/start' || host === 'focus.start') {
    const duration = parseIntSafe(u.searchParams.get('duration'));
    return {
      kind: 'focus.start',
      goal: u.searchParams.get('goal') ?? undefined,
      mode: u.searchParams.get('mode') ?? undefined,
      duration: duration ?? undefined,
      task: u.searchParams.get('task') ?? undefined,
      title: u.searchParams.get('title') ?? undefined,
      source,
    };
  }

  // task.open — X5
  if (host === 'task.open' || route === 'task/open') {
    const taskId = u.searchParams.get('id') ?? u.searchParams.get('task');
    if (!taskId) return null;
    return { kind: 'task.open', taskId, source };
  }

  // note.open — X5
  if (host === 'note.open' || route === 'note/open') {
    const noteId = u.searchParams.get('id') ?? u.searchParams.get('note');
    if (!noteId) return null;
    return { kind: 'note.open', noteId, source };
  }

  // coach.open — X5
  if (host === 'coach.open' || route === 'coach/open' || host === 'coach') {
    return {
      kind: 'coach.open',
      topic: u.searchParams.get('topic') ?? undefined,
      source,
    };
  }

  // english.exercise — X5
  if (host === 'english.exercise' || route === 'english/exercise') {
    const exerciseId = u.searchParams.get('id') ?? u.searchParams.get('exercise');
    if (!exerciseId) return null;
    return {
      kind: 'english.exercise',
      exerciseId,
      modality: u.searchParams.get('modality') ?? undefined,
      source,
    };
  }

  // Fallback — unknown but well-formed druz9:// URL. Forward to renderer.
  return { kind: 'generic', url: raw };
}

/**
 * Side-effect dispatcher. Calls into keychain / file-system / IPC depending
 * on intent kind. Pure URL parsing lives in parseDeepLink — this function
 * is the only place that talks to electron.
 *
 * All branches focus the window after dispatch so the user lands on Hone
 * after clicking a deeplink in their browser.
 */
export async function dispatchIntent(intent: DeepLinkIntent, ctx: DispatchContext): Promise<void> {
  const win = ctx.window;
  if (!win || win.isDestroyed()) return;

  switch (intent.kind) {
    case 'auth': {
      // Persist + broadcast. Failure non-fatal: renderer still gets the
      // event and can run the session until next restart.
      try {
        await saveSession(intent.session);
      } catch {
        /* swallow — see existing pattern in index.ts */
      }
      win.webContents.send(eventChannels.authChanged, intent.session);
      break;
    }
    case 'note.import': {
      // Read the analysis file produced by Cue and forward to renderer.
      try {
        const raw = await readFile(intent.filePath, 'utf-8');
        const analysis = JSON.parse(raw) as unknown;
        win.webContents.send(eventChannels.cueNoteImport, {
          filePath: intent.filePath,
          analysis,
        });
      } catch {
        // Fall through to generic so renderer can show «import failed».
        win.webContents.send(eventChannels.deepLink, {
          url: `druz9://notes/import?path=${Buffer.from(intent.filePath).toString('base64')}`,
        });
      }
      break;
    }
    // For all other intents we forward via the generic deepLink channel —
    // renderer already subscribes to that channel and routes intents into
    // the right surface (Coach / Notes / TaskBoard / Today). Keeping a
    // single channel avoids preload-bridge churn; the renderer-side router
    // dispatches based on the URL it received.
    case 'focus.start':
    case 'task.open':
    case 'note.open':
    case 'coach.open':
    case 'english.exercise':
    case 'generic': {
      const url = intent.kind === 'generic' ? intent.url : encodeIntent(intent);
      win.webContents.send(eventChannels.deepLink, { url });
      break;
    }
  }

  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Encode a typed Intent back into a `druz9://` URL so the renderer-side
 * router can re-parse with the same parseDeepLink logic. This keeps the
 * IPC payload string-only and round-trippable.
 *
 * Used only for non-auth / non-import intents — those have their own
 * dedicated channels with structured payloads.
 */
function encodeIntent(intent: DeepLinkIntent): string {
  const params = new URLSearchParams();
  const push = (k: string, v: string | number | undefined): void => {
    if (v === undefined || v === null) return;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) params.set(k, String(v));
      return;
    }
    if (v.length > 0) params.set(k, v);
  };
  switch (intent.kind) {
    case 'focus.start': {
      push('goal', intent.goal);
      push('mode', intent.mode);
      push('duration', intent.duration);
      push('task', intent.task);
      push('title', intent.title);
      push('source', intent.source);
      const qs = params.toString();
      return `druz9://focus.start${qs ? `?${qs}` : ''}`;
    }
    case 'task.open':
      push('id', intent.taskId);
      push('source', intent.source);
      return `druz9://task.open?${params.toString()}`;
    case 'note.open':
      push('id', intent.noteId);
      push('source', intent.source);
      return `druz9://note.open?${params.toString()}`;
    case 'coach.open':
      push('topic', intent.topic);
      push('source', intent.source);
      return `druz9://coach.open${params.toString() ? `?${params.toString()}` : ''}`;
    case 'english.exercise':
      push('id', intent.exerciseId);
      push('modality', intent.modality);
      push('source', intent.source);
      return `druz9://english.exercise?${params.toString()}`;
    default:
      return 'druz9://';
  }
}

function parseIntSafe(s: string | null): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
