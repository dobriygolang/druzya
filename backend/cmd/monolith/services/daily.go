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

	connectPath, connectHandler := druz9v1connect.NewDailyServiceHandler(server)
	transcoder := mustTranscode("daily", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/daily/kata", transcoder.ServeHTTP)
			r.Post("/daily/kata/submit", transcoder.ServeHTTP)
			r.Get("/daily/streak", transcoder.ServeHTTP)
			r.Get("/daily/calendar", transcoder.ServeHTTP)
			r.Post("/daily/calendar", transcoder.ServeHTTP)
			r.Post("/daily/autopsy", transcoder.ServeHTTP)
			r.Get("/daily/autopsy/{autopsyId}", transcoder.ServeHTTP)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) {
				b.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), onKataCompleted.Handle)
			},
		},
	}
}
