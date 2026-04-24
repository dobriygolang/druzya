// Thin wrapper around ipcMain.handle that runs a zod schema against the
// incoming payload before calling the real handler. Keeps validation
// ergonomic (one line per channel) and puts all rejection handling in one
// place — so a renderer bug that ships malformed input fails loudly at the
// IPC boundary instead of deep inside a handler where the stack trace is
// cryptic.

import { ipcMain } from 'electron';
import type { z, ZodTypeAny } from 'zod';

/**
 * Validate a fire-and-forget `send` channel (renderer → main, no reply).
 * On parse failure the message is dropped with a console warning — throwing
 * would only bubble into Electron's own uncaughtException handler since
 * nobody is awaiting the send on the renderer side.
 */
export function onIn<S extends ZodTypeAny>(
  channel: string,
  schema: S,
  fn: (payload: z.infer<S>) => void,
): void {
  ipcMain.on(channel, (_evt, payload: unknown) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? first.path.join('.') : '<root>';
      // eslint-disable-next-line no-console
      console.warn(`IPC ${channel}: dropped (invalid payload at ${where}: ${first?.message})`);
      return;
    }
    fn(parsed.data);
  });
}

/**
 * Register an invoke handler whose single payload is validated by `schema`.
 * On parse failure the handler throws, which Connect/Electron surfaces to
 * the renderer as a rejected promise — the renderer-side wrapper in
 * `window.druz9.*` already awaits, so the caller gets a clean rejection.
 *
 * Use for channels where the renderer supplies the shape (user input,
 * drag rects, hotkey bindings). Handlers that take no payload — or payloads
 * we trust because they originate from main itself — stay on plain
 * `ipcMain.handle`.
 */
export function handleIn<S extends ZodTypeAny, R>(
  channel: string,
  schema: S,
  fn: (payload: z.infer<S>) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_evt, payload: unknown) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // Surface the first issue path — zod's full error object is noisy
      // and the renderer only needs enough to log/triage.
      const first = parsed.error.issues[0];
      const where = first?.path.length ? first.path.join('.') : '<root>';
      throw new Error(`IPC ${channel}: invalid payload at ${where}: ${first?.message ?? 'unknown'}`);
    }
    return fn(parsed.data);
  });
}

/**
 * Variant for handlers whose payload is a tuple `(a, b, ...)` of positional
 * args. Electron allows multiple args after the event; we validate them
 * together as an array so the schema stays one zod object per channel.
 *
 * Example:
 *   handleInTuple(ch.sessionList, z.tuple([z.string(), z.number()]), ([c, n]) => ...)
 */
export function handleInTuple<S extends ZodTypeAny, R>(
  channel: string,
  schema: S,
  fn: (args: z.infer<S>) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (_evt, ...args: unknown[]) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const where = first?.path.length ? first.path.join('.') : '<root>';
      throw new Error(`IPC ${channel}: invalid payload at ${where}: ${first?.message ?? 'unknown'}`);
    }
    return fn(parsed.data);
  });
}
