# Slot domain — cmd/monolith wiring

The slot domain does not edit `cmd/monolith/main.go` or `cmd/monolith/server.go`.
Paste the snippets below into those files when wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    slotApp   "druz9/slot/app"
    slotInfra "druz9/slot/infra"
    slotPorts "druz9/slot/ports"
)
```

`log/slog`, `time`, `pool *pgxpool.Pool`, and `bus sharedDomain.Bus` should
already be in scope.

## 2. Constructor calls (in `main()` after Postgres / Bus / Logger are built)

```go
// --- slot (Human Mock Interview) ---
slotPG      := slotInfra.NewPostgres(pool)
slotMeet    := slotInfra.NewMockMeetRoom() // STUB — swap for real Google Meet provider

slotCreate  := &slotApp.CreateSlot{Slots: slotPG, Now: time.Now}
slotList    := &slotApp.ListSlots{Slots: slotPG, Reviews: slotPG}
slotBook    := &slotApp.BookSlot{Slots: slotPG, Meet: slotMeet, Bus: bus, Log: log, Now: time.Now}
slotCancel  := &slotApp.CancelSlot{Slots: slotPG, Bus: bus, Log: log}

// Forward-compat hook — currently a no-op. Leave the call so future additions
// (e.g. SlotReminder cron) wire here, not in main.go.
slotApp.SubscribeHandlers(bus)

slotServer := slotPorts.NewSlotServer(slotList, slotCreate, slotBook, slotCancel, log)
```

## 3. Event subscriptions

None. All slot-domain events are outgoing:

- `slot.Booked`       → consumed by notify (candidate email/TG, calendar .ics)
- `slot.Cancelled`    → consumed by notify

The notify domain already subscribes to both; nothing to do here.

**Future work (flagged, not wired):**
- `slot.ReminderDue` — a cron-driven scheduler should scan bookings whose
  `starts_at` falls within the next 30 minutes and emit `slot.ReminderDue`.
  The notify domain would then fan out reminders over the user's preferred
  channels. This cron lives outside the slot domain — see Bible §3.3.

## 4. Composite server embed line in `cmd/monolith/server.go`

```go
type compositeServer struct {
    apigen.Unimplemented
    Auth    *authPorts.AuthServer
    Profile *profilePorts.ProfileServer
    Daily   *dailyPorts.DailyServer
    Rating  *ratingPorts.RatingServer
    Arena   *arenaPorts.ArenaServer
    Mock    *aimockPorts.MockServer
    Native  *ainativePorts.NativeServer
    Guild   *guildPorts.GuildServer
    Notify  *notifyPorts.NotifyServer
    Slot    *slotPorts.SlotServer // ← add this
}
```

And in the composite constructor:

```go
return &compositeServer{
    Auth:    authServer,
    Profile: profileServer,
    Daily:   dailyServer,
    Rating:  ratingServer,
    Arena:   arenaServer,
    Mock:    mockServer,
    Native:  nativeServer,
    Guild:   guildServer,
    Notify:  notifyServer,
    Slot:    slotServer, // ← add this
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

Follows the Guild pattern exactly — four thin forwarders:

```go
// ── slot ───────────────────────────────────────────────────────────────────

func (s *compositeServer) GetSlot(w http.ResponseWriter, r *http.Request, params apigen.GetSlotParams) {
    s.Slot.GetSlot(w, r, params)
}
func (s *compositeServer) PostSlot(w http.ResponseWriter, r *http.Request) {
    s.Slot.PostSlot(w, r)
}
func (s *compositeServer) PostSlotSlotIdBook(w http.ResponseWriter, r *http.Request, slotId openapi_types.UUID) {
    s.Slot.PostSlotSlotIdBook(w, r, slotId)
}
func (s *compositeServer) DeleteSlotSlotIdCancel(w http.ResponseWriter, r *http.Request, slotId openapi_types.UUID) {
    s.Slot.DeleteSlotSlotIdCancel(w, r, slotId)
}
```

## 6. go.work

If the monolith's `go.work` does not already include slot, add:

```
use ./services/slot
```

## Notes & STUBs

- `slotInfra.MockMeetRoom` — returns `https://meet.google.com/mock-{slotID}`.
  Swap for a real Google Meet provider that exchanges the interviewer's
  Google OAuth token for a Calendar event + Meet link. The interface
  contract (one idempotent call per booking, keyed by slot ID) is designed
  to accommodate that without churning callers.
- `slotApp.SubscribeHandlers` is a no-op today. When the SlotReminder cron
  lands, register it there.
- SMTP / Telegram reminder delivery is already handled by the notify domain
  via `slot.Booked` / `slot.Cancelled` subscriptions — no changes needed on
  that side.
- Authorization: `PostSlot` requires `middleware.UserRoleFromContext` to
  return `interviewer` or `admin`. If your auth middleware does not yet
  populate the user role, that must land before `/slot POST` will admit any
  caller (it currently returns 403).
