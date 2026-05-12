// freeze.test.ts — covers the cursor freeze/thaw IPC bridge.
//
// Why test it: when freeze fails silently (helper binary missing OR pipe
// crashes mid-flight) the area-overlay still draws stealth UI, но system
// cursor продолжает двигаться по экрану — viewers of the screen share
// видят "ghost cursor moving by itself" даже когда сам overlay invisible.
// Это immediately blows стelth illusion.
//
// Two bridges:
//   • freeze-bridge.ts — spawns Swift CursorHelper (uses
//     CGAssociateMouseAndMouseCursorPosition; OS-level cursor freeze).
//   • freeze-js.ts — pure-JS fallback when CursorHelper missing
//     (loop-warps cursor via libnut/robotjs).
//
// Both should:
//   1. Cleanly transition state machine: thawed → frozen → thawed
//   2. Return 'unavailable' when their backing helper / native module missing
//   3. Survive helper death without crashing the renderer
//
// freeze-bridge spawn — we don't spawn the real Swift binary in tests.
// Instead we mock node:child_process.spawn to return a fake stdin pipe
// we can assert against.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// ─── child_process.spawn mock ───────────────────────────────────────────
// We capture stdin writes (the IPC protocol — `freeze\n` / `thaw\n` /
// `quit\n`) and emulate stdout responses (`ready\n` / `frozen\n` / `thawed\n`).
function makeFakeProc() {
  const stdinChunks: string[] = [];
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinChunks.push(chunk.toString());
      cb();
    },
  });
  const stdout = new Readable({ read() {} });
  const proc = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    kill: (sig?: string) => void;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.kill = vi.fn();
  // Helper to push a line FROM the helper.
  const pushLine = (line: string) => stdout.push(`${line}\n`);
  return { proc, stdinChunks, pushLine };
}

const fakeProcRef: { current: ReturnType<typeof makeFakeProc> | null } = {
  current: null,
};

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  );
  const spawn = vi.fn(() => {
    const fake = makeFakeProc();
    fakeProcRef.current = fake;
    return fake.proc;
  });
  return {
    ...actual,
    spawn,
    default: { ...actual, spawn },
  };
});

// Module-level toggle for existsSync — flip from a test to drive the
// «missing binary» branch.
const fsExistsSyncToggle = { value: true };
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const existsSync = vi.fn(() => fsExistsSyncToggle.value);
  return {
    ...actual,
    existsSync,
    default: { ...actual, existsSync },
  };
});

beforeEach(() => {
  fakeProcRef.current = null;
  fsExistsSyncToggle.value = true;
  vi.resetModules();
});

describe('cursorBridge — Swift helper protocol', () => {
  it('starts in thawed state when bin exists', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    expect(cursorBridge.state()).toBe('thawed');
  });

  it('marks unavailable when binary missing', async () => {
    fsExistsSyncToggle.value = false;
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/missing/CursorHelper');
    expect(cursorBridge.state()).toBe('unavailable');
  });

  it('does not send commands before helper signals ready', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    cursorBridge.freeze(); // helper hasn't said `ready\n` yet
    expect(fakeProcRef.current?.stdinChunks).toEqual([]);
  });

  it('sends freeze\\n and thaw\\n once helper is ready', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    const fake = fakeProcRef.current!;
    // Simulate helper handshake.
    fake.pushLine('ready');
    // Microtask flush — stdout events are async.
    await new Promise((r) => setImmediate(r));

    cursorBridge.freeze();
    cursorBridge.thaw();
    expect(fake.stdinChunks).toEqual(['freeze\n', 'thaw\n']);
  });

  it('reflects helper state lines in cursorBridge.state()', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    const fake = fakeProcRef.current!;
    fake.pushLine('ready');
    await new Promise((r) => setImmediate(r));
    expect(cursorBridge.state()).toBe('thawed');

    fake.pushLine('frozen');
    await new Promise((r) => setImmediate(r));
    expect(cursorBridge.state()).toBe('frozen');

    fake.pushLine('thawed');
    await new Promise((r) => setImmediate(r));
    expect(cursorBridge.state()).toBe('thawed');
  });

  it('recovers to thawed on helper death (proc exit) — no stuck frozen state', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    const fake = fakeProcRef.current!;
    fake.pushLine('ready');
    fake.pushLine('frozen');
    await new Promise((r) => setImmediate(r));
    expect(cursorBridge.state()).toBe('frozen');

    fake.proc.emit('exit', 1, null);
    expect(cursorBridge.state()).toBe('thawed');
  });

  it('toggle from thawed sends freeze; toggle from frozen sends thaw', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    const fake = fakeProcRef.current!;
    fake.pushLine('ready');
    await new Promise((r) => setImmediate(r));

    cursorBridge.toggle();
    expect(fake.stdinChunks).toContain('freeze\n');

    // Move to frozen state via helper line.
    fake.pushLine('frozen');
    await new Promise((r) => setImmediate(r));
    cursorBridge.toggle();
    expect(fake.stdinChunks).toContain('thaw\n');
  });

  it('shutdown writes quit\\n', async () => {
    const { cursorBridge } = await import('../freeze-bridge');
    cursorBridge.ensureSpawned('/fake/CursorHelper');
    const fake = fakeProcRef.current!;
    fake.pushLine('ready');
    await new Promise((r) => setImmediate(r));

    cursorBridge.shutdown();
    expect(fake.stdinChunks).toContain('quit\n');
  });
});

// ─── freeze-js.ts (pure-JS fallback) ─────────────────────────────────────
// Path is short-circuited когда optional native dep missing — verify
// `unavailable` state returns instead of throw.

describe('freeze-js — fallback semantics', () => {
  it('returns unavailable when no mouse-control native module installed', async () => {
    // freeze-js dynamic-imports @nut-tree-fork/libnut etc. In test environment
    // packages may exist but be non-functional; we just verify the API
    // doesn't crash and returns a State value.
    const mod = await import('../freeze-js');
    const state = await mod.freeze();
    expect(['thawed', 'frozen', 'unavailable']).toContain(state);
    if (state !== 'unavailable') {
      // Make sure thaw resets cleanly when we did acquire a lib.
      expect(mod.thaw()).toBe('thawed');
    }
  });

  it('shutdown is idempotent', async () => {
    const mod = await import('../freeze-js');
    expect(() => mod.shutdown()).not.toThrow();
    expect(() => mod.shutdown()).not.toThrow();
  });
});
