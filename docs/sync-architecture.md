# Hone Sync Architecture (ADR)

**Status:** ratified 2026-04-25
**Scope:** Phase C-3 (foundation) → C-7 (full multi-device sync)
**Audience:** anyone touching `services/hone`, `services/intelligence`, or any
table that ever needs to live on more than one device.

This document fixes the architectural decisions for cross-device sync **before**
we write any line of pull/push code, so we don't repaint mid-flight. Every
decision below has alternatives we considered and rejected, with the reason —
because re-litigating them in a PR is the most expensive way to discover we
forgot why.

---

## 1. Conflict resolution: hybrid

We classify each table into one of three buckets and pick the cheapest model
that's still correct for that data:

| Table                 | Model      | Why                                                                                                              |
|-----------------------|------------|------------------------------------------------------------------------------------------------------------------|
| `hone_notes`          | **Yjs CRDT** | Long-lived rich text; concurrent edits from two devices must not lose characters. We already run Yjs in `editor`. |
| `hone_whiteboards`    | **Yjs CRDT** | Same. Excalidraw state is a JSON tree but each shape can be a Yjs map; conflict-free.                             |
| `hone_focus_sessions` | **LWW**    | Append-only — once `ended_at` set, row is immutable. Conflict ≈ impossible (each device writes its own session).   |
| `hone_streak_days`    | **LWW**    | Daily summary, single owner per day, recomputed deterministically from sessions. LWW + reconciliation cron.        |
| `hone_plans`          | **LWW**    | One row per (user, date). Regenerated daily; manual edits rare. LWW acceptable losses on simultaneous edit.        |
| `coach_episodes`      | **LWW (append-only)** | Append-only audit log of coach memory. No updates outside embedding-fill. LWW + idempotent insert by id.   |
| `users` quota cols    | **server-authoritative** | `storage_used_bytes` recomputed by cron — clients never write it. No conflict possible.                  |

**Rejected: pure CRDT for everything.** Y.Doc per row is heavy (extra bytes,
extra dependency on every client). For append-only or daily-overwrite tables
LWW is provably safe and 10× cheaper.

**Rejected: pure LWW for notes.** Two phones editing same note at once: both
push back snapshots, last-write wins, the other side's keystrokes vanish. This
*is* what would have shipped if we hadn't done this ADR — exactly the failure
mode this whole document exists to prevent.

### Yjs persistence model

- Add table `note_yjs_states (note_id PK, doc BYTEA, seq BIGINT, updated_at)`.
- Server stores the **encoded Yjs document** as binary. `body_md` becomes a
  derived view (server pulls Yjs doc, runs `Y.Text.toString()` on the body
  fragment, writes back to `body_md` on each push). This keeps embedding /
  RAG / publish-to-web all reading `body_md` like today.
- Clients sync via Yjs **update messages** (small deltas), not full doc.
  Server applies update to its copy with `Y.applyUpdate()` and broadcasts to
  other devices.
- **No vector clocks needed inside Yjs** — Yjs's own clientID + clock handle
  it. We just need to ensure unique clientIDs per device (use device_id from
  `devices` table — already provisioned in Phase C-3).

---

## 2. Cursor protocol: per-device `last_pulled_at` + tombstones

Each device keeps a single timestamp `last_pulled_at` in localStorage. Pull
endpoint returns: rows where `updated_at > last_pulled_at`, plus deletions
since that time, plus Yjs updates accumulated since.

**Deletions** can't be detected by `updated_at` alone (the row is gone). So
we add a tombstone log:

```sql
CREATE TABLE sync_tombstones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_name  TEXT NOT NULL,        -- 'hone_notes' | 'hone_whiteboards' | …
    row_id      UUID NOT NULL,
    deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_tombstones_user_time ON sync_tombstones(user_id, deleted_at);
```

Repos write a tombstone in the same TX as the DELETE. Pull endpoint scans
both `updated_at > cursor` rows AND `deleted_at > cursor` tombstones.

