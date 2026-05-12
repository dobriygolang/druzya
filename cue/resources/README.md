# Druz9 Copilot — Resources

Assets consumed by electron-builder at package time.

## Required before first public release

### `icon.icns` — macOS app icon

Generated from a 1024×1024 PNG via `iconutil`:

```bash
mkdir Druz9.iconset
sips -z 16 16     brand.png --out Druz9.iconset/icon_16x16.png
sips -z 32 32     brand.png --out Druz9.iconset/icon_16x16@2x.png
sips -z 32 32     brand.png --out Druz9.iconset/icon_32x32.png
sips -z 64 64     brand.png --out Druz9.iconset/icon_32x32@2x.png
sips -z 128 128   brand.png --out Druz9.iconset/icon_128x128.png
sips -z 256 256   brand.png --out Druz9.iconset/icon_128x128@2x.png
sips -z 256 256   brand.png --out Druz9.iconset/icon_256x256.png
sips -z 512 512   brand.png --out Druz9.iconset/icon_256x256@2x.png
sips -z 512 512   brand.png --out Druz9.iconset/icon_512x512.png
cp                brand.png      Druz9.iconset/icon_512x512@2x.png
iconutil -c icns Druz9.iconset -o icon.icns
rm -rf Druz9.iconset
```

Drop the result here as `resources/icon.icns`. Until then, electron-builder
uses its fallback icon — acceptable for dev builds, not for anything you
ship to users.

### `masquerade/` — alternate app icons

When the `masquerade` feature flag is enabled (post-MVP), users can pick
a disguise. Drop `.icns` files here: `notes.icns`, `telegram.icns`,
`xcode.icns`, `slack.icns`. The renderer reads the list from
`DesktopConfig.Flags` and swaps `app.dock.setIcon(...)` at runtime.

## Already present

### `entitlements.mac.plist`

macOS sandbox / hardened-runtime entitlements consumed by electron-builder
during `--sign`. Grants the minimum set needed for:

- Network egress (`com.apple.security.network.client`).
- Microphone when voice input is enabled (`device.audio-input`).
- JIT for V8 (`cs.allow-jit`, `cs.allow-unsigned-executable-memory`).

If you add native modules (e.g. a Swift stealth helper), enable
`com.apple.security.cs.disable-library-validation` — already set.
