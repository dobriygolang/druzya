// Command monolith boots every domain as an in-process service.
// When a domain is extracted to its own deployment, only this file changes —
// domain code stays identical.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"

	aimockApp "druz9/ai_mock/app"
	aimockDomain "druz9/ai_mock/domain"
	aimockInfra "druz9/ai_mock/infra"
	aimockPorts "druz9/ai_mock/ports"

	ainativeApp "druz9/ai_native/app"
	ainativeDomain "druz9/ai_native/domain"
	ainativeInfra "druz9/ai_native/infra"
	ainativePorts "druz9/ai_native/ports"

	guildApp "druz9/guild/app"
	guildDomain "druz9/guild/domain"
	guildInfra "druz9/guild/infra"
	guildPorts "druz9/guild/ports"

	arenaApp "druz9/arena/app"
	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	arenaPorts "druz9/arena/ports"

	authApp "druz9/auth/app"
	authInfra "druz9/auth/infra"
	authPorts "druz9/auth/ports"

	dailyApp "druz9/daily/app"
	dailyInfra "druz9/daily/infra"
	dailyPorts "druz9/daily/ports"

	editorApp "druz9/editor/app"
	editorInfra "druz9/editor/infra"
	editorPorts "druz9/editor/ports"

	feedApp "druz9/feed/app"
	feedPorts "druz9/feed/ports"

	podcastApp "druz9/podcast/app"
	podcastInfra "druz9/podcast/infra"
	podcastPorts "druz9/podcast/ports"

	seasonApp "druz9/season/app"
	seasonInfra "druz9/season/infra"
	seasonPorts "druz9/season/ports"

	notifyApp "druz9/notify/app"
	notifyDomain "druz9/notify/domain"
	notifyInfra "druz9/notify/infra"
	notifyPorts "druz9/notify/ports"

	profileApp "druz9/profile/app"
	profileInfra "druz9/profile/infra"
	profilePorts "druz9/profile/ports"

	ratingApp "druz9/rating/app"
	ratingInfra "druz9/rating/infra"
	ratingPorts "druz9/rating/ports"

	slotApp "druz9/slot/app"
	slotInfra "druz9/slot/infra"
	slotPorts "druz9/slot/ports"

	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/logger"
	"druz9/shared/pkg/metrics"
	mw "druz9/shared/pkg/middleware"

	"connectrpc.com/vanguard"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}
	log := logger.New(cfg.Env)
	slog.SetDefault(log)

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// ── Postgres
	pool, err := pgxpool.New(rootCtx, cfg.PostgresDSN)
	if err != nil {
		log.Error("postgres pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// ── Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPass,
	})
	defer func() { _ = rdb.Close() }()

	// ── Event bus
	bus := eventbus.NewInProcess(log)

	now := func() time.Time { return time.Now() }

	// ── Auth wiring
	encKey := os.Getenv("ENCRYPTION_KEY")
	if encKey == "" {
		log.Error("ENCRYPTION_KEY env is required for OAuth token encryption")
		os.Exit(1)
	}
	encryptor, err := authInfra.NewAESGCMEncryptor(encKey)
	if err != nil {
		log.Error("encryptor", "err", err)
		os.Exit(1)
	}
	authPG := authInfra.NewPostgres(pool)
	authSessions := authInfra.NewRedisSessions(rdb, time.Duration(cfg.Auth.RefreshTokenTTL)*time.Second)
	authLimiter := authInfra.NewRedisRateLimiter(rdb)
	yandex := authInfra.NewYandexOAuth(cfg.Auth.YandexClientID, cfg.Auth.YandexSecret)
	tokenIssuer := authApp.NewTokenIssuer(cfg.Auth.JWTSecret, time.Duration(cfg.Auth.AccessTokenTTL)*time.Second)

	loginYandex := &authApp.LoginYandex{
		OAuth: yandex, Users: authPG, Sessions: authSessions, Limiter: authLimiter,
		Bus: bus, Issuer: tokenIssuer, Enc: encryptor,
		RefreshTTL: time.Duration(cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        log,
	}
	loginTelegram := &authApp.LoginTelegram{
		BotToken: cfg.Auth.TelegramBotToken,
		Users:    authPG, Sessions: authSessions, Limiter: authLimiter,
		Bus: bus, Issuer: tokenIssuer,
		RefreshTTL: time.Duration(cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        log,
	}
	refresh := &authApp.Refresh{
		Users: authPG, Sessions: authSessions, Issuer: tokenIssuer,
		RefreshTTL: time.Duration(cfg.Auth.RefreshTokenTTL) * time.Second,
	}
	logout := &authApp.Logout{Sessions: authSessions}
	authH := authPorts.NewHandler(authPorts.Handler{
		LoginYandex: loginYandex, LoginTelegram: loginTelegram,
		Refresh: refresh, Logout: logout,
		Issuer: tokenIssuer, Users: authPG, Log: log,
		SecureCookies: cfg.Env != "local", CookieDomain: "",
	})
	requireAuth := authPorts.RequireAuth(tokenIssuer)
	authServer := authPorts.NewAuthServer(authH)

	// ── Profile wiring
	profilePG := profileInfra.NewPostgres(pool)
	profileH := profilePorts.NewHandler(profilePorts.Handler{
		GetProfile:     &profileApp.GetProfile{Repo: profilePG},
		GetPublic:      &profileApp.GetPublic{Repo: profilePG},
		GetAtlas:       &profileApp.GetAtlas{Repo: profilePG},
		GetReport:      &profileApp.GetReport{Repo: profilePG},
		GetSettings:    &profileApp.GetSettings{Repo: profilePG},
		UpdateSettings: &profileApp.UpdateSettings{Repo: profilePG},
		Log:            log,
	})
	profileServer := profilePorts.NewProfileServer(profileH)
	onUserRegistered := &profileApp.OnUserRegistered{Repo: profilePG, Log: log}
	onXPGained := &profileApp.OnXPGained{Repo: profilePG, Bus: bus, Log: log}
	onRatingChanged := &profileApp.OnRatingChanged{Repo: profilePG, Log: log}

	// ── Daily wiring
	tasksKatas := dailyInfra.NewTasksKatas(pool)
	streaks := dailyInfra.NewStreaks(pool)
	calendars := dailyInfra.NewCalendars(pool)
	autopsies := dailyInfra.NewAutopsies(pool)
	judge := dailyInfra.NewFakeJudge0()
	analyser := &dailyApp.FakeAnalyser{Autopsies: autopsies, Log: log}

	dailyH := dailyPorts.NewHandler(dailyPorts.Handler{
		GetKata:        &dailyApp.GetKata{Skills: tasksKatas, Tasks: tasksKatas, Katas: tasksKatas, Now: now},
		SubmitKata:     &dailyApp.SubmitKata{Tasks: tasksKatas, Katas: tasksKatas, Streaks: streaks, Judge: judge, Bus: bus, Log: log, Now: now},
		GetStreak:      &dailyApp.GetStreak{Streaks: streaks, Katas: tasksKatas, Now: now},
		GetCalendar:    &dailyApp.GetCalendar{Cal: calendars, Now: now},
		UpsertCalendar: &dailyApp.UpsertCalendar{Cal: calendars, Now: now},
		CreateAutopsy:  &dailyApp.CreateAutopsy{Autopsies: autopsies, Bus: bus, Log: log, Analyse: analyser},
		GetAutopsy:     &dailyApp.GetAutopsy{Autopsies: autopsies},
		Log:            log,
	})
	dailyServer := dailyPorts.NewDailyServer(dailyH)
	onKataCompleted := &dailyApp.OnDailyKataCompleted{Bus: bus, Log: log}

	// ── Rating wiring
	ratingPG := ratingInfra.NewPostgres(pool)
	ratingCache := ratingInfra.NewRedisLeaderboard(rdb)
	getMyRatings := &ratingApp.GetMyRatings{Ratings: ratingPG}
	getLeaderboard := &ratingApp.GetLeaderboard{
		Ratings: ratingPG,
		Cache:   ratingCache,
		Log:     log,
		TTL:     60 * time.Second,
	}
	ratingServer := ratingPorts.NewRatingServer(getMyRatings, getLeaderboard, log)
	onMatchCompletedRating := &ratingApp.OnMatchCompleted{Ratings: ratingPG, Bus: bus, Log: log}
	onRatingKataCompleted := &ratingApp.OnDailyKataCompleted{Ratings: ratingPG, Bus: bus, Log: log}

	// ── Arena wiring
	arenaPG := arenaInfra.NewPostgres(pool)
	arenaRedis := arenaInfra.NewRedis(rdb)
	arenaJudge0 := arenaInfra.NewFakeJudge0()
	arenaClock := arenaDomain.RealClock{}
	arenaVerifier := tokenVerifierAdapter{issuer: tokenIssuer}
	allowedOrigins := strings.Split(os.Getenv("WS_ALLOWED_ORIGINS"), ",")
	arenaHub := arenaPorts.NewHub(log, arenaVerifier, allowedOrigins)

	arenaFind := &arenaApp.FindMatch{Queue: arenaRedis, Clock: arenaClock}
	arenaCancel := &arenaApp.CancelSearch{Queue: arenaRedis}
	arenaGet := &arenaApp.GetMatch{Matches: arenaPG, Tasks: arenaPG}
	arenaConfirm := &arenaApp.ConfirmReady{
		Matches: arenaPG, Ready: arenaRedis, Bus: bus,
		Notifier: arenaHub, Clock: arenaClock, Log: log,
	}
	arenaTimeouts := &arenaApp.HandleReadyCheckTimeout{
		Queue: arenaRedis, Matches: arenaPG, Ready: arenaRedis,
		Bus: bus, Clock: arenaClock, Log: log,
	}
	arenaSubmit := &arenaApp.SubmitCode{
		Matches: arenaPG, Tasks: arenaPG, Judge0: arenaJudge0,
		Anticheat: arenaRedis, Bus: bus, Clock: arenaClock, Log: log,
	}
	arenaPaste := &arenaApp.OnPasteAttempt{Anticheat: arenaRedis, Bus: bus}
	arenaTab := &arenaApp.OnTabSwitch{Anticheat: arenaRedis, Bus: bus}
	arenaHub.OnPaste = func(ctx context.Context, matchID, userID uuid.UUID) {
		_ = arenaPaste.Apply(ctx, matchID, userID)
	}
	arenaHub.OnTab = func(ctx context.Context, matchID, userID uuid.UUID) {
		_ = arenaTab.Apply(ctx, matchID, userID)
	}
	arenaEloFn := arenaPorts.UserEloFunc(func(ctx any, userID uuid.UUID, section enums.Section) int {
		c, _ := ctx.(context.Context)
		if c == nil {
			c = context.Background()
		}
		list, listErr := ratingPG.List(c, userID)
		if listErr != nil {
			return arenaDomain.InitialELO
		}
		for _, r := range list {
			if r.Section == section {
				return r.Elo
			}
		}
		return arenaDomain.InitialELO
	})
	arenaServer := arenaPorts.NewArenaServer(
		arenaFind, arenaCancel, arenaConfirm, arenaSubmit, arenaGet, arenaTimeouts,
		arenaEloFn, log,
	)
	arenaMatchmaker := arenaApp.NewMatchmaker(
		arenaRedis, arenaRedis, arenaPG, arenaPG, bus, arenaHub, arenaClock, log,
	)
	stopArena := arenaMatchmaker.Start(rootCtx)

	// ── AI Mock wiring
	mockSessions := aimockInfra.NewSessions(pool)
	mockMessages := aimockInfra.NewMessages(pool)
	mockTasks := aimockInfra.NewTasks(pool)
	mockCompanies := aimockInfra.NewCompanies(pool)
	mockUsers := aimockInfra.NewUsers(pool)
	mockLLM := aimockInfra.NewOpenRouter(cfg.LLM.OpenRouterAPIKey)
	mockReplay := aimockInfra.NewStubReplayUploader(cfg.MinIO.Endpoint)
	mockLimiter := aimockInfra.NewRedisLimiter(rdb)
	mockHub := aimockPorts.NewHub(log)

	reportWorker := aimockApp.NewReportWorker(2, 64, log)
	reportWorker.Sessions = mockSessions
	reportWorker.Messages = mockMessages
	reportWorker.Tasks = mockTasks
	reportWorker.LLM = mockLLM
	reportWorker.Replay = mockReplay
	reportWorker.Start(rootCtx)

	createMock := &aimockApp.CreateSession{
		Sessions: mockSessions, Tasks: mockTasks, Users: mockUsers, Companies: mockCompanies,
		Bus:              bus,
		DefaultModelFree: enums.LLMModel(cfg.LLM.DefaultModelFree),
		DefaultModelPaid: enums.LLMModel(cfg.LLM.DefaultModelPaid),
		Log:              log, Now: now,
	}
	getMock := &aimockApp.GetSession{
		Sessions: mockSessions, Messages: mockMessages, Tasks: mockTasks,
		LastMessagesLimit: 20,
	}
	sendMock := &aimockApp.SendMessage{
		Sessions: mockSessions, Messages: mockMessages, Tasks: mockTasks,
		Users: mockUsers, Companies: mockCompanies,
		LLM: mockLLM, Limiter: mockLimiter, Log: log, Now: now,
	}
	stressMock := &aimockApp.IngestStress{
		Sessions: mockSessions,
		Emit: func(sid uuid.UUID, c aimockDomain.StressCrossing) {
			mockHub.BroadcastStressUpdate(sid, c)
		},
	}
	finishMock := &aimockApp.FinishSession{
		Sessions: mockSessions, Bus: bus, Worker: reportWorker, Log: log, Now: now,
	}
	reportMock := &aimockApp.GetReport{Sessions: mockSessions}

	mockServer := aimockPorts.NewMockServer(createMock, getMock, sendMock, stressMock, finishMock, reportMock, log)
	mockWS := aimockPorts.NewWSHandler(mockHub, mockTokenVerifierAdapter{issuer: tokenIssuer}, mockSessions, mockMessages, sendMock, stressMock, log)

	// ── AI Native wiring (bible §19.1)
	nativeSessions := ainativeInfra.NewSessions(pool)
	nativeProvenance := ainativeInfra.NewProvenance(pool)
	nativeTasks := ainativeInfra.NewTasks(pool)
	nativeUsers := ainativeInfra.NewUsers(pool)
	nativeLLM := ainativeInfra.NewOpenRouter(cfg.LLM.OpenRouterAPIKey)
	nativeTraps := ainativeInfra.NewStaticTrapStore()

	createNative := &ainativeApp.CreateSession{
		Sessions: nativeSessions, Tasks: nativeTasks, Users: nativeUsers,
		DefaultModelFree: enums.LLMModel(cfg.LLM.DefaultModelFree),
		DefaultModelPaid: enums.LLMModel(cfg.LLM.DefaultModelPaid),
		Log:              log, Now: now,
	}
	submitNative := &ainativeApp.SubmitPrompt{
		Sessions: nativeSessions, Provenance: nativeProvenance,
		Tasks: nativeTasks, Users: nativeUsers,
		LLM: nativeLLM, Traps: nativeTraps,
		Policy:  ainativeDomain.DefaultTrapPolicy(),
		Scoring: ainativeDomain.DefaultScoring(),
		Log:     log,
	}
	verifyNative := &ainativeApp.Verify{
		Sessions: nativeSessions, Provenance: nativeProvenance,
		Scoring: ainativeDomain.DefaultScoring(), Log: log,
	}
	getProvNative := &ainativeApp.GetProvenance{
		Sessions: nativeSessions, Provenance: nativeProvenance,
	}
	getScoreNative := &ainativeApp.GetScore{Sessions: nativeSessions}
	finishNative := &ainativeApp.Finish{
		Sessions: nativeSessions, Provenance: nativeProvenance,
		Bus: bus, Scoring: ainativeDomain.DefaultScoring(), Log: log, Now: now,
	}
	nativeServer := ainativePorts.NewNativeServer(
		createNative, submitNative, verifyNative,
		getProvNative, getScoreNative, finishNative, log,
	)

	// ── Slot wiring (Human Mock Interview)
	slotPG := slotInfra.NewPostgres(pool)
	slotMeet := slotInfra.NewMockMeetRoom()
	slotCreate := &slotApp.CreateSlot{Slots: slotPG, Now: time.Now}
	slotList := &slotApp.ListSlots{Slots: slotPG, Reviews: slotPG}
	slotBook := &slotApp.BookSlot{Slots: slotPG, Meet: slotMeet, Bus: bus, Log: log, Now: time.Now}
	slotCancel := &slotApp.CancelSlot{Slots: slotPG, Bus: bus, Log: log}
	slotApp.SubscribeHandlers(bus)
	slotServer := slotPorts.NewSlotServer(slotList, slotCreate, slotBook, slotCancel, log)

	// ── Guild wiring
	guildPG := guildInfra.NewPostgres(pool)
	guildJudge0 := guildInfra.NewFakeJudge0()
	guildClock := guildDomain.RealClock{}
	guildMyGuild := &guildApp.GetMyGuild{Guilds: guildPG, Wars: guildPG, Clock: guildClock}
	guildGet := &guildApp.GetGuild{Guilds: guildPG, Wars: guildPG, Clock: guildClock}
	guildWar := &guildApp.GetWar{Guilds: guildPG, Wars: guildPG, Clock: guildClock}
	guildContribute := &guildApp.Contribute{
		Guilds: guildPG, Wars: guildPG, Judge0: guildJudge0,
		GetWar: guildWar, Clock: guildClock, Log: log,
	}
	guildOnMatch := &guildApp.OnMatchCompleted{Guilds: guildPG, Log: log}
	guildApp.SubscribeHandlers(bus, guildOnMatch)
	guildServer := guildPorts.NewGuildServer(
		guildMyGuild, guildGet, guildWar, guildContribute, log,
	)

	// ── Notify wiring
	notifyPG := notifyInfra.NewPostgres(pool)
	notifyQueue := notifyInfra.NewRedisQueue(rdb)
	notifyRL := notifyInfra.NewRedisRateLimiter(rdb)
	notifyTemplates, err := notifyInfra.NewTemplates()
	if err != nil {
		log.Error("notify.templates", "err", err)
		os.Exit(1)
	}
	notifyTG, err := notifyInfra.NewTelegramBot(notifyInfra.TelegramBotConfig{
		Token:         cfg.Notify.TelegramBotToken,
		WebhookSecret: cfg.Notify.TelegramWebhookSecret,
		PublicBaseURL: cfg.Notify.PublicBaseURL,
		Env:           cfg.Env,
	}, log, notifyPG, notifyPG)
	if err != nil {
		log.Error("notify.telegram", "err", err)
		os.Exit(1)
	}
	notifyEmail := notifyInfra.NewEmailSender(log, cfg.Notify.SMTPHost, cfg.Notify.SMTPPort, cfg.Notify.SMTPUser)
	notifyPush := notifyInfra.NewWebPushSender(log)

	notifyGet := &notifyApp.GetPreferences{Prefs: notifyPG, Log: log}
	notifyUpd := &notifyApp.UpdatePreferences{Prefs: notifyPG, Log: log}
	notifySend := &notifyApp.SendNotification{
		Prefs:     notifyPG,
		Logs:      notifyPG,
		Templates: notifyTemplates,
		Queue:     notifyQueue,
		Users:     notifyPG,
		Log:       log,
		Now:       now,
	}
	notifyH := notifyApp.NewHandlers(notifySend, log)
	notifySrv := notifyPorts.NewNotifyServer(notifyGet, notifyUpd, log)
	notifyWebhook := notifyPorts.NewWebhookHandler(notifyTG, cfg.Notify.TelegramWebhookSecret, log)

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
	notifySched := &notifyApp.WeeklyReportScheduler{
		Prefs:    notifyPG,
		Bus:      bus,
		Log:      log,
		Location: time.UTC,
		Hour:     20,
		Weekday:  time.Sunday,
	}

	// ── Feed (public WS — no auth — anonymised sanctum stream)
	feedHub := feedPorts.NewHub(log)
	feedSub := &feedApp.Subscriber{Out: feedHub, Log: log}
	feedSub.Register(bus)

	// ── Cross-domain event subscriptions
	bus.Subscribe(sharedDomain.UserRegistered{}.Topic(), onUserRegistered.Handle)
	bus.Subscribe(sharedDomain.XPGained{}.Topic(), onXPGained.Handle)
	bus.Subscribe(sharedDomain.RatingChanged{}.Topic(), onRatingChanged.Handle)
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), onKataCompleted.Handle)
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), onRatingKataCompleted.Handle)
	bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), onMatchCompletedRating.Handle)

	// Notify subscribes to everything user-facing.
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), notifyH.OnDailyKataCompleted)
	bus.Subscribe(sharedDomain.DailyKataMissed{}.Topic(), notifyH.OnDailyKataMissed)
	bus.Subscribe(sharedDomain.MatchStarted{}.Topic(), notifyH.OnMatchStarted)
	bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), notifyH.OnMatchCompleted)
	bus.Subscribe(sharedDomain.GuildWarStarted{}.Topic(), notifyH.OnGuildWarStarted)
	bus.Subscribe(sharedDomain.GuildWarFinished{}.Topic(), notifyH.OnGuildWarFinished)
	bus.Subscribe(sharedDomain.SubscriptionActivated{}.Topic(), notifyH.OnSubscriptionActivated)
	bus.Subscribe(sharedDomain.SkillDecayed{}.Topic(), notifyH.OnSkillDecayed)
	bus.Subscribe(sharedDomain.UserRegistered{}.Topic(), notifyH.OnUserRegistered)
	bus.Subscribe(sharedDomain.SlotBooked{}.Topic(), notifyH.OnSlotBooked)
	bus.Subscribe(notifyDomain.WeeklyReportDue{}.Topic(), notifyH.OnWeeklyReportDue)

	// ── Editor wiring (bible §3.1 collaborative code)
	editorRooms := editorInfra.NewRooms(pool)
	editorParts := editorInfra.NewParticipants(pool)
	editorReplay := editorInfra.NewStubReplayUploader(cfg.MinIO.Endpoint, time.Hour)
	editorHub := editorPorts.NewHub(log)
	editorHub.RoomResolver = editorRooms.Get
	editorHub.RoleResolver = editorParts.GetRole
	editorInviteSecret := os.Getenv("EDITOR_INVITE_SECRET")
	if editorInviteSecret == "" {
		editorInviteSecret = cfg.Auth.JWTSecret
	}
	editorCreate := &editorApp.CreateRoom{
		Rooms: editorRooms, Participants: editorParts,
		Log: log, Now: now, RoomTTL: 6 * time.Hour,
	}
	editorGet := &editorApp.GetRoom{Rooms: editorRooms, Participants: editorParts}
	editorFreeze := &editorApp.Freeze{
		Rooms: editorRooms, Participants: editorParts,
		Notifier: editorHub, Log: log,
	}
	editorInvite := &editorApp.CreateInvite{
		Rooms:   editorRooms,
		Secret:  []byte(editorInviteSecret),
		TTL:     24 * time.Hour,
		BaseURL: cfg.Notify.PublicBaseURL,
		Now:     now,
	}
	editorReplayUC := &editorApp.Replay{
		Rooms: editorRooms, Participants: editorParts,
		Uploader: editorReplay,
		Flush:    editorHub.FlushRoom,
	}
	editorServer := editorPorts.NewEditorServer(
		editorCreate, editorGet, editorInvite, editorFreeze, editorReplayUC,
		"/ws/editor", log,
	)
	editorVerifier := editorTokenVerifierAdapter{issuer: tokenIssuer}
	editorWS := editorPorts.NewWSHandler(editorHub, editorVerifier, editorRooms, editorParts, log)

	// ── Season wiring (bible §3.8 Season Pass)
	seasonPG := seasonInfra.NewPostgres(pool)
	seasonTiers := seasonInfra.NewStaticTiers()
	seasonChallenges := seasonInfra.NewStaticChallenges()
	seasonClaims := seasonInfra.NewMemClaimStore()
	seasonGetCurrent := seasonApp.NewGetCurrent(seasonPG, seasonTiers, seasonChallenges, seasonClaims)
	_ = seasonApp.NewClaimReward(seasonPG, seasonTiers, seasonClaims) // no HTTP route yet
	seasonOnXP := seasonApp.NewOnXPGained(seasonPG, seasonTiers, bus, log)
	seasonOnWin := seasonApp.NewOnMatchCompleted(seasonPG, seasonTiers, bus, log)
	seasonOnKata := seasonApp.NewOnDailyKataCompleted(seasonPG, seasonTiers, bus, log)
	seasonOnMock := seasonApp.NewOnMockSessionFinished(seasonPG, seasonTiers, bus, log)
	seasonApp.SubscribeHandlers(bus, seasonOnXP, seasonOnWin, seasonOnKata, seasonOnMock)
	seasonServer := seasonPorts.NewSeasonServer(seasonGetCurrent, log)

	// ── Podcast wiring (bible §3.9)
	podcastPG := podcastInfra.NewPostgres(pool)
	podcastSigner := podcastInfra.NewFakeSigner("/stream")
	podcastList := podcastApp.NewListCatalog(podcastPG, podcastSigner)
	podcastUpdate := podcastApp.NewUpdateProgress(podcastPG, bus, log)
	podcastApp.SubscribeHandlers(bus)
	podcastServer := podcastPorts.NewPodcastServer(podcastList, podcastUpdate, log)

	// ── Admin wiring (bible §3.14 CMS / ops surface)
	adminTasks := adminInfra.NewTasks(pool)
	adminCompanies := adminInfra.NewCompanies(pool)
	adminConfig := adminInfra.NewConfig(pool)
	adminAnticheat := adminInfra.NewAnticheat(pool)
	adminBroadcaster := adminInfra.NewRedisBroadcaster(rdb)
	adminListTasksUC := &adminApp.ListTasks{Tasks: adminTasks}
	adminCreateTaskUC := &adminApp.CreateTask{Tasks: adminTasks}
	adminUpdateTaskUC := &adminApp.UpdateTask{Tasks: adminTasks}
	adminListCompaniesUC := &adminApp.ListCompanies{Companies: adminCompanies}
	adminUpsertCompanyUC := &adminApp.UpsertCompany{Companies: adminCompanies}
	adminListConfigUC := &adminApp.ListConfig{Config: adminConfig}
	adminUpdateConfigUC := &adminApp.UpdateConfig{
		Config: adminConfig, Broadcaster: adminBroadcaster, Log: log,
	}
	adminListAnticheatUC := &adminApp.ListAnticheat{Anticheat: adminAnticheat}
	adminServer := adminPorts.NewAdminServer(
		adminListTasksUC, adminCreateTaskUC, adminUpdateTaskUC,
		adminListCompaniesUC, adminUpsertCompanyUC,
		adminListConfigUC, adminUpdateConfigUC,
		adminListAnticheatUC,
		log,
	)

	// ── Connect-RPC handlers — every domain. Each NewXxxServiceHandler
	// returns `(path, http.Handler)` where path is `/druz9.v1.XxxService/`.
	// We wrap each in a vanguard transcoder so the same handlers also serve
	// the REST paths declared via `google.api.http` annotations on the
	// service.
	//
	// Phase A: rating / auth / profile / daily / notify / guild.
	// Phase B: arena / ai_mock / ai_native.
	// Phase C (this pass): slot / editor / season / podcast / admin —
	// compositeServer (apigen.ServerInterface) is GONE; openapi.yaml +
	// apigen + oapi-codegen retired.
	ratingConnectPath, ratingConnectHandler := druz9v1connect.NewRatingServiceHandler(ratingServer)
	ratingTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(ratingConnectPath, ratingConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: rating", "err", err)
		os.Exit(1)
	}

	authConnectPath, authConnectHandler := druz9v1connect.NewAuthServiceHandler(authServer)
	authTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(authConnectPath, authConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: auth", "err", err)
		os.Exit(1)
	}

	profileConnectPath, profileConnectHandler := druz9v1connect.NewProfileServiceHandler(profileServer)
	profileTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(profileConnectPath, profileConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: profile", "err", err)
		os.Exit(1)
	}

	dailyConnectPath, dailyConnectHandler := druz9v1connect.NewDailyServiceHandler(dailyServer)
	dailyTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(dailyConnectPath, dailyConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: daily", "err", err)
		os.Exit(1)
	}

	notifyConnectPath, notifyConnectHandler := druz9v1connect.NewNotifyServiceHandler(notifySrv)
	notifyTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(notifyConnectPath, notifyConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: notify", "err", err)
		os.Exit(1)
	}

	guildConnectPath, guildConnectHandler := druz9v1connect.NewGuildServiceHandler(guildServer)
	guildTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(guildConnectPath, guildConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: guild", "err", err)
		os.Exit(1)
	}

	// Phase B: arena / ai_mock / ai_native. Same vanguard-transcoder pattern.
	// ai_native's SubmitPrompt is server-streaming — vanguard registers the
	// REST route but the REST protocol handler rejects streaming RPCs with
	// 415 at request time. Native Connect clients get full streaming; REST
	// clients should migrate to Connect for that one endpoint. Documented
	// in services/ai_native/ports/server.go.
	arenaConnectPath, arenaConnectHandler := druz9v1connect.NewArenaServiceHandler(arenaServer)
	arenaTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(arenaConnectPath, arenaConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: arena", "err", err)
		os.Exit(1)
	}

	mockConnectPath, mockConnectHandler := druz9v1connect.NewMockServiceHandler(mockServer)
	mockTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(mockConnectPath, mockConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: mock", "err", err)
		os.Exit(1)
	}

	nativeConnectPath, nativeConnectHandler := druz9v1connect.NewNativeServiceHandler(nativeServer)
	nativeTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(nativeConnectPath, nativeConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: native", "err", err)
		os.Exit(1)
	}

	// Phase C: slot / editor / season / podcast / admin — last 5 domains.
	slotConnectPath, slotConnectHandler := druz9v1connect.NewSlotServiceHandler(slotServer)
	slotTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(slotConnectPath, slotConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: slot", "err", err)
		os.Exit(1)
	}

	editorConnectPath, editorConnectHandler := druz9v1connect.NewEditorServiceHandler(editorServer)
	editorTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(editorConnectPath, editorConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: editor", "err", err)
		os.Exit(1)
	}

	seasonConnectPath, seasonConnectHandler := druz9v1connect.NewSeasonServiceHandler(seasonServer)
	seasonTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(seasonConnectPath, seasonConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: season", "err", err)
		os.Exit(1)
	}

	podcastConnectPath, podcastConnectHandler := druz9v1connect.NewPodcastServiceHandler(podcastServer)
	podcastTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(podcastConnectPath, podcastConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: podcast", "err", err)
		os.Exit(1)
	}

	adminConnectPath, adminConnectHandler := druz9v1connect.NewAdminServiceHandler(adminServer)
	adminTranscoder, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(adminConnectPath, adminConnectHandler),
	})
	if err != nil {
		log.Error("vanguard.NewTranscoder: admin", "err", err)
		os.Exit(1)
	}

	// ── HTTP router
	r := chi.NewRouter()
	r.Use(mw.RequestID)
	r.Use(mw.Logger(log))
	r.Use(mw.Recover(log))

	r.Get("/health", handleHealth)
	r.Get("/health/ready", readyHandler(pool, rdb))
	// Prometheus metrics endpoint (nginx restricts access to private IPs).
	r.Handle("/metrics", metrics.Handler())

	// WebSockets live OUTSIDE /api/v1 — they auth via `?token=` query param
	// and must NOT be wrapped in the requireAuth middleware.
	r.Route("/ws", func(ws chi.Router) {
		ws.Get("/arena/{matchId}", arenaHub.WSHandler)
		ws.Get("/mock/{sessionId}", mockWS.Handle)
		ws.Get("/editor/{roomId}", editorWS.Handle)
		// /ws/feed is PUBLIC — no auth, anonymized events only.
		ws.Get("/feed", feedHub.Handle)
	})

	// Routes that MUST bypass auth live in their own group so chi doesn't
	// panic on "middlewares must be defined before routes".
	r.Route("/api/v1", func(api chi.Router) {
		// Unauth'd: ping + telegram bot webhook (verifies its own shared secret).
		api.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"pong":true}`))
		})
		// TODO (openapi): add to shared/openapi.yaml so codegen owns the route.
		api.Post("/notify/telegram/webhook", notifyWebhook.HandlerFunc())

		// Gated group — every apigen-mounted route except `publicPaths` requires
		// bearer auth. Using Group() isolates the middleware from the routes
		// already registered above.
		api.Group(func(gated chi.Router) {
			// publicPaths are full REST paths (including the /api/v1 prefix
			// chi keeps on r.URL.Path) that bypass bearer auth. The first
			// three are the auth login/refresh endpoints (they issue tokens,
			// so they cannot require tokens). /api/v1/profile/{username} is
			// the public SEO profile lookup — we match it via a prefix check
			// because the actual path carries the username.
			publicPaths := map[string]struct{}{
				"/api/v1/auth/yandex":   {},
				"/api/v1/auth/telegram": {},
				"/api/v1/auth/refresh":  {},
			}
			isPublic := func(p string) bool {
				if _, ok := publicPaths[p]; ok {
					return true
				}
				// /api/v1/profile/{username} — public, but /api/v1/profile/me*
				// is NOT.
				if strings.HasPrefix(p, "/api/v1/profile/") && !strings.HasPrefix(p, "/api/v1/profile/me") {
					return true
				}
				return false
			}
			gate := func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if isPublic(r.URL.Path) {
						next.ServeHTTP(w, r)
						return
					}
					requireAuth(next).ServeHTTP(w, r)
				})
			}
			gated.Use(gate)

			// Connect-RPC REST routes — every `/api/v1/<domain>/*` path is
			// declared via `google.api.http` in the corresponding proto.
			// The vanguard transcoder serves both the REST path here AND
			// the native Connect path `/druz9.v1.<Domain>Service/*` mounted
			// at root (see connectMux below). apigen is GONE — there is no
			// fallback handler; unroutable paths return 404 directly from
			// the chi router.
			// rating (pilot)
			gated.Get("/rating/me", ratingTranscoder.ServeHTTP)
			gated.Get("/rating/leaderboard", ratingTranscoder.ServeHTTP)
			// auth (3 public + 1 authed — the gate handles the split by path)
			gated.Post("/auth/yandex", authTranscoder.ServeHTTP)
			gated.Post("/auth/telegram", authTranscoder.ServeHTTP)
			gated.Post("/auth/refresh", authTranscoder.ServeHTTP)
			gated.Delete("/auth/logout", authTranscoder.ServeHTTP)
			// profile
			gated.Get("/profile/me", profileTranscoder.ServeHTTP)
			gated.Get("/profile/me/atlas", profileTranscoder.ServeHTTP)
			gated.Get("/profile/me/report", profileTranscoder.ServeHTTP)
			gated.Put("/profile/me/settings", profileTranscoder.ServeHTTP)
			gated.Get("/profile/{username}", profileTranscoder.ServeHTTP)
			// daily
			gated.Get("/daily/kata", dailyTranscoder.ServeHTTP)
			gated.Post("/daily/kata/submit", dailyTranscoder.ServeHTTP)
			gated.Get("/daily/streak", dailyTranscoder.ServeHTTP)
			gated.Get("/daily/calendar", dailyTranscoder.ServeHTTP)
			gated.Post("/daily/calendar", dailyTranscoder.ServeHTTP)
			gated.Post("/daily/autopsy", dailyTranscoder.ServeHTTP)
			gated.Get("/daily/autopsy/{autopsyId}", dailyTranscoder.ServeHTTP)
			// notify (preferences — the telegram webhook above is a raw chi
			// handler and stays outside Connect).
			gated.Get("/notify/preferences", notifyTranscoder.ServeHTTP)
			gated.Put("/notify/preferences", notifyTranscoder.ServeHTTP)
			// guild
			gated.Get("/guild/my", guildTranscoder.ServeHTTP)
			gated.Get("/guild/{guildId}", guildTranscoder.ServeHTTP)
			gated.Get("/guild/{guildId}/war", guildTranscoder.ServeHTTP)
			gated.Post("/guild/{guildId}/war/contribute", guildTranscoder.ServeHTTP)
			// arena (Phase B)
			gated.Post("/arena/match/find", arenaTranscoder.ServeHTTP)
			gated.Delete("/arena/match/cancel", arenaTranscoder.ServeHTTP)
			gated.Get("/arena/match/{matchId}", arenaTranscoder.ServeHTTP)
			gated.Post("/arena/match/{matchId}/confirm", arenaTranscoder.ServeHTTP)
			gated.Post("/arena/match/{matchId}/submit", arenaTranscoder.ServeHTTP)
			// ai_mock (Phase B)
			gated.Post("/mock/session", mockTranscoder.ServeHTTP)
			gated.Get("/mock/session/{sessionId}", mockTranscoder.ServeHTTP)
			gated.Post("/mock/session/{sessionId}/message", mockTranscoder.ServeHTTP)
			gated.Post("/mock/session/{sessionId}/stress", mockTranscoder.ServeHTTP)
			gated.Post("/mock/session/{sessionId}/finish", mockTranscoder.ServeHTTP)
			gated.Get("/mock/session/{sessionId}/report", mockTranscoder.ServeHTTP)
			// ai_native (Phase B) — SubmitPrompt REST path returns 415 because
			// vanguard cannot transcode server-streaming RPCs. Kept registered
			// for a clearer error than 404.
			gated.Post("/native/session", nativeTranscoder.ServeHTTP)
			gated.Post("/native/session/{sessionId}/prompt", nativeTranscoder.ServeHTTP)
			gated.Post("/native/session/{sessionId}/verify", nativeTranscoder.ServeHTTP)
			gated.Get("/native/session/{sessionId}/provenance", nativeTranscoder.ServeHTTP)
			gated.Get("/native/session/{sessionId}/score", nativeTranscoder.ServeHTTP)
			// slot (Phase C) — CreateSlot also enforces role=interviewer
			// inside the server; the gated middleware only ensures bearer.
			gated.Get("/slot", slotTranscoder.ServeHTTP)
			gated.Post("/slot", slotTranscoder.ServeHTTP)
			gated.Post("/slot/{slotId}/book", slotTranscoder.ServeHTTP)
			gated.Delete("/slot/{slotId}/cancel", slotTranscoder.ServeHTTP)
			// editor (Phase C) — five REST endpoints. The WS at
			// /ws/editor/{roomId} is a separate raw chi handler (see below).
			gated.Post("/editor/room", editorTranscoder.ServeHTTP)
			gated.Get("/editor/room/{roomId}", editorTranscoder.ServeHTTP)
			gated.Post("/editor/room/{roomId}/invite", editorTranscoder.ServeHTTP)
			gated.Post("/editor/room/{roomId}/freeze", editorTranscoder.ServeHTTP)
			gated.Get("/editor/room/{roomId}/replay", editorTranscoder.ServeHTTP)
			// season (Phase C)
			gated.Get("/season/current", seasonTranscoder.ServeHTTP)
			// podcast (Phase C)
			gated.Get("/podcast", podcastTranscoder.ServeHTTP)
			gated.Put("/podcast/{podcastId}/progress", podcastTranscoder.ServeHTTP)
			// admin (Phase C) — solution_hint legitimately crosses the
			// boundary here. The role=admin gate lives INSIDE the server
			// (AdminServer.requireAdmin); the gated middleware here only
			// enforces bearer auth.
			gated.Get("/admin/tasks", adminTranscoder.ServeHTTP)
			gated.Post("/admin/tasks", adminTranscoder.ServeHTTP)
			gated.Put("/admin/tasks/{taskId}", adminTranscoder.ServeHTTP)
			gated.Get("/admin/companies", adminTranscoder.ServeHTTP)
			gated.Post("/admin/companies", adminTranscoder.ServeHTTP)
			gated.Get("/admin/config", adminTranscoder.ServeHTTP)
			gated.Put("/admin/config/{key}", adminTranscoder.ServeHTTP)
			gated.Get("/admin/anticheat", adminTranscoder.ServeHTTP)
		})
	})

	// Native Connect paths live at the root (no /api/v1 prefix):
	// /druz9.v1.RatingService/GetMyRatings etc.  chi's routing engine normalises
	// the URL before dispatch which confuses Connect's path-match (dots in the
	// service name don't play well with chi patterns). Wrap the chi router in a
	// plain mux so Connect requests are intercepted BEFORE chi touches them.
	//
	// Auth is mounted WITHOUT requireAuth — the three login RPCs issue tokens
	// (so bearer auth would create a chicken-and-egg); Logout tolerates a
	// missing user (it just no-ops if the refresh cookie isn't present).
	// Public profile lookup is handled by GetPublicProfile itself — it doesn't
	// require a user_id, so wrapping the whole transcoder in requireAuth would
	// break it. We therefore split the profile mount: everything except
	// GetPublicProfile sits inside requireAuth via the per-RPC check in the
	// handler body (UserIDFromContext returns unauthenticated).  For simplicity
	// we keep the transcoder OUTSIDE requireAuth too, and rely on the handler's
	// own auth check — bearer is still enforced on the REST path by the chi
	// gate above, which is the path frontend clients actually use today.
	connectMux := http.NewServeMux()
	connectMux.Handle(ratingConnectPath, requireAuth(ratingTranscoder))
	connectMux.Handle(authConnectPath, authTranscoder)
	connectMux.Handle(profileConnectPath, requireAuth(profileTranscoder))
	connectMux.Handle(dailyConnectPath, requireAuth(dailyTranscoder))
	connectMux.Handle(notifyConnectPath, requireAuth(notifyTranscoder))
	connectMux.Handle(guildConnectPath, requireAuth(guildTranscoder))
	connectMux.Handle(arenaConnectPath, requireAuth(arenaTranscoder))
	connectMux.Handle(mockConnectPath, requireAuth(mockTranscoder))
	connectMux.Handle(nativeConnectPath, requireAuth(nativeTranscoder))
	// Phase C additions — admin wraps in requireAuth too, role gate is
	// inside the server (ports.AdminServer.requireAdmin).
	connectMux.Handle(slotConnectPath, requireAuth(slotTranscoder))
	connectMux.Handle(editorConnectPath, requireAuth(editorTranscoder))
	connectMux.Handle(seasonConnectPath, requireAuth(seasonTranscoder))
	connectMux.Handle(podcastConnectPath, requireAuth(podcastTranscoder))
	connectMux.Handle(adminConnectPath, requireAuth(adminTranscoder))

	rootHandler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch {
		case strings.HasPrefix(req.URL.Path, ratingConnectPath),
			strings.HasPrefix(req.URL.Path, authConnectPath),
			strings.HasPrefix(req.URL.Path, profileConnectPath),
			strings.HasPrefix(req.URL.Path, dailyConnectPath),
			strings.HasPrefix(req.URL.Path, notifyConnectPath),
			strings.HasPrefix(req.URL.Path, guildConnectPath),
			strings.HasPrefix(req.URL.Path, arenaConnectPath),
			strings.HasPrefix(req.URL.Path, mockConnectPath),
			strings.HasPrefix(req.URL.Path, nativeConnectPath),
			strings.HasPrefix(req.URL.Path, slotConnectPath),
			strings.HasPrefix(req.URL.Path, editorConnectPath),
			strings.HasPrefix(req.URL.Path, seasonConnectPath),
			strings.HasPrefix(req.URL.Path, podcastConnectPath),
			strings.HasPrefix(req.URL.Path, adminConnectPath):
			connectMux.ServeHTTP(w, req)
			return
		}
		r.ServeHTTP(w, req)
	})

	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           rootHandler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Background goroutines
	go notifyWorker.Run(rootCtx)
	go notifySched.Run(rootCtx)

	// Register Telegram webhook with BotFather once HTTP is up (skip in local).
	if cfg.Env != "local" {
		go func() {
			time.Sleep(2 * time.Second) // let the listener come online
			if err := notifyTG.RegisterWebhook(rootCtx); err != nil {
				log.Warn("notify.telegram.RegisterWebhook failed", "err", err)
			}
		}()
	}

	go func() {
		log.Info("monolith starting", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server failed", "err", err)
			os.Exit(1)
		}
	}()

	<-rootCtx.Done()
	log.Info("shutdown initiated")

	shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	stopArena()
	editorHub.CloseAll()
	reportWorker.Close()
	reportWorker.Wait()
	if err := notifyTG.Close(shCtx); err != nil {
		log.Warn("notify.telegram.Close", "err", err)
	}

	if err := httpSrv.Shutdown(shCtx); err != nil {
		log.Error("shutdown failed", "err", err)
	}
}

// ── Adapters ────────────────────────────────────────────────────────────────

// tokenVerifierAdapter bridges authApp.TokenIssuer to the arena WS hub's
// TokenVerifier interface — keeps arena from importing the auth package.
type tokenVerifierAdapter struct{ issuer *authApp.TokenIssuer }

func (a tokenVerifierAdapter) VerifyAccess(raw string) (uuid.UUID, error) {
	claims, err := a.issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	return uid, nil
}

// mockTokenVerifierAdapter bridges to ai_mock's domain.TokenVerifier
// (which uses the method name `Verify`, not `VerifyAccess`).
type mockTokenVerifierAdapter struct{ issuer *authApp.TokenIssuer }

func (a mockTokenVerifierAdapter) Verify(raw string) (uuid.UUID, error) {
	claims, err := a.issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	return uid, nil
}

// editorTokenVerifierAdapter bridges to editor's domain.TokenVerifier
// (Verify(raw) — same shape as ai_mock).
type editorTokenVerifierAdapter struct{ issuer *authApp.TokenIssuer }

func (a editorTokenVerifierAdapter) Verify(raw string) (uuid.UUID, error) {
	claims, err := a.issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	return uid, nil
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok","checks":{}}`))
}

// readyHandler pings Postgres + Redis and reports per-check status.
func readyHandler(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		checks := map[string]map[string]any{}
		status := "ok"
		t0 := time.Now()
		if err := pool.Ping(ctx); err != nil {
			status = "unavailable"
			checks["postgres"] = map[string]any{"status": "fail", "error": err.Error()}
		} else {
			checks["postgres"] = map[string]any{"status": "ok", "latency_ms": time.Since(t0).Milliseconds()}
		}
		t0 = time.Now()
		if err := rdb.Ping(ctx).Err(); err != nil {
			status = "unavailable"
			checks["redis"] = map[string]any{"status": "fail", "error": err.Error()}
		} else {
			checks["redis"] = map[string]any{"status": "ok", "latency_ms": time.Since(t0).Milliseconds()}
		}
		w.Header().Set("Content-Type", "application/json")
		if status != "ok" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "checks": checks})
	}
}
