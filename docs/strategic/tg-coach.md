# Telegram AI coach — Strategic roadmap

> Status: scaffold  
> Owner: TBD  
> Linked context: `backend/services/tg_coach/`, migration `00029_tg_coach.sql`  
> Last revised: 2026-04-23

## 1. Vision

Most druz9 users live in Telegram (RU/CIS audience). A native bot that
delivers a **conversational coaching layer** — daily nudge, kata of the day,
"explain this answer", weekly report, voice-mode mock interview — turns
Telegram into a primary surface for the platform rather than a notification
sink. Because the LLM cost per active user is small (~$0.10/mo at current
OpenRouter prices) and Telegram retention is structurally higher than email
+ web push, this becomes the cheapest activation channel we own.

## 2. User personas + pain points

### 2.1 Daily Telegram-native learner (RU/UA)
- **Pains:** Forgets to open the web app; web push is noisy; doesn't want yet
  another tab.
- **Wants:** Bot pings 09:30 with one kata, can answer inline, sees streak.

### 2.2 Commute solver
- **Pains:** Wants to "talk through" an algorithm on the way to work but no
  hands free for a web UI.
- **Wants:** Voice messages → bot transcribes, coaches via voice reply.

### 2.3 Manager / lurker
- **Pains:** Wants to follow team prep without admin web access.
- **Wants:** Read-only digest channel auto-posting team highlights.

## 3. Phase 1 — MVP scope (1 sprint)

Smallest shippable: **`/start` command links Telegram chat_id ↔ druz9 uid via
a one-time deep link (`t.me/druz9_bot?start=<token>`); `/today` returns today's
kata text; `/streak` returns the user's current streak.** No LLM-generated
content yet — purely a thin RPC client to the existing daily/profile services.

- New bounded context `services/tg_coach/`:
  - `domain.TGUserLink` (uid, chat_id, linked_at).
  - `app.LinkAccount`, `app.HandleCommand` use case stubs.
  - `ports.WebhookHandler` skeleton — Telegram setWebhook target.
- Migration `00029_tg_coach.sql` adds `tg_user_link` table.
- Bot library: `gopkg.in/telebot.v3` (decision documented; NOT added in
  scaffold sprint to avoid pulling deps before we ship).
- LLM wiring: reuse existing `profile/infra/openrouter_insight.go` client by
  extracting it to `shared/pkg/openrouter/` in Phase 2.
- Anti-fallback: if the link token is unknown, the bot replies with the deep
  link instructions; it NEVER auto-creates a fake druz9 account.

## 4. Phase 2 — Conversational coach (3-4 sprints)

- `/explain <kata-id>` → OpenRouter LLM call with kata context.
- Inline keyboard for kata: "show hint", "submit", "skip".
- Daily push at user-configured local time (timezone via Telegram language).
- Streak-loss warnings 21:00 if user hasn't solved today.

## 5. Phase 3 — Voice mock + group features (5-7 sprints)

- Voice messages → Whisper STT → coach response → TTS reply (existing voice
  stack from `frontend/src/lib/voice`).
- 1-on-1 mock interview via voice, scoring fed into ELO.
- Group chat plug-in for cohort channels: leaderboard slash-commands,
  /summon-coach, "explain this" reply mention.
- Bot Mini-App (Telegram WebApp) for the dashboard view inside Telegram.

## 6. Database schema deltas

Migration `00029_tg_coach.sql`:

```sql
CREATE TABLE tg_user_link (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    chat_id        BIGINT NOT NULL UNIQUE,
    tg_username    TEXT,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    locale         TEXT NOT NULL DEFAULT 'ru',
    push_local_hh  INT  NOT NULL DEFAULT 9,   -- preferred push hour, local time
    push_tz        TEXT NOT NULL DEFAULT 'Europe/Moscow',
    paused_until   TIMESTAMPTZ,
    last_seen_at   TIMESTAMPTZ
);

CREATE INDEX idx_tg_user_link_chat ON tg_user_link(chat_id);

CREATE TABLE tg_link_tokens (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE INDEX idx_tg_link_tokens_user ON tg_link_tokens(user_id);
```

Phase 2: `tg_message_log` (audit + cost tracking),
`tg_outbound_queue` (rate-limited push queue).

## 7. API contracts

External: Telegram Bot API webhook → `POST /webhooks/telegram`.

Internal Connect-RPC `TGCoachService`:

| RPC                | Request                  | Response             |
| ------------------ | ------------------------ | -------------------- |
| `IssueLinkToken`   | (auth user)              | token, deep_link_url |
| `GetLinkStatus`    | (auth user)              | linked, chat_id      |
| `Unlink`           | (auth user)              | empty                |
| `SetPushSchedule`  | hh, tz, paused_until     | empty                |

REST: `POST /me/telegram/link-token`, `DELETE /me/telegram`.

## 8. Frontend pages / components

- Settings → Telegram pane: "Connect Telegram" button → opens
  `t.me/druz9_bot?start=<token>` in new tab; polls link status; shows
  push-time selector when linked.
- No standalone page — the bot IS the surface.

## 9. Pricing model

- Free for premium users.
- Free tier: limited to 3 LLM-bound interactions/day (cost cap).
- Premium ($9/mo today): unlimited bot interactions.
- Phase 3 voice mock: 1 free voice mock/wk for free tier, unlimited premium.
- Cost ceiling per user/month: $0.50 (alarm at $0.30, hard cut at $0.50).

## 10. Estimated effort per phase (agent-sessions)

| Phase   | Backend | LLM/infra | Total |
| ------- | ------- | --------- | ----- |
| Phase 1 | 4       | 0         | **4** |
| Phase 2 | 6       | 3         | **9** |
| Phase 3 | 8       | 5         | **13** |

## 11. Risks + mitigations

| Risk                                                | Mitigation                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| Telegram bans / API throttle                        | Multi-bot fallback list; per-chat rate limit; backoff & retry queue   |
| LLM cost spike from abusive user                    | Per-user daily token budget; abuse-detection on repeated identical prompts |
| Privacy: chat content stored & training risk        | OpenRouter no-train models only; never log raw user messages, only token counts |
| Webhook downtime → missed messages                  | Long-poll fallback worker; `tg_outbound_queue` durable                |
| Account-linking phishing (someone steals token)     | 10-min token expiry, single-use, scoped to one chat_id on first use   |