**Tombstone GC:** rows older than 90 days (longer than any device should be
offline) get pruned — long-offline devices receive a `409 Resync` and must
do a full bootstrap pull instead of incremental.

**Rejected: vector clocks per row.** Storage cost (24 bytes × N devices ×
M rows) dwarfs the benefit. Single timestamp suffices because we never need
to detect concurrent edit *of the same scalar* — Yjs handles that for the
two tables where it matters; LWW tables tolerate the lossy-by-design reading.

**Rejected: lamport counter in each row.** Same reason — one timestamp gives
us causal ordering at no cost.

---

## 3. Transport: Connect server-streaming push + REST pull

Two channels:

1. **Bulk pull** (`POST /api/v1/sync/pull` REST):
   - Body: `{cursor: "2026-04-25T10:00:00Z", tables: [...]}`
   - Response: deltas + new cursor.
   - Used on app start, manual "Sync now" button, and after streaming
     reconnect.

2. **Server-streaming push notifications** (Connect RPC `SyncEvents`):
   - Server keeps a per-user goroutine subscribed to internal event bus
     (we already have `eventbus.InProcess`).
   - On any write that affects sync (row update, insert, delete), publishes
     `{table, rowID, updatedAt}` to the user's subscribers — **excluding
     the originating device** (use `X-Device-ID` header to filter).
   - Other devices receive the event and either:
     - apply small Yjs update directly (for notes/whiteboards), or
     - trigger an incremental pull (for LWW tables).
   - Stream auto-reconnects with exponential backoff on disconnect.

**Why both channels?** Pull is robust (works behind any proxy, no
long-lived connections, simple to debug). Push gives realtime UX. Pull is
the source of truth — push is an optimistic wake-up. If push misses an
event (race, disconnect, dropped frame), the next pull fixes it.

**Rejected: pure REST polling.** 30s polls × N devices = constant DB load
even when nothing changes; battery hit on mobile.

**Rejected: WebSockets.** We use Connect everywhere else; adding a separate
WS protocol = more code, more bugs, more middleware. Connect server-streaming
is the same wire format as everything else.

**Rejected: SSE.** Same reason as WS plus no built-in auth metadata story.

---

## 4. Encryption: trust-server (default), opt-in E2E (Phase C-7)

**Default mode (everyone, day 1):** server stores plaintext. This is what we
do today for `hone_notes.body_md`, `hone_whiteboards.state_json`,
`coach_episodes.summary`. This:

- Lets coach memory work (LLM needs to read your notes/standups).
- Lets RAG / AskNotes / GetNoteConnections work (server-side embeddings).
- Lets publish-to-web work (server renders HTML).
- Trusts that we don't read it / don't get breached. Same trust model as
  Notion, Linear, Granola, every product in this category.

**Opt-in E2E mode (Phase C-7, separate ADR):** user enables "Private vault" in
settings → derives encryption key from password (Argon2id). All `hone_notes`
body / `hone_whiteboards` state / `coach_episodes` get encrypted client-side
before push. Trade-offs the user accepts when enabling:

- **Coach memory disabled** for private vault (server can't read encrypted
  body to extract reflections).
- **AskNotes / RAG disabled** for private vault.
- **Publish to web disabled** for encrypted notes.
- Search works only on title (which stays plaintext for tier-quota query).

User can mix-and-match: any individual note can be marked "encrypted" while
others stay readable by coach.

**Why not E2E by default?** Because the killer feature (coach that knows
you) requires plaintext. Forcing E2E = killing the product. Letting privacy-
sensitive users opt in = right trade-off.

**Rejected: server-side encryption-at-rest with KMS.** Doesn't change threat
model from a breach perspective (server has the key) — it's compliance
theater, not security. Postgres TDE-equivalent (pg_crypto on individual
columns) buys nothing if attacker gets shell on the DB box.

---

## 5. Device bootstrap & lifecycle

### Device ID storage

