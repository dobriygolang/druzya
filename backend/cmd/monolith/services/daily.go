package services

import (
	"strings"

	dailyApp "druz9/daily/app"
	dailyDomain "druz9/daily/domain"
	dailyInfra "druz9/daily/infra"
	dailyPorts "druz9/daily/ports"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewDaily wires the daily-kata bounded context. The fake judge0 + analyser
// are intentional placeholders kept identical to the pre-refactor code so
// behaviour does not drift.
func NewDaily(d Deps) *Module {
	tasksKatas := dailyInfra.NewTasksKatas(d.Pool)
	// Phase 2: wrap StreakRepo in a 60s read-through cache. SubmitKata
	// calls Update on success which invalidates the cached entry, so the
	// streak number on the daily page is sub-second fresh post-submit.
	kv := dailyInfra.NewRedisKV(d.Redis)
	streaks := dailyInfra.NewCachedStreakRepo(
		dailyInfra.NewStreaks(d.Pool),
		kv,
		dailyInfra.DefaultStreakTTL,
		d.Log,
	)
	// Phase 2 closing: wrap KataRepo (HistoryLast30) in a read-through cache.
	// tasksKatas exposes TaskRepo + SkillRepo + KataRepo from the same struct;
	// the cache only intercepts the KataRepo surface — Skills and Tasks still
	// go straight to PG.
	katas := dailyInfra.NewCachedKataRepo(tasksKatas, kv, dailyInfra.DefaultKataMinTTL, d.Log, d.Now)
	// Real-sandbox wiring: when JUDGE0_URL is configured (default points at
	// the docker-compose `judge0-server` service) we construct the HTTP
	// client + sandbox executor that loads test_cases per task and runs the
	// user's code per case. When the URL is empty we fall back to the
	// no-sandbox adapter which 503s on every Submit — anti-fallback policy
	// forbids any silent fake-pass even on misconfiguration.
	var judge dailyDomain.Judge0Client
	if u := strings.TrimSpace(d.Cfg.Judge0.URL); u != "" {
		hc := dailyInfra.NewJudge0HTTPClient(u, d.Log)
		judge = dailyInfra.NewJudge0SandboxExecutor(hc, tasksKatas, d.Log)
		d.Log.Info("daily: Judge0 sandbox wired", "url", u)
	} else {
		d.Log.Warn("daily: JUDGE0_URL not set — /daily/run and /daily/kata/submit will return 503 (sandbox unavailable)")
		judge = dailyInfra.NewNoSandboxJudge0()
	}

	h := dailyPorts.NewHandler(dailyPorts.Handler{
		GetKata:       &dailyApp.GetKata{Skills: tasksKatas, Tasks: tasksKatas, Katas: katas, Now: d.Now},
		GetKataBySlug: &dailyApp.GetKataBySlug{Tasks: tasksKatas},
		SubmitKata:    &dailyApp.SubmitKata{Tasks: tasksKatas, Katas: katas, Streaks: streaks, Judge: judge, Bus: d.Bus, Log: d.Log, Now: d.Now},
		GetStreak:     &dailyApp.GetStreak{Streaks: streaks, Katas: katas, Now: d.Now},
		Log:           d.Log,
	})
	server := dailyPorts.NewDailyServer(h)
	onKataCompleted := &dailyApp.OnDailyKataCompleted{Bus: d.Bus, Log: d.Log}

	// Year-grid endpoint for /daily/streak — chi-mounted REST handler
	// (no Connect contract, see ports/streak_calendar_handler.go for
	// the rationale). Reuses the cached StreakRepo + cached KataRepo,
	// so SubmitKata invalidations cascade automatically.
	streakCalendarUC := &dailyApp.GetStreakCalendar{Streaks: streaks, Katas: katas, Now: d.Now}
	streakCalendarHandler := dailyPorts.NewStreakCalendarHandler(streakCalendarUC, d.Log)

	// Solo-practice catalogue: GET /daily/tasks?section=&difficulty=
	// returns the active task list so /practice on the SPA can let users
	// browse + pick any kata instead of getting a single random one.
	listTasksHandler := dailyPorts.NewListTasksHandler(tasksKatas, d.Log)

	// /daily/run — dry-grade endpoint reused by the editor's "Run" button.
	// Lives outside the Connect contract because the wire shape is UI-tailored
	// (passed/total/output/time_ms) and adding a proto would force a regen for
	// a single endpoint. See ports/run_handler.go for the rationale.
	runHandler := dailyPorts.NewRunHandler(judge, d.Log, d.Now)

	connectPath, connectHandler := druz9v1connect.NewDailyServiceHandler(server)
	transcoder := mustTranscode("daily", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/daily/kata", transcoder.ServeHTTP)
			// /daily/kata/{slug} — deep-link by slug. Routed to the same
			// transcoder which dispatches to GetKataBySlug. Auth-required like
			// /daily/kata. POST /daily/kata/submit lives below and is matched
			// independently because chi disambiguates by HTTP method.
			r.Get("/daily/kata/{slug}", transcoder.ServeHTTP)
			r.Post("/daily/kata/submit", transcoder.ServeHTTP)
			// /daily/run — bespoke chi handler used by the editor's "Run" button
			// (no persistence, no streak side-effect). The "Submit" button keeps
			// using the proto-declared /daily/kata/submit path above.
			r.Post("/daily/run", runHandler.ServeHTTP)
			r.Get("/daily/streak", transcoder.ServeHTTP)
			r.Get("/daily/tasks", listTasksHandler.ServeHTTP)
			// Year-grid for KataStreakPage. See streak_calendar_handler.go.
			r.Get("/kata/streak", streakCalendarHandler.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), onKataCompleted.Handle)
			},
		},
	}
}
