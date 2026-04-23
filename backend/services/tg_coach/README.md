# tg_coach — Telegram AI coach bounded context (STRATEGIC SCAFFOLD)

Phase 1 scaffold for `docs/strategic/tg-coach.md`.

## What is here

- `domain/` — `TGUserLink`, `TGLinkToken` entities + `LinkRepo` port.
- `app/` — `IssueLinkToken`, `LinkAccount`, `HandleCommand` use case stubs.
- `ports/` — webhook handler stub at `/webhooks/telegram` returning 501,
  plus a tiny command parser scaffold (`/start`, `/today`, `/streak`).
- `infra/` — placeholder; the Postgres adapter and the Telegram bot
  client land in Phase 1 implementation work.

## Bot library decision

Use **`gopkg.in/telebot.v3`** when implementing. NOT added to go.mod yet —
the scaffold avoids pulling third-party deps. When activating:

```
go get gopkg.in/telebot.v3
```

## LLM wiring

Reuse the OpenRouter client currently embedded in
`backend/services/profile/infra/openrouter_insight.go`. Phase 2 should
extract it to `shared/pkg/openrouter/` so both `profile` and `tg_coach`
can depend on it without `tg_coach → profile` coupling.

## Anti-fallback contract

- Webhook receiving an unknown `chat_id` MUST reply with the deep-link
  instructions; it MUST NOT auto-create a druz9 account.
- Link tokens are single-use, 10-minute TTL, scoped to one chat_id on
  first use — enforced at the SQL layer (`used_at IS NULL`).
- Nil logger to any constructor → panic.

## Next-session checklist (Phase 1, ~4 sessions)

1. Add telebot.v3 dependency.
2. Implement `infra/postgres.go` for `tg_user_link` and `tg_link_tokens`.
3. Implement webhook handler with HMAC validation (Telegram secret).
4. Wire `/start <token>` to consume the link token.
5. Wire `/today` to call existing daily service.
6. Wire `/streak` to call existing profile service.
7. Settings UI: "Connect Telegram" button.
