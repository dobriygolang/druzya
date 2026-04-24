# Druz9 Copilot — Virtual Cursor

Design doc for the "frozen cursor for viewers" feature. **Not shipped.**
Implementation scaffold lives in `desktop/native/CursorHelper/` but is
not wired into the current build.

---

## The product promise

> When you interact with Druz9 or take an area screenshot, the viewer
> sees a frozen cursor. Toggled by `⌘⇧V` or automatically.

## The technical problem

macOS renders the cursor in the **window server** above all surfaces,
outside the reach of any BrowserWindow. Screen capture SDKs (Zoom,
Google Meet, Chrome `getDisplayMedia`) sample the system cursor each
frame independently. **We cannot directly hide our own cursor from
capture without private APIs or kernel-level hooks.**

Things that **do not work**:

| Idea | Why it fails |
|---|---|
| Hide the cursor via `NSCursor.hide()` | Hides it from the user too, not just capture. |
| Draw a fake cursor in a stealth window | Stealth window is invisible to capture; the real cursor is still drawn over it → viewer sees real cursor. |
| Overlay a transparent window with a fake cursor | Viewer sees both: real cursor plus fake overlay cursor. |
| Mask a region of the screen from capture | Requires a kernel extension or private API — not notarizable. |
| `CGDisplayShowCursor(false)` | System-wide hide; user loses their cursor too. |

What actually **could work** (all require native code):

| Approach | Notes |
|---|---|
| **Cursor warp** — move the real cursor to a "parked" position while the user interacts with Druz9 | The cursor visibly jumps, then jumps back. Keyboard-only interaction with our app while active. Clunky but honest. |
| **Private `CGSSetWindowCaptureIgnore` API** | Undocumented symbol; may be used by `NSWindowSharingNone` internally. We already use the public `setContentProtection(true)` which calls it for our window chrome. The cursor is drawn outside any window's capture graph. |
| **Screen capture filter via ScreenCaptureKit extension** | macOS 14+. An app can register a `SCContentFilter` that another capturing app may or may not honor. Zoom et al. don't use ScreenCaptureKit for our window — they use older `CGDisplayStream` directly. |
| **ExternalEvent virtual pointer** | Route a virtual pointer through the app and freeze the real cursor with `CGAssociateMouseAndMouseCursorPosition(false)`. The cursor visibly stops moving until re-associated. This is the closest to the product promise. |

**Our MVP choice:** the ExternalEvent path (cursor-freeze) via a small
Swift helper. The cursor visibly stops for the user during the
interaction window — we sell this as "Druz9 freezes your cursor to keep
your AI usage invisible" rather than hiding the fact.

---

## MVP design (ExternalEvent / cursor-freeze)

### User story

```
User presses ⌘⇧V
  → cursor freezes at its current screen position for the viewer
  → user types / drags in Druz9 via keyboard
  → user presses ⌘⇧V again, or Esc
  → cursor unfreezes and is back under user control
```

During the freeze:
- Real cursor stays at the entry position — viewer sees it static.
- User interacts with Druz9 via keyboard-only.
- Our stealth windows are already hidden from capture, so the viewer
  sees just a frozen cursor on the application they were sharing.

### Why this is acceptable product behavior

It doesn't decouple the user's interaction from the cursor position —
that is physically impossible without private APIs. But it does remove
the **cursor movement pattern** that reads as "I'm interacting with a
hidden app" to an observant viewer. Combined with our stealthed
windows, the viewer's experience is "cursor stopped for 8 seconds,
then resumed" — which fits a hundred benign narratives.

### Components

```
desktop/
├── native/
│   └── CursorHelper/
│       ├── Package.swift
│       ├── Sources/
│       │   └── CursorHelper/
│       │       └── main.swift          # the binary
│       └── README.md                   # build instructions
└── src/main/
    └── cursor/
        └── freeze-bridge.ts            # spawns CursorHelper, IPC over pipes
```

The Swift helper is a single-executable Swift Package. It reads
commands on stdin (`freeze\n`, `thaw\n`, `quit\n`) and reports state
on stdout (`frozen\n`, `thawed\n`).

Main process spawns the helper as a child process at app start and
communicates over pipes. No socket, no SwiftUI — just CoreGraphics.

