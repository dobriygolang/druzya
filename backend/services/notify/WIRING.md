# Notify domain — wiring guide

> Per project rules, `cmd/monolith/*` and `backend/shared/*` are not touched
> by this change. This document shows how to assemble the notify domain in
> `main.go` (and what env vars to add) — copy-paste the diff there in the
> follow-up PR.

## 1. New environment variables

Add to your `.env.example` (and the deployed environments):

```env
# existing (no change needed)
TELEGRAM_BOT_TOKEN=123456:ABC-xxx

# new (required)
TELEGRAM_WEBHOOK_SECRET=some-long-random-string
PUBLIC_BASE_URL=https://druz9.ru
```

These three are read by `main.go` and passed into the notify constructor — they
do NOT need to live inside `shared/pkg/config/config.Config.Notify` unless you
prefer that. Suggested extension (not required for MVP):

```go
// backend/shared/pkg/config/config.go — add to the Notify struct
Notify struct {
    TelegramBotToken       string
    SMTPHost               string
    SMTPPort               int
    SMTPUser               string
    SMTPPass               string
    TelegramWebhookSecret  string  // NEW
    PublicBaseURL          string  // NEW
}
```

If you don't want to touch shared/pkg/config, just read the env vars directly
in main.go:

```go
webhookSecret := os.Getenv("TELEGRAM_WEBHOOK_SECRET")
publicBaseURL := os.Getenv("PUBLIC_BASE_URL")
```

## 2. Imports for main.go

```go
import (
    notifyApp "druz9/notify/app"
    notifyDomain "druz9/notify/domain"
    notifyInfra "druz9/notify/infra"
    notifyPorts "druz9/notify/ports"

    sharedDomain "druz9/shared/domain"
)
```

## 3. Constructor calls (bootstrap section)

```go
// (pgPool, redisClient, log, cfg are already defined upstream)

// Postgres adapter satisfies PreferencesRepo, LogRepo, and UserLookup.
notifyPG := notifyInfra.NewPostgres(pgPool)

// Redis FIFO queue for outbound notifications + per-user rate limiter.
notifyQueue := notifyInfra.NewRedisQueue(redisClient)
notifyRL := notifyInfra.NewRedisRateLimiter(redisClient)

// Template catalogue (ru + en).
notifyTemplates, err := notifyInfra.NewTemplates()
if err != nil { log.Error("notify.templates", slog.Any("err", err)); os.Exit(1) }

// Senders.
notifyTG, err := notifyInfra.NewTelegramBot(notifyInfra.TelegramBotConfig{
    Token:         cfg.Notify.TelegramBotToken,
    WebhookSecret: os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
    PublicBaseURL: os.Getenv("PUBLIC_BASE_URL"),
    Env:           cfg.Env,
}, log, notifyPG, notifyPG)
if err != nil { log.Error("notify.telegram", slog.Any("err", err)); os.Exit(1) }

notifyEmail := notifyInfra.NewEmailSender(log, cfg.Notify.SMTPHost, cfg.Notify.SMTPPort, cfg.Notify.SMTPUser)
notifyPush := notifyInfra.NewWebPushSender(log)

// Use cases.
notifyGet := &notifyApp.GetPreferences{Prefs: notifyPG, Log: log}
notifyUpd := &notifyApp.UpdatePreferences{Prefs: notifyPG, Log: log}
notifySend := &notifyApp.SendNotification{
    Prefs: notifyPG, Logs: notifyPG,
    Templates: notifyTemplates,
    Queue: notifyQueue, Users: notifyPG,
    Log: log,
}

// Event handlers.
notifyH := notifyApp.NewHandlers(notifySend, log)

// HTTP server (apigen interface) + webhook receiver.
notifySrv := notifyPorts.NewNotifyServer(notifyGet, notifyUpd, log)
notifyWebhook := notifyPorts.NewWebhookHandler(
    notifyTG,
    os.Getenv("TELEGRAM_WEBHOOK_SECRET"),
    log,
)

// Worker (pool of 2 goroutines) — run in background.
notifyWorker := &notifyApp.Worker{
    Queue:     notifyQueue,
    Prefs:     notifyPG,
    Logs:      notifyPG,
    Templates: notifyTemplates,
    Senders: map[enums.NotificationChannel]notifyDomain.Sender{
        enums.NotificationChannelTelegram: notifyTG,
        enums.NotificationChannelEmail:    notifyEmail,
        enums.NotificationChannelPush:     notifyPush,
    },
    RateLimit: notifyRL,
    Log:       log,
    PoolSize:  2,
}

// Weekly scheduler.
notifySched := &notifyApp.WeeklyReportScheduler{
    Prefs:    notifyPG,
    Bus:      bus,
    Log:      log,
    Location: time.UTC, // or load cfg timezone
    Hour:     20,
    Weekday:  time.Sunday,
}
```

