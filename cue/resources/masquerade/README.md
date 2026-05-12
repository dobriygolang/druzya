# Masquerade resources

PNG files (`notes.png`, `telegram.png`, `slack.png`, `xcode.png`) are
runtime swap assets — `masquerade.applyPreset()` reads them at boot and
hands them to `app.dock?.setIcon` + `tray.setImage`. Monochrome
template-style PNGs work best for the tray (auto-invert under light /
dark menu bar). Drop them into this directory alongside the `.icns`
files.

ICNS files (`notes.icns`, `telegram.icns`, `slack.icns`, `xcode.icns`)
are used at bundle build time by `electron-builder.<preset>.yml`. macOS
reads the Finder / Dock / Cmd+Tab icon from this `.icns`, so the
masquerade fidelity depends entirely on the asset.

## Generating .icns from a 1024×1024 PNG

Apple's preferred path is `iconutil`, which is preinstalled on macOS.
Stage the asset into an `.iconset` directory with the required sizes,
then convert:

```bash
# Inputs: notes-1024.png (≥ 1024×1024 source artwork)
mkdir notes.iconset
sips -z 16 16     notes-1024.png --out notes.iconset/icon_16x16.png
sips -z 32 32     notes-1024.png --out notes.iconset/icon_16x16@2x.png
sips -z 32 32     notes-1024.png --out notes.iconset/icon_32x32.png
sips -z 64 64     notes-1024.png --out notes.iconset/icon_32x32@2x.png
sips -z 128 128   notes-1024.png --out notes.iconset/icon_128x128.png
sips -z 256 256   notes-1024.png --out notes.iconset/icon_128x128@2x.png
sips -z 256 256   notes-1024.png --out notes.iconset/icon_256x256.png
sips -z 512 512   notes-1024.png --out notes.iconset/icon_256x256@2x.png
sips -z 512 512   notes-1024.png --out notes.iconset/icon_512x512.png
cp                notes-1024.png       notes.iconset/icon_512x512@2x.png

iconutil -c icns notes.iconset -o notes.icns
rm -rf notes.iconset
```

Repeat for `telegram` / `slack` / `xcode` with their respective source
artworks. Save into this directory (`cue/resources/masquerade/`).

## What if icons are missing?

`scripts/build-masquerade.sh` prints a warning and proceeds with
electron-builder's default fallback (the base `resources/icon.icns`,
which is Cue's own icon). The bundle still launches and the CFBundleName
rename still works — only the Dock / Finder tile shows the Cue icon
instead of the alias. Useful for local plumbing tests but ship-quality
builds need real icons.