### Freeze / thaw core

```swift
import CoreGraphics

func freeze() {
  let (x, y) = currentCursorPoint()
  // Detach the cursor from mouse movement. The mouse is still tracked
  // internally (clicks still register where the user moves to) but
  // the cursor pixel stops moving.
  CGAssociateMouseAndMouseCursorPosition(0)
  CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
}

func thaw() {
  CGAssociateMouseAndMouseCursorPosition(1)
}
```

Caveat: `CGAssociateMouseAndMouseCursorPosition(0)` affects system
state. If the helper crashes mid-freeze, the cursor stays stuck. The
helper installs a `signal(SIGTERM)` / `atexit` handler that force-thaws
before dying. Main process sends `quit\n` on app shutdown.

### IPC from Electron

```ts
// main/cursor/freeze-bridge.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

let proc: ChildProcessWithoutNullStreams | null = null;

export function ensureSpawned(binPath: string): void {
  if (proc) return;
  proc = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  proc.on('exit', () => { proc = null; });
}

export function freeze(): void {
  proc?.stdin.write('freeze\n');
}
export function thaw(): void {
  proc?.stdin.write('thaw\n');
}
```

Hotkey `voice_input` (⌘⇧V) reuses the existing global shortcut
registry — when fired, the main process calls `freeze()` if the
cursor is currently thawed, `thaw()` otherwise. The renderer receives
an event so the compact-window status bar shows "cursor frozen".

### Signing & distribution

The helper is a separate Mach-O binary. electron-builder bundles it
into `Resources/native/CursorHelper` and we need an entitlements file
allowing `com.apple.security.cs.disable-library-validation` (already
set on the main app). The helper itself needs:

```xml
<key>com.apple.security.automation.apple-events</key>
<true/>
```

No special notarization steps beyond signing it with the same
Developer ID as the main app.

### Failure modes

| Failure | Symptom | Mitigation |
|---|---|---|
| Helper crashes mid-freeze | cursor stuck | signal handler thaws on SIGTERM / atexit |
| Helper fails to spawn | hotkey does nothing | renderer shows "virtual cursor unavailable" warning once |
| User loses keyboard focus to a different app | their keystrokes go elsewhere | Druz9 windows grab focus on freeze entry; we accept the UX trade-off |

---

## Implementation status

- **Not shipped.** Compact window `⌘⇧V` currently activates voice
  input, not cursor-freeze.
- **Scaffold exists:** `desktop/native/CursorHelper/` with `Package.swift`,
  `main.swift` implementing the stdin-command loop.
- **Bridge stub:** `desktop/src/main/cursor/freeze-bridge.ts` ready
  for wiring once the helper binary is built and notarized.
- **Gatekeeping:** we deliberately keep ⌘⇧V bound to voice until the
  helper has real testing on Zoom/Meet. Rebind in
  `DesktopConfig.DefaultHotkeys` and the `applyBindings` call in
  `main/index.ts`.

### How to finish it

1. From `desktop/native/CursorHelper/`:
   ```bash
   swift build -c release
   ```
   Binary lands at `.build/release/CursorHelper`.
2. Copy it into `desktop/resources/native/CursorHelper` before
   `electron-builder` runs.
3. Add an `extraResources` entry in `electron-builder.yml`:
   ```yaml
   extraResources:
     - from: resources/native
       to: native
   ```
4. In `main/index.ts`, after app-ready:
   ```ts
   const helper = join(process.resourcesPath, 'native/CursorHelper');
   ensureSpawned(helper);
   ```
5. Add a new hotkey action `cursor_freeze_toggle`, bind it to `⌘⇧V`
   in `DefaultHotkeys`, and move voice input to another chord (e.g.
   `⌘⇧.`).
6. Smoke-test on Zoom screen-share.

---

## Why we're deferring

- Requires signed native code — we can't dev-iterate without at least
  an ad-hoc signing setup.
- Smoke-testing is manual and must happen on each macOS minor version
  (cursor-freeze semantics changed between Big Sur and Sonoma).
- The voice-input BYOK feature already occupies ⌘⇧V and is shipped.
  Reclaiming that chord is a user-visible change we want to bundle
  with cursor-freeze, not slip in piecemeal.

When we ship, this doc becomes the reference.
