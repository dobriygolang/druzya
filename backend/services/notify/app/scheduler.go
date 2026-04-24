package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"
)

// SchedulerStateStore persists the last-fired bucket timestamp so API
// restarts inside the target hour don't re-trigger the broadcast. Nil store
// falls back to in-memory semantics (ok for tests, NOT ok for prod — каждый
// рестарт в воскресенье 20:XX начнёт fanout заново всем weekly-subscribers).
type SchedulerStateStore interface {
	GetLastFired(ctx context.Context, key string) (time.Time, error)
	SetLastFired(ctx context.Context, key string, t time.Time, ttl time.Duration) error
}

// WeeklyReportScheduler fires WeeklyReportDue events for each user with the
// opt-in enabled, every Sunday at cfg.Hour local time. Implemented as a ticker
// checking the target moment — simpler than pulling in a cron lib for a single
// scheduled job.
//
// Idempotency: lastFired bucket persisted through Store. Если Store задан и
// вернул bucket >= текущего часа-бакета — считаем что уже стреляли в этом
// окне и пропускаем fire, даже если API только что рестартовал. Без этого
// деплой в окно воскресенья 20:00-20:59 ронял повторный broadcast всем
// пользователям (регрессия 2026-04).
type WeeklyReportScheduler struct {
	Prefs    domain.PreferencesRepo
	Bus      sharedDomain.Bus
	Log      *slog.Logger
	Store    SchedulerStateStore // nil → in-memory (только для тестов)
	Location *time.Location      // target TZ (defaults to UTC)
	Hour     int                 // 0-23; default 20
	Weekday  time.Weekday        // default time.Sunday
}

// weeklyStoreKey — Redis-ключ для persist. Меняется только при breaking
// change формата (миграцию делать через переименование ключа).
const weeklyStoreKey = "notify:scheduler:weekly:last_fired"

// weeklyStoreTTL — 8 дней. Дольше чем один week-interval, чтобы ключ не
// исчез между недельными fire'ами, но достаточно короткий чтобы не
// замусоривать Redis вечно при деактивации feature'а.
const weeklyStoreTTL = 8 * 24 * time.Hour

// Run blocks until ctx is cancelled. Ticker interval is 1 minute — good
// enough granularity for a weekly job.
func (s *WeeklyReportScheduler) Run(ctx context.Context) {
	if s.Location == nil {
		s.Location = time.UTC
	}
	if s.Hour == 0 {
		s.Hour = 20
	}
	if s.Weekday == 0 && time.Now().Weekday() != time.Sunday {
		s.Weekday = time.Sunday
	}

	// На старте загружаем lastFired из persistent-store, иначе при каждом
	// рестарте API в час X попадаем в бранч fire. См. struct-комментарий.
	var lastFired time.Time
	if s.Store != nil {
		if t, err := s.Store.GetLastFired(ctx, weeklyStoreKey); err == nil {
			lastFired = t
			s.Log.Info("notify.scheduler.weekly: restored lastFired from store",
				slog.Time("last_fired", lastFired))
		} else {
			s.Log.Warn("notify.scheduler.weekly: store GetLastFired failed, starting cold",
				slog.Any("err", err))
		}
	}

	tick := time.NewTicker(time.Minute)
	defer tick.Stop()

	s.Log.Info("notify.scheduler.weekly: running",
		slog.String("tz", s.Location.String()),
		slog.Int("hour", s.Hour),
		slog.String("weekday", s.Weekday.String()),
	)
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			now := time.Now().In(s.Location)
			if now.Weekday() != s.Weekday || now.Hour() != s.Hour {
				continue
			}
			// Only fire once per hour — track the last firing bucket.
			bucket := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, s.Location)
			if !lastFired.IsZero() && !bucket.After(lastFired) {
				continue
			}
			lastFired = bucket
			// Persist ПЕРЕД fireOnce — если процесс упадёт во время fan-out'а
			// и не дойдёт до конца, следующий запуск ВСЁ РАВНО не будет
			// повторять (лучше потерять часть уведомлений, чем спамить всех
			// дважды). Частичный fanout сам по себе идемпотентен на уровне
			// отправки: Notifications_log + rate-limit dedup'ит дубли при
			// ретрае в течение ~1 минуты.
			if s.Store != nil {
				if err := s.Store.SetLastFired(ctx, weeklyStoreKey, bucket, weeklyStoreTTL); err != nil {
					s.Log.Warn("notify.scheduler.weekly: store SetLastFired failed",
						slog.Any("err", err))
				}
			}
			s.fireOnce(ctx, bucket)
		}
	}
}

func (s *WeeklyReportScheduler) fireOnce(ctx context.Context, at time.Time) {
	users, err := s.Prefs.ListWeeklyReportEnabled(ctx)
	if err != nil {
		s.Log.ErrorContext(ctx, "notify.scheduler.weekly: list", slog.Any("err", err))
		return
	}
	s.Log.InfoContext(ctx, "notify.scheduler.weekly: firing",
		slog.Int("subscribers", len(users)))
	for _, uid := range users {
		ev := domain.WeeklyReportDue{At: at, UserID: uid}
		if err := s.Bus.Publish(ctx, ev); err != nil {
			s.Log.WarnContext(ctx, "notify.scheduler.weekly: publish",
				slog.String("user_id", uid.String()),
				slog.Any("err", err))
		}
	}
}
