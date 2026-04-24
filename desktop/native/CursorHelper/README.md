# CursorHelper

Tiny Swift binary that freezes / thaws the macOS system cursor on
command from the Electron main process. See
[docs/copilot-virtual-cursor.md](../../../docs/copilot-virtual-cursor.md)
for the full design and the reason we need a native helper at all.

## Build

```bash
cd desktop/native/CursorHelper
swift build -c release
# → .build/release/CursorHelper
```

The binary is ~150 KB. It has zero dependencies beyond the macOS
frameworks shipped with Xcode (CoreGraphics, Foundation).

## Smoke-test manually

```bash
./.build/release/CursorHelper
# > ready
freeze
# > frozen  (cursor should stop following your mouse)
thaw
# > thawed  (cursor resumes)
quit
```

## Bundle with Electron

Copy the release binary into `desktop/resources/native/` before running
`electron-builder`:

```bash
make -C desktop cursor-helper-build
cp desktop/native/CursorHelper/.build/release/CursorHelper desktop/resources/native/
```

`electron-builder.yml` must have:

```yaml
extraResources:
  - from: resources/native
    to: native
```

At runtime the binary resolves to `process.resourcesPath + '/native/CursorHelper'`.

## Signing

Each Mach-O binary distributed inside the app bundle must be
codesigned with the same Developer ID as the main app. electron-builder
handles this automatically for everything in `extraResources` **if**
`hardenedRuntime: true` and the entitlements include:

```xml
<key>com.apple.security.automation.apple-events</key>
<true/>
```

(already set in `resources/entitlements.mac.plist`).

## Not-yet-wired

This helper is scaffolded but **not spawned by the Electron main
process** in the current build. See the "How to finish it" section in
`docs/copilot-virtual-cursor.md` for the 6-step plan.
