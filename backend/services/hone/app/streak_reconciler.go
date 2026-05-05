package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// StreakReconciler периодически сверяет hone_focus_sessions с
// hone_streak_days и чинит drift. Drift возникает, когда EndFocus сохранил
// сессию, но транзакционный ApplyFocusSession упал (транзиент — БД/Redis
// flap, отмена контекста на shutdown'е и т.п.). В рантайме EndFocus логирует
// ошибку и возвращает успех клиенту — без reconciliation'а такие дни тихо
// теряются из streak'а пользователя.
//
// Подход — idempotent recompute:
//
//  1. Раз в Interval опрашиваем StreakRepo.FindDrift(Lookback) — получаем
//     список (user, day) где aggregate focus_sessions != streak_days.
//  2. Для каждой записи зовём RecomputeDay с absolute values → переписываем
//     streak_days и, если день свеже-qualified, транзакционно продвигаем
//     streak_state.
//
// Семантика — eventual-consistent. Пользователь видит корректный streak не
// мгновенно после драфт-event'а, а в течение одного Interval'а (по дефолту
// 15 минут). Compromise между «мгновенно правильно» (перенос всей логики в
// Do'шку EndFocus — сложнее) и «никогда не чиним» (текущее состояние).
type StreakReconciler struct {
	Streaks           domain.StreakRepo
	Log               *slog.Logger
	Interval          time.Duration // по дефолту 15 мин
	Lookback          time.Duration // по дефолту 48 ч
	QualifyingSeconds int           // по дефолту MinQualifyingFocusSeconds
}

// Run блокируется до ctx.Done. Запускается через Module.Background.
func (r *StreakReconciler) Run(ctx context.Context) {
	interval := r.Interval
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	lookback := r.Lookback
	if lookback <= 0 {
		lookback = 48 * time.Hour
	}
	threshold := r.QualifyingSeconds
	if threshold <= 0 {
		threshold = MinQualifyingFocusSeconds
	}

	// Небольшая стартовая задержка — не грузим БД в первую минуту деплоя,
	// когда ещё idle, не бьёмся за пул с migrations/healthcheck'ами.
	select {
	case <-ctx.Done():
		return
	case <-time.After(30 * time.Second):
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		r.runOnce(ctx, lookback, threshold)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// streakBatchRecomputer — optional capability checked at runtime: если
// repo реализует RecomputeDaysBatch, reconciler шлёт drift батчем (1 RTT
// для N records) вместо последовательных RecomputeDay-вызовов (N RTT).
type streakBatchRecomputer interface {
	RecomputeDaysBatch(ctx context.Context, drift []domainDriftLike, threshold int) (int64, error)
}

// domainDriftLike — locally-typed alias чтобы не тащить domain.DriftRow
// в interface определение и не создать circular-imports тонкой пере-
// объявкой. На репо-стороне batch-метод объявлен через тот же тип.
type domainDriftLike = struct {
	UserID         uuid.UUID
	Day            time.Time
	ActualSeconds  int
	ActualSessions int
}

// runOnce — один проход. Вынесен отдельно чтобы тесты могли дёргать без
// пинания Ticker'а.
//
// R4 perf: если repo реализует streakBatchRecomputer — drift летит
// одним pgx.Batch (1 RTT). Иначе fallback на per-row RecomputeDay loop
// (старое поведение, тесты-fake'и используют именно его).
func (r *StreakReconciler) runOnce(ctx context.Context, lookback time.Duration, threshold int) {
	drift, err := r.Streaks.FindDrift(ctx, lookback)
	if err != nil {
		if r.Log != nil {
			r.Log.WarnContext(ctx, "hone.streak.reconcile: find_drift failed", slog.Any("err", err))
		}
		return
	}
	if len(drift) == 0 {
		return
	}
	if r.Log != nil {
		r.Log.InfoContext(ctx, "hone.streak.reconcile: drift found",
			slog.Int("count", len(drift)))
	}
	if batcher, ok := r.Streaks.(streakBatchRecomputer); ok {
		// Batch path. Convert to local alias slice; only the 4 fields
		// the batch needs (state-transition нужен per-row, обрабаты-
		// вается batch impl'ом отдельно).
		rows := make([]domainDriftLike, 0, len(drift))
		for _, d := range drift {
			rows = append(rows, domainDriftLike{
				UserID:         d.UserID,
				Day:            d.Day,
				ActualSeconds:  d.ActualSeconds,
				ActualSessions: d.ActualSessions,
			})
		}
		n, err := batcher.RecomputeDaysBatch(ctx, rows, threshold)
		if err != nil {
			if r.Log != nil {
				r.Log.WarnContext(ctx, "hone.streak.reconcile: batch recompute failed, falling back to per-row",
					slog.Any("err", err))
			}
			// Fall through to per-row loop.
		} else {
			if r.Log != nil {
				r.Log.InfoContext(ctx, "hone.streak.reconcile: batch upsert done",
					slog.Int64("rows", n))
			}
			return
		}
	}
	for _, d := range drift {
		if err := ctx.Err(); err != nil {
			return
		}
		if _, err := r.Streaks.RecomputeDay(ctx, d.UserID, d.Day, d.ActualSeconds, d.ActualSessions, threshold); err != nil {
			if r.Log != nil {
				r.Log.WarnContext(ctx, "hone.streak.reconcile: recompute failed",
					slog.Any("err", err),
					slog.String("user_id", d.UserID.String()),
					slog.String("day", d.Day.Format("2006-01-02")))
			}
			continue
		}
	}
}