- **localStorage key:** `hone:device-id` — single string, the UUID returned
  from `POST /api/v1/sync/devices`.
- **Generation:** on app first launch (no key in localStorage), call
  register endpoint with `{name: navigator.userAgent-derived, platform:
  detect, appVersion}`. Persist returned id.
- **Why localStorage and not IPC keychain:** simplicity. Device id is not a
  secret — it's user-scoped through the bearer token. Stealing the device id
  alone gets the attacker nothing without also stealing the auth token.

### Heartbeat

- Every authenticated Connect/REST request sends `X-Device-ID` header (added
  via interceptor, see `transport.ts`).
- Backend middleware reads the header; if non-empty and matches an active
  device, updates `devices.last_seen_at = now()` **once per N minutes** (not
  every request — too much DB write churn). N = 5 minutes via in-memory
  per-device cache.

### Revoke handling

- Backend Settings → "Revoke" sets `devices.revoked_at = now()`.
- Auth middleware checks: if `X-Device-ID` is present and the device is
  revoked, return `401 Unauthenticated` with `{error.code:
  "device_revoked"}`. Frontend interceptor sees this code → wipes
  localStorage device id + auth token → routes to LoginScreen with toast
  "Signed out by other device".
- This makes revoke effectively immediate (next request fails) without
  needing realtime push to terminate sessions.

### Free tier 1-device transitions

- Free user has device A registered.
- Logs in on device B → registration returns 409 `device_limit_free`.
- UI shows: "Free supports 1 device. [Upgrade] | [Replace device A]".
- "Replace" calls `POST /sync/devices/{A}/revoke` then re-registers B. Old
  device A's next request gets `401 device_revoked` and signs out.

### Initial sync for new device

- After register, fresh device has no local data.
- Frontend calls `POST /api/v1/sync/pull` with `cursor: null` → backend
  returns FULL snapshot (capped at sane limits per table — paginate if
  needed for users with 10k notes).
- Frontend writes everything to local cache (TBD: IndexedDB vs in-memory
  store — see Phase C-5 for that decision).

---

## 6. Phase plan

| Phase | Scope                                                                  | Status        |
|-------|------------------------------------------------------------------------|---------------|
| C-3   | `devices` table, register/list/revoke, tier-gate                       | ✅ done       |
| C-3.1 | Device auto-register on app start, X-Device-ID interceptor, heartbeat   | 🟡 this turn |
| C-4   | LWW pull/push for `focus_sessions`, `streak_days`, `coach_episodes`, `plans` | 🔴 next  |
| C-4.1 | `sync_tombstones` table + tombstone-aware pull                          | 🔴 next       |
| C-5   | Local cache layer (IndexedDB-backed Zustand store)                      | 🔴 future     |
| C-6   | Yjs CRDT for `hone_notes` (note_yjs_states table, sync handler)         | 🔴 future     |
| C-6.1 | Yjs CRDT for `hone_whiteboards`                                          | 🔴 future     |
| C-6.2 | Connect server-streaming `SyncEvents` push channel                       | 🔴 future     |
| C-7   | Opt-in E2E "Private vault" mode                                          | 🔴 distant    |

Each phase ships independently. After C-4 ships, LWW tables already sync
between devices — that alone is a meaningful product step. Yjs (C-6) adds
notes/whiteboards conflict-free editing on top.

---

## 7. Open questions deferred

- **Bandwidth budget on mobile:** how often do we push Yjs updates? Debounce
  300ms while typing? Decide in C-6.
- **Snapshot compaction for Yjs:** Y.Doc grows monotonically; we'll need to
  periodically GC old updates (compact + rebroadcast). Decide in C-6.
- **Selective sync:** "don't sync these archived notes to mobile to save
  space"? Probably not v1 — note text is tiny (KB, not MB). Revisit if
  users complain about IndexedDB size.
- **Backup / export:** if user revokes all devices, can they get their data
  back? Yes — server has it. Add `GET /api/v1/storage/export` returning
  ndjson dump in C-7.
