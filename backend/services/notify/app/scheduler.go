package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"
)

// WeeklyReportScheduler fires WeeklyReportDue events for each user with the
// opt-in enabled, every Sunday at cfg.Hour local time. Implemented as a ticker
// checking the target moment — simpler than pulling in a cron lib for a single
// scheduled job.
type WeeklyReportScheduler struct {
	Prefs    domain.PreferencesRepo
	Bus      sharedDomain.Bus
	Log      *slog.Logger
	Location *time.Location // target TZ (defaults to UTC)
	Hour     int            // 0-23; default 20
	Weekday  time.Weekday   // default time.Sunday
}

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

	var lastFired time.Time
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
