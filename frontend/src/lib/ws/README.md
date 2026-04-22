# WebSocket layer

Lightweight reusable WS layer for live-updating pages.

- `client.ts` — singleton manager. One socket per channel, refcounted across hook
  consumers. Reconnect uses exponential backoff capped at 10s. JWT pulled from
  `localStorage` (`auth_token` or `jwt`) and sent as `?token=...` query param.
- `useChannel.ts` — React hook. Returns `{ data, lastEvent, status, send }`.
  When `import.meta.env.VITE_USE_MSW === 'true'`, no real socket is opened —
  fake events are emitted on intervals matching the channel pattern.
- `events.ts` — typed event maps per channel.

## Configuration

| env             | default | meaning                                      |
| --------------- | ------- | -------------------------------------------- |
| `VITE_WS_BASE`  | `/ws`   | base path or absolute `ws://` / `wss://` URL |
| `VITE_USE_MSW`  | unset   | when `true`, hook emits mock events only     |

## Channels & events

### `arena/{matchId}`

| event             | payload                                       |
| ----------------- | --------------------------------------------- |
| `opponent_joined` | `{ nick, tier }`                              |
| `opponent_typing` | `{ active }`                                  |
| `opponent_run`    | `{ tests: "8/15" }`                           |
| `opponent_submit` | `{ passed }`                                  |
| `match_result`    | `{ winner: 'me'\|'opponent', score }`         |
| `time_warning`    | `{ secondsLeft }`                             |

### `spectator/{matchId}`

| event           | payload                                       |
| --------------- | --------------------------------------------- |
| `code_update`   | `{ side: 'a'\|'b', lines, highlight? }`       |
| `test_result`   | `{ side, passed, total }`                     |
| `viewer_count`  | `{ count }`                                   |
| `chat_message`  | `{ nick, color, text }`                       |

### `mock/{sessionId}`

| event            | payload                              |
| ---------------- | ------------------------------------ |
| `ai_message`     | `{ from: 'ai'\|'user', text }`       |
| `ai_evaluation`  | `{ metrics: [{ label, value }] }`    |
| `hint_unlocked`  | `{ text }`                           |
| `time_warning`   | `{ secondsLeft }`                    |

### `warroom/{incidentId}`

| event           | payload                              |
| --------------- | ------------------------------------ |
| `log_event`     | `{ color, text, time }`              |
| `member_status` | `{ name, progress, status }`         |
| `score_update`  | `{ errorRate, label }`               |

## Usage

```tsx
import { useChannel } from '../lib/ws'
import type { ArenaEvents } from '../lib/ws'

const { data, lastEvent, status, send } = useChannel<ArenaEvents[keyof ArenaEvents]>(
  `arena/${matchId}`,
)
```

The hook handles connect on mount and disconnect on unmount automatically.
