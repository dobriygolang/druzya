// Pure-JS cursor freeze without a Swift helper.
//
// Honest caveats before diving in:
//   - macOS draws the system cursor in a compositor layer that our
//     Electron windows do not own. We CANNOT hide the cursor from
//     screen capture without private APIs.
//   - What we CAN do: detach the cursor from mouse motion by repeatedly
//     warping it back to a "parked" position. The viewer sees a cursor
//     that does not move while the user types. Same effective UX as
//     CGAssociateMouseAndMouseCursorPosition(0) in the Swift path.
//
// How it works:
//   - On freeze(): record the current mouse position and start a 60Hz
//     loop that warps the cursor back to that position each tick.
//   - On thaw(): clear the loop.
//
// The loop-based approach has a visible jitter on fast mouse movement
// (cursor tries to escape the parked spot, we yank it back every 16ms),
// which is intentional — it makes the freeze state visually obvious so
// the user knows when they're "in Druz9 mode" vs "mouse mode".
//
// Dependency strategy: we dynamic-import the native mouse-control
// module at first-use. If it's missing (user skipped `npm i robotjs`)
// the feature stays disabled and the rest of the app keeps working.
// This avoids a hard crash on a broken install.

import { screen } from 'electron';

type LibnutLike = {
  moveMouse: (x: number, y: number) => void;
  getMousePos: () => { x: number; y: number };
};

type State = 'thawed' | 'frozen' | 'unavailable';

let lib: LibnutLike | null = null;
let libTried = false;
let state: State = 'thawed';
let tickHandle: ReturnType<typeof setInterval> | null = null;
let parked: { x: number; y: number } | null = null;

/**
 * Attempt to load a native mouse-control module. We try three names in
 * order — whichever the user installed wins. None of them required:
 * the feature just disables itself when nothing is present.
 */
async function loadLib(): Promise<LibnutLike | null> {
  if (libTried) return lib;
  libTried = true;
  const candidates = ['@nut-tree-fork/libnut', '@nut-tree/libnut', 'robotjs'] as const;
  for (const name of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(name);
      const m = (mod?.default ?? mod) as Partial<LibnutLike>;
      if (typeof m.moveMouse === 'function' && typeof m.getMousePos === 'function') {
        lib = m as LibnutLike;
        return lib;
      }
    } catch {
      /* not installed — try the next candidate */
    }
  }
  state = 'unavailable';
  return null;
}

export async function freeze(): Promise<State> {
  const m = await loadLib();
  if (!m) return 'unavailable';
  if (state === 'frozen') return state;

  parked = m.getMousePos();
  // 60Hz is smooth enough that the viewer never sees the cursor drift.
  // A higher rate would burn CPU; a lower rate reveals the jitter.
  tickHandle = setInterval(() => {
    if (!parked) return;
    try {
      m.moveMouse(parked.x, parked.y);
    } catch {
      /* ignore single-frame failures; continue parking */
    }
  }, 16);
  state = 'frozen';
  return state;
}

export function thaw(): State {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  parked = null;
  if (state === 'frozen') state = 'thawed';
  return state;
}

export async function toggle(): Promise<State> {
  if (state === 'unavailable') return state;
  if (state === 'frozen') return thaw();
  return freeze();
}

/** Move the parked point to the current screen corner. Useful when the
 *  user wants the visible cursor to sit somewhere neutral (e.g. a
 *  task-bar icon) rather than where they happened to hover on entry. */
export function parkAtCorner(): void {
  if (state !== 'frozen' || !lib) return;
  const primary = screen.getPrimaryDisplay().workArea;
  parked = { x: primary.x + 8, y: primary.y + 8 };
  lib.moveMouse(parked.x, parked.y);
}

export function currentState(): State {
  return state;
}

/**
 * Called on app shutdown. If we die while frozen the parked cursor
 * stays where we last set it — which is the same place the user
 * intended, so no restoration needed.
 */
export function shutdown(): void {
  thaw();
}
