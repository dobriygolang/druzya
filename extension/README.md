# druz9 Activity Capture — Chrome MV3 extension (F5 MVP)

Browser extension that auto-detects «finished» events on supported learning
platforms and queues them for the user's druz9 trajectory. Frontend MVP,
no full backend wire yet — queue stays local until juзер confirms / auto-uploads.

## Supported domains

| Domain | What it detects |
|---|---|
| leetcode.com | «Accepted» submission verdict |
| coursera.org | «Marked complete» button toggle + quiz «Passed» |
| learn.deeplearning.ai | «Next lesson» / «Course completed» banners |
| neetcode.io | Marked-done checkbox |
| codewars.com | «Kata Successfully Completed!» |
| *.hackerrank.com | «Submission Accepted» / «Congratulations» |

## Loading the dev build

1. Chrome → `chrome://extensions/` → toggle **Developer mode** (top-right)
2. Click **Load unpacked** → select `/Users/sedorofeevd/Desktop/druzya/extension`
3. Pin the extension icon в toolbar
4. Open `chrome://extensions/` again → confirm «druz9 Activity Capture» loaded

## How it works

- Each content script (`content-scripts/{leetcode,coursera,...}.js`) uses
  `MutationObserver` to watch для completion signals. When triggered, it
  sends a `druz9.detection` message to the background SW.
- Background SW (`background.js`) dedupes within 1-hour buckets per URL,
  then either:
  - **confirm mode** (default): adds to queue, shows badge count, waits for popup confirm
  - **auto mode**: immediately marks `pending_upload`, attempts POST to `/api/log_resource`
  - **off**: ignores all detections
- The popup (`popup/popup.html`) renders pending entries with «✓ log» /
  «dismiss» actions. Mode + auth state также reachable here.

## Backend wire

POST `https://druz9.online/api/log_resource` (Bearer token from popup auth).
Wire shape matches existing `LogResource` UC в `backend/services/intelligence/app/log_resource.go`:

```json
{
  "resource_url": "https://leetcode.com/problems/two-sum/",
  "kind": "finished",
  "occurred_at": "2026-05-12T15:30:00Z",
  "atlas_node_id": "",
  "source": "leetcode"
}
```

401 response wipes the local token (forces re-auth). 5xx retries via
chrome.alarms every 15 min.

## Auth flow (MVP)

Юзер кликает «Подключить» в popup → opens
`https://druz9.online/profile?tab=extension` где Sergey добавит token
display + copy-button. Юзер copy/paste'ит токен в popup. (Phase D iteration:
proper OAuth-like flow с `chrome.identity.launchWebAuthFlow`.)

## Identity rules

- B/W only (#FF3B30 — единственный accent, badge color)
- Anti-fallback: detection с low confidence → silent skip (не симулируем «возможно finished»)
- No telemetry beyond user's explicit `pending_upload` → API call

## Icons

Icons placeholder paths в manifest.json: `icons/icon16.png`,
`icons/icon32.png`, `icons/icon128.png`. Need to be added before
Chrome Web Store submission (или extension load даст warning).

## Future work

- Firefox port (95%+ Russian market via Chrome — defer)
- GitHub `*/learn` detection (need research что именно ловить)
- OAuth-like proper auth flow
- Auto-pulled atlas_node_id (resource_url → node mapping via curation
  service `resource_to_atlas`)