## 4. Event subscriptions (9+)

```go
bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), notifyH.OnDailyKataCompleted)
bus.Subscribe(sharedDomain.DailyKataMissed{}.Topic(),    notifyH.OnDailyKataMissed)
bus.Subscribe(sharedDomain.MatchStarted{}.Topic(),       notifyH.OnMatchStarted)
bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(),     notifyH.OnMatchCompleted)
bus.Subscribe(sharedDomain.SubscriptionActivated{}.Topic(), notifyH.OnSubscriptionActivated)
bus.Subscribe(sharedDomain.SkillDecayed{}.Topic(),       notifyH.OnSkillDecayed)
bus.Subscribe(sharedDomain.UserRegistered{}.Topic(),     notifyH.OnUserRegistered)
bus.Subscribe(sharedDomain.SlotBooked{}.Topic(),         notifyH.OnSlotBooked)

// Notify's own internal event (LOCAL to the domain — not in shared/events.go).
bus.Subscribe(notifyDomain.WeeklyReportDue{}.Topic(),    notifyH.OnWeeklyReportDue)
```

## 5. Composite server embed

The existing composite `*Server` struct gets another embed line:

```go
type compositeServer struct {
    *authPorts.AuthServer
    *profilePorts.ProfileServer
    *dailyPorts.DailyServer
    *ratingPorts.RatingServer
    *notifyPorts.NotifyServer  // NEW
    // ...
}
```

This gives you `GetNotifyPreferences` and `PutNotifyPreferences` out-of-the-box.

## 6. chi route for the webhook (manual — not in openapi.yaml)

After the generated `apigen.HandlerFromMux(...)` line in main.go:

```go
r.Post("/api/v1/notify/telegram/webhook", notifyWebhook.HandlerFunc())
```

> TODO (openapi): add `POST /notify/telegram/webhook` to
> `shared/openapi.yaml` so the generated server interface owns this route. For
> MVP the route is wired manually — the bot sends JSON bodies of shape
> `tgbotapi.Update`, and the secret query param prevents drive-by POSTs.

## 7. Boot hook (setWebhook)

After the HTTP server is listening:

```go
if cfg.Env != "local" {
    if err := notifyTG.RegisterWebhook(ctx); err != nil {
        log.Warn("notify.telegram: RegisterWebhook failed", slog.Any("err", err))
        // non-fatal — the bot just won't receive updates until retried
    }
}
```

## 8. Background goroutines

```go
go notifyWorker.Run(ctx)
go notifySched.Run(ctx)
```

## 9. Graceful shutdown order

```go
// order matters: stop producers first, then drain, then close senders.
cancel() // cancels ctx — workers and scheduler exit their loops
// worker's wg.Wait() inside Run drains in-flight messages up to ~2s BRPOP timeout
if err := notifyTG.Close(shutdownCtx); err != nil {
    log.Warn("notify.telegram.Close", slog.Any("err", err))
}
redisClient.Close()
pgPool.Close()
```

## 10. Openapi follow-ups to flag

1. `POST /notify/telegram/webhook?secret=<…>` is NOT in openapi.yaml. Add an
   entry (tags: notify, private: true) so codegen owns the route — then
   replace the manual `r.Post(…)` with the generated handler.
2. A deep-link auth flow (`/start <auth_token>` from the bot) needs
   `POST /auth/telegram/deeplink/exchange` — currently the bot dispatcher
   replies with a placeholder (see `bot_dispatcher.go`).
3. Welcome and `subscription_activated` currently reuse existing template
   slots — consider adding dedicated `NotificationType` values in the next
   iteration of `shared/enums/notification.go`.
