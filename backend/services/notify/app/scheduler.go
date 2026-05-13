package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
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
// opt-in enabled, every Sunday at cfg.Hour local time. Implemented as a 1-min
// ticker — simpler than pulling in a cron lib for a single scheduled job.
//
// Idempotency: lastFired bucket persisted through Store. Если Store задан и
// вернул bucket >= текущего часа-бакета — считаем что уже стреляли в этом
// окне и пропускаем fire, даже если API только что рестартовал. Без этого
// деплой в окно воскресенья 20:00-20:59 запускал повторный broadcast всем
// пользователям.
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

// weeklyFanoutChunkSize — сколько event'ов publish'им за один chunk до
// короткой паузы. На 100K subscribers без chunking'а EventBus захлёбы-
// вается + downstream notify-handlers'ы лочат БД. 100 — здоровый
// батч: ~50ms/chunk на типовой dispatch'е.
const weeklyFanoutChunkSize = 100

// weeklyFanoutChunkPause — пауза между chunk'ами. 100ms × 1000 chunks
// (100K users) = 100s scheduler-block, что ок: weekly job не время-
// критичный, окно «воскресенье 20:00-20:59» с щедрым запасом.
const weeklyFanoutChunkPause = 100 * time.Millisecond

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

// chunkedListReader — optional capability на repo: streaming fetch
// chunk'ами, чтобы scheduler не загружал 100K user_ids в RAM сразу.
// Repo PostgresAdapter implements это, mock'и в тестах — нет (fall-back).
type chunkedListReader interface {
	ListWeeklyReportEnabledChunked(ctx context.Context, chunkSize int, visit func(batch []uuid.UUID) error) error
}

func (s *WeeklyReportScheduler) fireOnce(ctx context.Context, at time.Time) {
	// Prefer chunked fetch when available — экономим RAM на 100K-subscriber
	// base'е. Иначе fallback на full-list reader.
	if reader, ok := s.Prefs.(chunkedListReader); ok {
		s.Log.InfoContext(ctx, "notify.scheduler.weekly: firing (chunked)",
			slog.Int("chunk_size", weeklyFanoutChunkSize))
		var totalSent int
		err := reader.ListWeeklyReportEnabledChunked(ctx, weeklyFanoutChunkSize, func(batch []uuid.UUID) error {
			if err := ctx.Err(); err != nil {
				return fmt.Errorf("notify.scheduler.weekly: cancelled: %w", err)
			}
			s.publishBatch(ctx, batch, at)
			totalSent += len(batch)
			// Pause между chunk'ами; последний chunk вернёт меньше
			// chunkSize и ListWeeklyReportEnabledChunked сама exit'нет.
			select {
			case <-ctx.Done():
				return fmt.Errorf("notify.scheduler.weekly: cancelled mid-pause: %w", ctx.Err())
			case <-time.After(weeklyFanoutChunkPause):
			}
			return nil
		})
		if err != nil && !errors.Is(err, context.Canceled) {
			s.Log.ErrorContext(ctx, "notify.scheduler.weekly: chunked list failed",
				slog.Any("err", err),
				slog.Int("delivered", totalSent))
			return
		}
		s.Log.InfoContext(ctx, "notify.scheduler.weekly: chunked fanout done",
			slog.Int("delivered", totalSent))
		return
	}

	users, err := s.Prefs.ListWeeklyReportEnabled(ctx)
	if err != nil {
		s.Log.ErrorContext(ctx, "notify.scheduler.weekly: list", slog.Any("err", err))
		return
	}
	s.Log.InfoContext(ctx, "notify.scheduler.weekly: firing",
		slog.Int("subscribers", len(users)),
		slog.Int("chunk_size", weeklyFanoutChunkSize))

	// Chunked fanout с короткой паузой: 100K sync-fanout блокирует
	// scheduler-goroutine на 30+ секунд и downstream notify-handlers
	// (TG send, notification_log INSERT) контеншат БД-пул.
	for start := 0; start < len(users); start += weeklyFanoutChunkSize {
		if err := ctx.Err(); err != nil {
			s.Log.WarnContext(ctx, "notify.scheduler.weekly: cancelled mid-fanout",
				slog.Int("delivered", start),
				slog.Int("remaining", len(users)-start))
			return
		}
		end := min(start+weeklyFanoutChunkSize, len(users))
		s.publishBatch(ctx, users[start:end], at)
		if end < len(users) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(weeklyFanoutChunkPause):
			}
		}
	}
}

// publishBatch — extracted чтобы chunked + non-chunked paths делили один
// publish loop.
func (s *WeeklyReportScheduler) publishBatch(ctx context.Context, batch []uuid.UUID, at time.Time) {
	for _, uid := range batch {
		ev := domain.WeeklyReportDue{At: at, UserID: uid}
		if err := s.Bus.Publish(ctx, ev); err != nil {
			s.Log.WarnContext(ctx, "notify.scheduler.weekly: publish",
				slog.String("user_id", uid.String()),
				slog.Any("err", err))
		}
	}
}
