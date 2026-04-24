# Druz9 Copilot — Sessions & Post-Interview Analysis (Phase 12)

A session is an explicit user-triggered grouping of copilot turns.
Starting one tells the backend "the next N minutes matter together";
ending it kicks off a background LLM analysis that produces a report
the Druzya web frontend renders.

The server is the source of truth for session metadata and, in the
non-BYOK path, owns the analyzer. BYOK users get a parallel path:
their turns never leave the Mac, so neither does their analysis.

---

## Data model

```
copilot_sessions
  ┌────────────┐
  │ id         │ uuid PK
  │ user_id    │ uuid → users(id)
  │ kind       │ 'interview' | 'work' | 'casual'
  │ started_at │ timestamptz default now()
  │ finished_at│ timestamptz (null while live)
  │ byok_only  │ bool — for future metrics; not used today
  └────────────┘
   ▲    │      partial unique index: at most one live per user
   │    │
copilot_conversations.session_id  (nullable FK, SET NULL on delete)
       │
       ▼
copilot_session_reports
  ┌──────────────────┐
  │ session_id PK    │
  │ status           │ 'pending' | 'running' | 'ready' | 'failed'
  │ overall_score    │ int (0..100)
  │ section_scores   │ jsonb { "algorithms": 78, ... }
  │ weaknesses       │ jsonb [string]
  │ recommendations  │ jsonb [string]
  │ links            │ jsonb [{label, url}]
  │ report_markdown  │ text
  │ report_url       │ text — Druzya web page
  │ error_message    │ text
  │ started_at       │ timestamptz
  │ finished_at      │ timestamptz
  │ updated_at       │ timestamptz
  └──────────────────┘
```

## RPC surface

| RPC | Method / path | Notes |
|---|---|---|
| `StartSession` | POST `/api/v1/copilot/sessions` | Fails with `FailedPrecondition` if live session exists. |
| `EndSession` | POST `/api/v1/copilot/sessions/{id}/end` | Emits internal event; returns immediately. |
| `GetSessionAnalysis` | GET `/api/v1/copilot/sessions/{id}/analysis` | Polled by desktop (3s interval, 6 min budget). |
| `ListSessions` | GET `/api/v1/copilot/sessions` | Keyset-paginated. Optional `?kind=interview` filter. |

`Analyze` / `Chat` RPCs auto-attach a newly-created conversation to the
live session (if any). Existing conversations are NOT re-attached — a
turn against a conversation started BEFORE the session still counts as
"outside the session".

## Event flow (server path)

```
 Desktop            Backend                      Analyzer goroutine
   │                  │                                  │
   ├─ StartSession ──►│  INSERT copilot_sessions          │
   │ ◄── id, started  │                                  │
   │                  │                                  │
   ├─ Analyze (N×) ──►│  attach to live session           │
   │ ◄── stream       │  (all turns now belong to session)│
   │                  │                                  │
   ├─ EndSession ────►│  UPDATE finished_at               │
   │                  │  INSERT copilot_session_reports   │
   │                  │    status='pending'               │
   │                  │  publisher.ch ──────────────────► consumer
   │ ◄── session      │                                   │
   │                  │                                  │ LLM call
   │                  │                                  │ parse JSON
   │                  │  UPDATE copilot_session_reports ◄─┤
   │                  │    status='ready', report_url     │
   ├─ GetAnalysis ───►│                                   │
   │ ◄── ready+report │                                   │
```

Kick-off is via a buffered channel inside the monolith rather than the
shared eventbus. Fewer moving parts, no cross-domain coupling, and the
consumer goroutine is started as a `Module.Background` task so the
app's context manages its lifetime. Drop-on-overflow — if ≥ 32 sessions
ended within a few milliseconds, later ones sit in `pending` until an
ops sweep requeues them (not automated yet).

## BYOK path

When the desktop client has at least one BYOK key saved (OpenAI or
Anthropic), the session flow diverges at `EndSession`:

