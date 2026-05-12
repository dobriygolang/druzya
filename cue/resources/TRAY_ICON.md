# Tray icon

The menu-bar icon is a **template image**: it must be monochrome so
macOS can invert it automatically on the dark menu bar.

## Required files

- `trayTemplate.png`        — 22×22 (22pt @1x), black pixels on transparent
- `trayTemplate@2x.png`     — 44×44 (retina)

Both next to `icon.icns` in this folder. Electron auto-picks the @2x
variant on HiDPI displays via macOS naming conventions.

## Quick generation

From a 44×44 PNG of the brand mark (monochrome black on transparent):

```bash
cp brand-44.png trayTemplate@2x.png
sips -z 22 22 trayTemplate@2x.png --out trayTemplate.png
```

## Fallback

If `trayTemplate.png` is missing, the Tray is created with an empty
icon — user sees a blank spot on the menu bar but the dropdown still
works. Add the real icon before shipping.
