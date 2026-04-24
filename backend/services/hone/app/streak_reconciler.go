package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/hone/domain"
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

// runOnce — один проход. Вынесен отдельно чтобы тесты могли дёргать без
// пинания Ticker'а.
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
