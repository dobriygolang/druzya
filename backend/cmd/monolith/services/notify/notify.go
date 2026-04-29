package notify

import (
	"context"
	"fmt"
	"os"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	notifyApp "druz9/notify/app"
	notifyDomain "druz9/notify/domain"
	notifyInfra "druz9/notify/infra"
	notifyPorts "druz9/notify/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NotifyModule extends Module with the Telegram webhook handler — it lives
// at /api/v1/notify/telegram/webhook OUTSIDE the bearer-auth gate and so
// can't be expressed via MountREST (which is gated). router.go mounts the
// webhook explicitly.
type NotifyModule struct {
	monolithServices.Module
	WebhookHandler  *notifyPorts.WebhookHandler
	RegisterWebhook func(ctx context.Context) error
	// Bot is exposed so the bootstrap can call SetCodeFiller after the auth
	// module is constructed (cyclic-dep avoidance — auth depends on the bus,
	// notify depends on auth's RedisTelegramCodeRepo).
	// SetStreakReader is called immediately after construction — streak data
	// lives in a shared pool so there is no cyclic dep.
	Bot *notifyInfra.TelegramBot
	// Handlers is exposed so bootstrap can attach late-bound bridges
	// after their source modules wire.
	Handlers *notifyApp.Handlers
	// Prefs — exposed so cross-domain adapters (e.g. hone Cue follow-up TG)
	// can resolve telegram_chat_id without going through the full notify
	// pipeline. Read-only consumers; the bot itself owns writes.
	Prefs notifyDomain.PreferencesRepo
}

// NewNotify wires notifications: prefs CRUD, the multi-channel sender,
// the worker pool, the weekly-report scheduler and the Telegram bot. The
// worker / scheduler run as Background goroutines; the Telegram bot is
// closed during Shutdown so its long-poll loop unwinds before HTTP exits.
func NewNotify(d monolithServices.Deps) (*NotifyModule, error) {
	pg := notifyInfra.NewPostgres(d.Pool)
	streakPg := notifyInfra.NewStreakPostgres(d.Pool)
	queue := notifyInfra.NewRedisQueue(d.Redis)
	rl := notifyInfra.NewRedisRateLimiter(d.Redis)
	templates, err := notifyInfra.NewTemplates()
	if err != nil {
		return nil, fmt.Errorf("notify.templates: %w", err)
	}
	tg, err := notifyInfra.NewTelegramBot(notifyInfra.TelegramBotConfig{
		Token:         d.Cfg.Notify.TelegramBotToken,
		WebhookSecret: d.Cfg.Notify.TelegramWebhookSecret,
		PublicBaseURL: d.Cfg.Notify.PublicBaseURL,
		Env:           d.Cfg.Env,
	}, d.Log, pg, pg)
	if err != nil {
		return nil, fmt.Errorf("notify.telegram: %w", err)
	}
	// Streak data lives in daily_streaks on the same shared pool — no cyclic
	// dependency, wire immediately.
	tg.SetStreakReader(streakPg)
	email := notifyInfra.NewEmailSender(d.Log, d.Cfg.Notify.SMTPHost, d.Cfg.Notify.SMTPPort, d.Cfg.Notify.SMTPUser)
	push := notifyInfra.NewWebPushSender(d.Log)

	get := &notifyApp.GetPreferences{Prefs: pg, Log: d.Log}
	upd := &notifyApp.UpdatePreferences{Prefs: pg, Log: d.Log}
	logs := notifyInfra.NewNoopLogRepo()
	send := &notifyApp.SendNotification{
		Prefs: pg, Logs: logs, Templates: templates, Queue: queue,
		Users: pg, Log: d.Log, Now: d.Now,
	}
	handlers := notifyApp.NewHandlers(send, d.Log).WithPrefs(pg)
	server := notifyPorts.NewNotifyServer(get, upd, d.Log)
	webhook := notifyPorts.NewWebhookHandler(tg, d.Cfg.Notify.TelegramWebhookSecret, d.Log)

	worker := &notifyApp.Worker{
		Queue: queue, Prefs: pg, Logs: logs, Templates: templates,
		Senders: map[enums.NotificationChannel]notifyDomain.Sender{
			enums.NotificationChannelTelegram: tg,
			enums.NotificationChannelEmail:    email,
			enums.NotificationChannelPush:     push,
		},
		RateLimit: rl, Log: d.Log, PoolSize: 2,
	}
	// Persistent state-store для scheduler'а идемпотентности. Важно:
	// присваиваем в interface-поле только если конкретный тип не nil,
	// иначе Go typed-nil ловушка — scheduler получит non-nil interface
	// с nil-pointer и панкнет на первом же вызове метода.
	var schedStore notifyApp.SchedulerStateStore
	if d.Redis != nil {
		schedStore = notifyInfra.NewRedisSchedulerState(d.Redis)
	}
	sched := &notifyApp.WeeklyReportScheduler{
		Prefs: pg, Bus: d.Bus, Log: d.Log,
		Store:    schedStore,
		Location: time.UTC, Hour: 20, Weekday: time.Sunday,
	}

	connectPath, connectHandler := druz9v1connect.NewNotifyServiceHandler(server)
	transcoder := monolithServices.MustTranscode("notify", connectPath, connectHandler)

	// Support form (POST /api/v1/support/ticket): chi-route, потому что это
	// один POST-endpoint и не стоит регенерации proto. Forwards в support-чат
	// через TG-бот (если SUPPORT_TELEGRAM_CHAT_ID задан).
	supportRepo := notifyInfra.NewSupportPostgres(d.Pool)
	supportNotifier := notifyInfra.NewSupportBotNotifier(tg, os.Getenv("SUPPORT_TELEGRAM_CHAT_ID"))
	supportHandler := &notifyPorts.SupportHandler{
		Repo:      supportRepo,
		BotNotify: supportNotifier,
		Log:       d.Log,
	}

	// In-app notifications feed (см. миграция 00017).
	userNotifPg := notifyInfra.NewUserNotifPostgres(d.Pool)
	prefsPg := notifyInfra.NewPrefsPostgres(d.Pool)
	feedHandlers := notifyApp.NewFeedHandlers(userNotifPg, prefsPg, d.Log)
	userNotifHandler := notifyPorts.NewUserNotificationsHandler(notifyPorts.UserNotificationsHandler{
		List:        &notifyApp.ListUserNotifications{Repo: userNotifPg, Prefs: prefsPg, Log: d.Log},
		Unread:      &notifyApp.CountUnread{Repo: userNotifPg},
		MarkRead:    &notifyApp.MarkRead{Repo: userNotifPg},
		MarkAllRead: &notifyApp.MarkAllRead{Repo: userNotifPg},
		GetPrefs:    &notifyApp.GetPrefs{Repo: prefsPg},
		UpdatePrefs: &notifyApp.UpdatePrefs{Repo: prefsPg},
		Log:         d.Log,
	})
	// Same UCs are also bound onto NotifyServer so /notifications/* and
	// /support/ticket flow through the vanguard transcoder. Prefs (GET/PUT)
	// stay on chi because their wire shape differs from /notify/preferences.
	server.List = &notifyApp.ListUserNotifications{Repo: userNotifPg, Prefs: prefsPg, Log: d.Log}
	server.Unread = &notifyApp.CountUnread{Repo: userNotifPg}
	server.MarkReadUC = &notifyApp.MarkRead{Repo: userNotifPg}
	server.MarkAllReadUC = &notifyApp.MarkAllRead{Repo: userNotifPg}
	server.Support = supportHandler

	mod := &NotifyModule{
		WebhookHandler:  webhook,
		RegisterWebhook: tg.RegisterWebhook,
		Bot:             tg,
		Handlers:        handlers,
		Prefs:           pg,
		Module: monolithServices.Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				r.Get("/notify/preferences", transcoder.ServeHTTP)
				r.Put("/notify/preferences", transcoder.ServeHTTP)
				// /support/ticket — public POST. Mounted in MountREST
				// because router.go whitelists this exact path for
				// anonymous access; transcoder serves it via the bound
				// NotifyServer.Support shim.
				r.Post("/support/ticket", transcoder.ServeHTTP)
				// In-app notifications feed (list/unread/read_all/{id}/read
				// flow through transcoder; prefs stay chi — different shape
				// from /notify/preferences).
				r.Get("/notifications", transcoder.ServeHTTP)
				r.Get("/notifications/unread_count", transcoder.ServeHTTP)
				r.Post("/notifications/read_all", transcoder.ServeHTTP)
				r.Post("/notifications/{id}/read", transcoder.ServeHTTP)
				// Prefs — chi (different wire shape from /notify/preferences).
				r.Get("/notifications/prefs", userNotifHandler.HandleGetPrefs)
				r.Put("/notifications/prefs", userNotifHandler.HandleUpdatePrefs)
				_ = feedHandlers // legacy reference
			},
			Subscribers: []func(*eventbus.InProcess){
				func(b *eventbus.InProcess) {
					b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), handlers.OnDailyKataCompleted)
					b.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), handlers.OnDailyKataMissed)
					b.Subscribe(sharedDomain.MatchStarted{}.Topic(), handlers.OnMatchStarted)
					b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), handlers.OnMatchCompleted)
					b.Subscribe(sharedDomain.SubscriptionActivated{}.Topic(), handlers.OnSubscriptionActivated)
					b.Subscribe(sharedDomain.SkillDecayed{}.Topic(), handlers.OnSkillDecayed)
					b.Subscribe(sharedDomain.UserRegistered{}.Topic(), handlers.OnUserRegistered)
					b.Subscribe(sharedDomain.SlotBooked{}.Topic(), handlers.OnSlotBooked)
					b.Subscribe(notifyDomain.WeeklyReportDue{}.Topic(), handlers.OnWeeklyReportDue)
					b.Subscribe(sharedDomain.EventStartingSoon{}.Topic(), handlers.OnEventStartingSoon)
					// Legitimate path привязки telegram_chat_id: auth публикует
					// TelegramChatLinked после криптографически-безопасного /start <code>.
					b.Subscribe(sharedDomain.TelegramChatLinked{}.Topic(), handlers.OnTelegramChatLinked)

					// In-app notifications feed (NotificationsPage).
					b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), feedHandlers.OnArenaMatchCompleted)
					b.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), feedHandlers.OnDailyKataMissed)
					b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), feedHandlers.OnDailyKataCompletedFeed)
					b.Subscribe("friends.RequestReceived", feedHandlers.OnFriendRequest)
				},
			},
			Background: []func(ctx context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
				func(ctx context.Context) { go sched.Run(ctx) },
			},
			Shutdown: []func(ctx context.Context) error{
				func(ctx context.Context) error { return tg.Close(ctx) },
			},
		},
	}
	return mod, nil
}
