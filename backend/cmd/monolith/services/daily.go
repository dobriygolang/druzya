package services

import (
	dailyApp "druz9/daily/app"
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
	// Phase 2 closing: wrap KataRepo (HistoryLast30) and CalendarRepo
	// (GetActive) in read-through caches. tasksKatas exposes TaskRepo +
	// SkillRepo + KataRepo from the same struct; the cache only intercepts
	// the KataRepo surface — Skills and Tasks still go straight to PG.
	katas := dailyInfra.NewCachedKataRepo(tasksKatas, kv, dailyInfra.DefaultKataMinTTL, d.Log, d.Now)
	calendars := dailyInfra.NewCachedCalendarRepo(
		dailyInfra.NewCalendars(d.Pool),
		kv,
		dailyInfra.DefaultCalendarTTL,
		d.Log,
		d.Now,
	)
	autopsies := dailyInfra.NewAutopsies(d.Pool)
	judge := dailyInfra.NewFakeJudge0()
	analyser := &dailyApp.FakeAnalyser{Autopsies: autopsies, Log: d.Log}

	h := dailyPorts.NewHandler(dailyPorts.Handler{
		GetKata:        &dailyApp.GetKata{Skills: tasksKatas, Tasks: tasksKatas, Katas: katas, Now: d.Now},
		SubmitKata:     &dailyApp.SubmitKata{Tasks: tasksKatas, Katas: katas, Streaks: streaks, Judge: judge, Bus: d.Bus, Log: d.Log, Now: d.Now},
		GetStreak:      &dailyApp.GetStreak{Streaks: streaks, Katas: katas, Now: d.Now},
		GetCalendar:    &dailyApp.GetCalendar{Cal: calendars, Now: d.Now},
		UpsertCalendar: &dailyApp.UpsertCalendar{Cal: calendars, Now: d.Now},
		CreateAutopsy:  &dailyApp.CreateAutopsy{Autopsies: autopsies, Bus: d.Bus, Log: d.Log, Analyse: analyser},
		GetAutopsy:     &dailyApp.GetAutopsy{Autopsies: autopsies},
		Log:            d.Log,
	})
	server := dailyPorts.NewDailyServer(h)
	onKataCompleted := &dailyApp.OnDailyKataCompleted{Bus: d.Bus, Log: d.Log}

	// Year-grid endpoint for /daily/streak — chi-mounted REST handler
	// (no Connect contract, see ports/streak_calendar_handler.go for
	// the rationale). Reuses the cached StreakRepo + cached KataRepo,
	// so SubmitKata invalidations cascade automatically.
	streakCalendarUC := &dailyApp.GetStreakCalendar{Streaks: streaks, Katas: katas, Now: d.Now}
	streakCalendarHandler := dailyPorts.NewStreakCalendarHandler(streakCalendarUC, d.Log)

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
			r.Post("/daily/kata/submit", transcoder.ServeHTTP)
			// /daily/run — bespoke chi handler used by the editor's "Run" button
			// (no persistence, no streak side-effect). The "Submit" button keeps
			// using the proto-declared /daily/kata/submit path above.
			r.Post("/daily/run", runHandler.ServeHTTP)
			r.Get("/daily/streak", transcoder.ServeHTTP)
			r.Get("/daily/calendar", transcoder.ServeHTTP)
			r.Post("/daily/calendar", transcoder.ServeHTTP)
			r.Post("/daily/autopsy", transcoder.ServeHTTP)
			r.Get("/daily/autopsy/{autopsyId}", transcoder.ServeHTTP)
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
