package services

import (
	"context"
	"fmt"
	"time"

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
	Module
	WebhookHandler  *notifyPorts.WebhookHandler
	RegisterWebhook func(ctx context.Context) error
	// Bot is exposed so the bootstrap can call SetCodeFiller after the auth
	// module is constructed (cyclic-dep avoidance — auth depends on the bus,
	// notify depends on auth's RedisTelegramCodeRepo).
	Bot *notifyInfra.TelegramBot
}

// NewNotify wires notifications: prefs CRUD, the multi-channel sender,
// the worker pool, the weekly-report scheduler and the Telegram bot. The
// worker / scheduler run as Background goroutines; the Telegram bot is
// closed during Shutdown so its long-poll loop unwinds before HTTP exits.
func NewNotify(d Deps) (*NotifyModule, error) {
	pg := notifyInfra.NewPostgres(d.Pool)
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
	email := notifyInfra.NewEmailSender(d.Log, d.Cfg.Notify.SMTPHost, d.Cfg.Notify.SMTPPort, d.Cfg.Notify.SMTPUser)
	push := notifyInfra.NewWebPushSender(d.Log)

	get := &notifyApp.GetPreferences{Prefs: pg, Log: d.Log}
	upd := &notifyApp.UpdatePreferences{Prefs: pg, Log: d.Log}
	send := &notifyApp.SendNotification{
		Prefs: pg, Logs: pg, Templates: templates, Queue: queue,
		Users: pg, Log: d.Log, Now: d.Now,
	}
	handlers := notifyApp.NewHandlers(send, d.Log)
	server := notifyPorts.NewNotifyServer(get, upd, d.Log)
	webhook := notifyPorts.NewWebhookHandler(tg, d.Cfg.Notify.TelegramWebhookSecret, d.Log)

	worker := &notifyApp.Worker{
		Queue: queue, Prefs: pg, Logs: pg, Templates: templates,
		Senders: map[enums.NotificationChannel]notifyDomain.Sender{
			enums.NotificationChannelTelegram: tg,
			enums.NotificationChannelEmail:    email,
			enums.NotificationChannelPush:     push,
		},
		RateLimit: rl, Log: d.Log, PoolSize: 2,
	}
	sched := &notifyApp.WeeklyReportScheduler{
		Prefs: pg, Bus: d.Bus, Log: d.Log,
		Location: time.UTC, Hour: 20, Weekday: time.Sunday,
	}

	connectPath, connectHandler := druz9v1connect.NewNotifyServiceHandler(server)
	transcoder := mustTranscode("notify", connectPath, connectHandler)

	mod := &NotifyModule{
		WebhookHandler:  webhook,
		RegisterWebhook: tg.RegisterWebhook,
		Bot:             tg,
		Module: Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				r.Get("/notify/preferences", transcoder.ServeHTTP)
				r.Put("/notify/preferences", transcoder.ServeHTTP)
			},
			Subscribers: []func(*eventbus.InProcess){
				func(b *eventbus.InProcess) {
					b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), handlers.OnDailyKataCompleted)
					b.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), handlers.OnDailyKataMissed)
					b.Subscribe(sharedDomain.MatchStarted{}.Topic(), handlers.OnMatchStarted)
					b.Subscribe(sharedDomain.MatchCompleted{}.Topic(), handlers.OnMatchCompleted)
					b.Subscribe(sharedDomain.GuildWarStarted{}.Topic(), handlers.OnGuildWarStarted)
					b.Subscribe(sharedDomain.GuildWarFinished{}.Topic(), handlers.OnGuildWarFinished)
					b.Subscribe(sharedDomain.SubscriptionActivated{}.Topic(), handlers.OnSubscriptionActivated)
					b.Subscribe(sharedDomain.SkillDecayed{}.Topic(), handlers.OnSkillDecayed)
					b.Subscribe(sharedDomain.UserRegistered{}.Topic(), handlers.OnUserRegistered)
					b.Subscribe(sharedDomain.SlotBooked{}.Topic(), handlers.OnSlotBooked)
					b.Subscribe(notifyDomain.WeeklyReportDue{}.Topic(), handlers.OnWeeklyReportDue)
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
