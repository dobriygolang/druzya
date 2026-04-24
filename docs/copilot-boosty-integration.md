# Druz9 Copilot × Boosty — Subscription Integration

This doc covers the backend plumbing needed to flip `copilot_quotas.plan`
when a user pays on Boosty. The desktop-side UI is already complete —
it opens the Boosty link from `PaywallCopy.SubscribeURL` and polls
`GetQuota` to reflect the result.

---

## The data flow

```
┌───────────────┐    1. opens browser         ┌─────────────┐
│ Druz9 Copilot │ ──────────────────────────► │  boosty.to  │
│   (desktop)   │                             │  /druz9/... │
└───────┬───────┘                             └──────┬──────┘
        │                                            │ 2. user pays
        │                                            │
        │                                            ▼
        │                                  ┌──────────────────┐
        │                                  │ Boosty webhook   │
        │ 4. GetQuota()                    │ POST /subscribed │
        │    returns new plan              └────────┬─────────┘
        │                                           │ 3. POST to our backend
        │                                           ▼
        │                                  ┌──────────────────┐
        └────────────────────────────────► │ Druz9 backend    │
                                           │  copilot_quotas  │
                                           └──────────────────┘
```

Step 3 is the only piece not yet wired. Everything else already works.

---

## Step 1 — Boosty setup (one-time)

In your Boosty creator dashboard:

1. **Create tiers** that match `backend/services/copilot/infra/config.go`
   `Paywall[]`. Tier ids are up to you, but note them down — we'll use
   them in the webhook handler.
   - Recommended: `seeker` (499 ₽/мес, ~ $5), `ascendant` (1490 ₽/мес, ~ $15).
2. **Get the subscribe URLs** per tier. Format:
   `https://boosty.to/<you>/purchase/<tierId>`. Paste them into the
   `SubscribeURL` field of `Paywall` entries in `config.go`. Bump
   `DesktopConfig.Rev`.