```
 Desktop                        Backend
   ├─ EndSession ───────────────►│
   │ ◄── session                  │  server still creates report row;
   │                              │  analyzer runs, sees zero attached
   │                              │  conversations → produces empty
   │                              │  "session had no server-side turns"
   │                              │  report. Harmless; never displayed.
   │
   │ (main asks renderer for
   │  local transcript via
   │  event:session-request-local-transcript)
   │
   ├─ runs runByokAnalysis() ─────────┐
   │   using OpenAI BYOK key          │
   │   directly; transcript is        ▼
   │   the renderer's in-memory       OpenAI
   │   conversation store.
   │
   └─ broadcasts SessionAnalysisReady event
      with full report. reportUrl='' → desktop renders it inline.
```

The "nothing on our server" promise is kept: server sees session
start/end metadata only, not a single user prompt.

## Desktop UX

Tray menu entry "Начать сессию собеседования" / "Закончить сессию"
starts and ends. While live, compact-window status bar shows a red
"SESSION 12:34" pill. When the report lands, a green "REPORT READY"
pill replaces it; clicking opens:

- **Server path:** `shell.openExternal(report_url)` — full Druzya page.
- **BYOK path:** expanded window → `SessionReportView` renders the
  full report inline (score card, section bars, weaknesses,
  recommendations, markdown).

## Druzya frontend URL contract

`copilot_session_reports.report_url` is populated by the analyzer with
`https://druzya.tech/copilot/reports/<session_id>`. The frontend must:

1. Render a page at `/copilot/reports/:id` that calls
   `GET /api/v1/copilot/sessions/:id/analysis` with the current user's
   JWT.
2. Render the same sections as the desktop's `SessionReportView`:
   overall score, section scores, weaknesses, recommendations,
   markdown narrative.
3. 404 gracefully when the session id belongs to a different user —
   our backend returns `NotFound` in that case.

Override via the `COPILOT_REPORT_URL_TEMPLATE` env var on the backend
(printf-style with one `%s` for the session id).

## Configuration knobs

| Env var | Default | Purpose |
|---|---|---|
| `COPILOT_ANALYZER_MODEL` | `openai/gpt-4o-mini` | OpenRouter model id the analyzer uses |
| `COPILOT_REPORT_URL_TEMPLATE` | `https://druzya.tech/copilot/reports/%s` | URL stored in the report row |

## Testing the flow end-to-end

```bash
# 1. Backend up
make start

# 2. Mint a JWT via the frontend, then:
export TOK=…

# 3. Start a session
curl -X POST http://localhost:8080/api/v1/copilot/sessions \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"kind":"interview"}' | jq .

# 4. Do an analyze call (auto-attaches)
curl -X POST http://localhost:8080/api/v1/copilot/analyze \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"prompt_text":"Объясни SQL-джоины"}' | jq .

# 5. End
curl -X POST http://localhost:8080/api/v1/copilot/sessions/<id>/end \
  -H "Authorization: Bearer $TOK" -d '{}'

# 6. Poll analysis (give the analyzer ~15s)
curl http://localhost:8080/api/v1/copilot/sessions/<id>/analysis \
  -H "Authorization: Bearer $TOK" | jq '.status, .overall_score'
# → "ready", 72
```

## Known gaps / follow-ups

- **Overflow handling.** Dropped events sit in `pending` forever until
  an ops cron re-queues them. Automate once we see one.
- **Retry on LLM failure.** A single transient OpenRouter error marks
  `failed` and stays there. A retry-once on transport errors would be
  honest.
- **Email / Telegram notifications.** Doc calls for them. Currently the
  desktop polls. Wire into `backend/services/notify` once we have a
  user preferences model.
- **Section filter.** Analyzer returns whichever sections showed up in
  the transcript; frontend should graceful-degrade when a score is
  missing (skip the bar instead of showing 0).
