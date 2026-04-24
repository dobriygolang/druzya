// Main-process bridge to the CursorHelper Swift binary. Not wired up
// in the current build — the scaffold is here so when we finish the
// virtual-cursor feature, the glue code is obvious.
//
// See docs/copilot-virtual-cursor.md for the full design.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';

type State = 'thawed' | 'frozen' | 'unavailable';

interface Bridge {
  ensureSpawned: (binPath: string) => void;
  freeze: () => void;
  thaw: () => void;
  toggle: () => State;
  state: () => State;
  shutdown: () => void;
}

let proc: ChildProcessWithoutNullStreams | null = null;
let state: State = 'thawed';
let ready = false;

/**
 * Spawn the helper if it exists and has not been spawned yet. Silent
 * no-op when the binary is missing (e.g. in dev builds that skip the
 * Swift build step).
 */
function ensureSpawned(binPath: string): void {
  if (proc || !existsSync(binPath)) {
    if (!proc && !existsSync(binPath)) state = 'unavailable';
    return;
  }
  proc = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  proc.stdout.setEncoding('utf8');
  let buffer = '';
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
      handleHelperLine(line);
    }
  });
  proc.on('exit', () => {
    proc = null;
    ready = false;
    // If the helper dies while we thought we were frozen, the OS will
    // still be associated because our atexit + signal handlers on the
    // Swift side force-reassociate. Reflect that in our state too.
    state = 'thawed';
  });
}

function handleHelperLine(line: string): void {
  if (line === 'ready') {
    ready = true;
    return;
  }
  if (line === 'frozen') {
    state = 'frozen';
    return;
  }
  if (line === 'thawed') {
    state = 'thawed';
    return;
  }
  if (line.startsWith('error:')) {
    // eslint-disable-next-line no-console
    console.error('CursorHelper:', line);
  }
}

function send(cmd: 'freeze' | 'thaw' | 'quit'): void {
  if (!proc || !ready) return;
  try {
    proc.stdin.write(`${cmd}\n`);
  } catch {
    /* pipe closed — helper is gone, state will reset via exit handler */
  }
}

function freeze(): void {
  send('freeze');
}
function thaw(): void {
  send('thaw');
}
function toggle(): State {
  if (state === 'unavailable') return state;
  if (state === 'frozen') thaw();
  else freeze();
  return state;
}

function shutdown(): void {
  send('quit');
  // Give the helper a tiny window to thaw cleanly; then kill if needed.
  setTimeout(() => {
    proc?.kill('SIGTERM');
  }, 200);
}

export const cursorBridge: Bridge = {
  ensureSpawned,
  freeze,
  thaw,
  toggle,
  state: () => state,
  shutdown,
};