3. **Enable the API partner program.** Boosty gates webhooks behind
   a partnership application — request it at
   [dev.boosty.to](https://dev.boosty.to). Once approved you get a
   webhook signing secret.

---

## Step 2 — Link Boosty user to Druz9 user

Boosty identifies subscribers by their Boosty user id, not by your
Druz9 user id. You need a one-time linking step:

**Option A (recommended for MVP): query-string handoff**

When the desktop opens the Boosty URL, append a signed identifier:
```
https://boosty.to/druz9/purchase/seeker?ref=<signed druz9-user-id>
```
Boosty preserves custom query params and echoes them in the webhook
payload. Verify the signature on receipt, decode the Druz9 user id,
bind it to the incoming Boosty user id in a new table:

```sql
CREATE TABLE copilot_boosty_links (
  druz9_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  boosty_user_id TEXT UNIQUE NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Option B: user types their Druz9 username into Boosty's "comment" field**

Simpler for you, worse UX. Skip.

**Wiring the signed ref in the desktop:** add an IPC/RPC that gives
the desktop a short-lived HMAC of the user id. The paywall modal's
`openExternal` call appends it.

---

## Step 3 — Webhook handler in the backend

Add a new REST route — **not** a Connect-RPC (Boosty won't speak proto):

```go
// backend/cmd/monolith/bootstrap/router.go — under the public allow-list
r.Post("/webhooks/boosty/subscribed", services.NewBoostyWebhook(deps).Handle)
```

```go
// backend/services/copilot/infra/boosty.go
package infra

import (
    "context"
    "net/http"

    "druz9/copilot/domain"
    "druz9/shared/enums"
)

// Minimal shape we care about. Boosty's real payload is larger —
// unmarshal only what drives the plan update.
type BoostySubscribedEvent struct {
    Signature string `json:"signature"`
    User      struct {
        ID string `json:"id"`
    } `json:"user"`
    Level struct {
        ID    string `json:"id"`    // the tier id configured on boosty.to
        Price int    `json:"price"` // kopecks
    } `json:"level"`
    Ref string `json:"ref"` // the signed Druz9 user id we passed in
}

type BoostyWebhook struct {
    Quotas  domain.QuotaRepo
    Linker  BoostyLinker       // persistence for copilot_boosty_links
    Signing BoostySigningKey   // HMAC secret from Boosty
}

func (h *BoostyWebhook) Handle(w http.ResponseWriter, r *http.Request) {
    var ev BoostySubscribedEvent
    if err := decodeAndVerify(r.Body, h.Signing, &ev); err != nil {
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }

    druzUserID, err := verifyRef(ev.Ref, h.Signing)
    if err != nil {
        http.Error(w, "bad ref", http.StatusBadRequest)
        return
    }
    if err := h.Linker.Link(r.Context(), druzUserID, ev.User.ID); err != nil {
        http.Error(w, "link failed", http.StatusInternalServerError)
        return
    }

    plan, cap, models := mapTier(ev.Level.ID)
    if err := h.Quotas.UpdatePlan(r.Context(), druzUserID, plan, cap, models); err != nil {
        http.Error(w, "update failed", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}

// mapTier converts Boosty tier id → Druz9 plan + caps + allowed models.
// Keep this in lock-step with Paywall[] in config.go.
func mapTier(tierID string) (enums.SubscriptionPlan, int, []string) {
    switch tierID {
    case "seeker":
        return enums.SubscriptionPlanSeeker, -1,
            []string{
                "openai/gpt-4o-mini",
                "openai/gpt-4o",
                "anthropic/claude-sonnet-4",
            }
    case "ascendant":
        return enums.SubscriptionPlanAscendant, -1,
            []string{
                "openai/gpt-4o-mini", "openai/gpt-4o",
                "anthropic/claude-sonnet-4", "anthropic/claude-opus-4",
                "google/gemini-pro-1.5", "google/gemini-flash-2.0",
                "xai/grok-2",
            }
    default:
        return enums.SubscriptionPlanFree, 20, []string{"openai/gpt-4o-mini"}
    }
}
```

### Unsubscribe / downgrade

Boosty sends an `unsubscribed` event when the user cancels. Wire a
second route:

```go
r.Post("/webhooks/boosty/unsubscribed", services.NewBoostyUnsubscribeWebhook(deps).Handle)
```

…which calls `Quotas.UpdatePlan(...Free, 20, [...])`.

---

## Step 4 — Client refresh

The desktop already polls `GetQuota` on Settings mount, and the
paywall modal has an "Я уже оплатил" button that re-fetches. No
additional client work needed — once the webhook updates the DB,
the next `GetQuota` call returns the new plan.

For instant UX: add a WebSocket or SSE push on plan change (`event:quota-updated`
is already reserved as an IPC channel). Phase 6+.

---

## Testing the flow without real Boosty payments

1. Local backend: `make start`.
2. Fake a webhook:
   ```bash
   curl -X POST http://localhost:8080/webhooks/boosty/subscribed \
     -H "Content-Type: application/json" \
     -d '{"user":{"id":"b-123"},"level":{"id":"seeker","price":49900},"ref":"<signed druz9 id>"}'
   ```
3. Open the desktop app, click "Обновить план" in Settings. The plan
   row should flip from `free · 17/20` to `seeker · 0/∞`.

---

## Security notes

- **Verify the webhook signature** on every call. Boosty's secret
  rotates on partner-dashboard action — store it in your secret manager.
- **Use HMAC-SHA256 for the `ref` handoff** so an attacker can't
  upgrade someone else's account by guessing user ids.
- **Make the webhook idempotent.** If Boosty retries a delivery,
  `UpdatePlan` just re-asserts the same plan — no double-billing risk
  because billing is on Boosty's side, we only reflect their state.
- **Never trust the desktop client** with plan state. The client's
  `GetQuota` result comes from the server DB only.

---

## Why Boosty and not a regular payment processor

- Straightforward for RU users — card works, no VAT hassle for you.
- Boosty takes the payment, not you → KYC / merchant-account simpler.
- Subscription lifecycle (monthly auto-renew, dunning, cancel) is
  Boosty's problem.
- Trade-off: no international users (Boosty doesn't process non-RU
  cards reliably). When we ship to English-speaking markets add a
  Stripe/Paddle tier alongside Boosty — same `SubscribeURL` field,
  different URLs per locale.
