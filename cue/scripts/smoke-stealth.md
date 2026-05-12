# Stealth smoke-test — manual protocol

Run this whenever a new macOS or Chromium version ships, or before any
public release. Stealth is the product's moat; a regression here is
launch-blocking.

## Setup

1. Two devices: the Mac running Druz9 Copilot, and a second device
   (phone or another laptop) as the viewer.
2. A call service: Zoom, Google Meet, and/or Chrome's
   [getDisplayMedia() demo](https://webrtc.github.io/samples/src/content/getusermedia/resolution/).
3. Druz9 Copilot running in dev mode (`make desktop-dev`).

## Test matrix

For each row, begin a share from the Mac, perform the action, confirm the
expected viewer behavior on the second device.

| #   | Service        | Share mode                | Action                                   | Viewer must see                          | Viewer must NOT see       |
| --- | -------------- | ------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------- |
| 1   | Zoom           | Entire desktop            | Press `⌘⇧S` with focus on the browser    | browser, desktop background              | compact window, expanded  |
| 2   | Google Meet    | Entire screen             | Type a question in compact, press Enter  | browser, desktop background              | compact window, expanded  |
| 3   | Chrome demo    | Screen                    | Drag the compact window around           | browser                                  | compact window            |
| 4   | Zoom           | Entire desktop            | Open Settings                            | Settings window, browser                 | —                         |
| 5   | Zoom           | Entire desktop            | Turn stealth OFF in Settings             | compact window, expanded, browser        | —                         |
| 6   | Zoom           | Entire desktop            | Turn stealth ON again                    | browser, desktop background              | compact window, expanded  |
| 7   | Zoom           | **Window** (browser only) | Press `⌘⇧S`                              | only browser                             | compact window, expanded  |

## Pass criteria

- All rows where "must NOT see" lists a window → the viewer really does
  not see it.
- Row 5 — turning stealth off at runtime makes the window immediately
  visible to the viewer, no restart required.

## If a row fails

1. Record: macOS version, browser name + version, Electron version,
   Druz9 Copilot version.
2. Add an entry to
   `backend/services/copilot/infra/config.go`'s
   `StealthWarnings` with the affected (OS, browser) range.
3. File an issue with the reproduction and link back to this checklist.

## Why we don't automate this

macOS's content-protection behaviour is a system-integration test — it
depends on how a third-party capture SDK decides to honour
`NSWindowSharingNone`. Mocking that out would test nothing useful. Every
version that ships has to pass this sheet by hand.
