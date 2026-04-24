package app

import (
	"context"
	"log/slog"

	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// Subscribers группирует обработчики event'ов соседних доменов, по которым
// нужно дёрнуть пересчёт.
//
// Никакого нового publish — слушаем только то, что arena/daily/profile
// уже публикуют сами.
type Subscribers struct {
	Eval *Evaluator
	Log  *slog.Logger
}

// OnMatchCompleted — пересчёт по выигравшим (тут стрик/побед прирастёт)
// и по проигравшим (на случай ачивки за серию поражений / pheonix-секрет).
func (s *Subscribers) OnMatchCompleted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchCompleted)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.WinnerID)
	for _, l := range e.LoserIDs {
		s.recalc(ctx, l)
	}
	return nil
}

// OnDailyKataCompleted — стрик/total прирастёт.
func (s *Subscribers) OnDailyKataCompleted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.UserID)
	return nil
}

// OnDailyKataMissed — стрик мог сброситься, ачивки могли «откатиться»
// концептуально (но мы только up-only, как защита). Пересчёт всё равно
// стоит сделать на случай secret-ачивок про серии.
func (s *Subscribers) OnDailyKataMissed(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataMissed)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.UserID)
	return nil
}

// OnXPGained — суммарный XP прирос → возможные level/xp ачивки.
func (s *Subscribers) OnXPGained(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.XPGained)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.UserID)
	return nil
}

// OnRatingChanged — ELO мог пересечь promotion-порог.
func (s *Subscribers) OnRatingChanged(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.RatingChanged)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.UserID)
	return nil
}

// OnLevelUp — уровень мог достичь level-* milestone.
func (s *Subscribers) OnLevelUp(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.LevelUp)
	if !ok {
		return nil
	}
	s.recalc(ctx, e.UserID)
	return nil
}

// OnCohortWarFinished — обновляем по обоим cohort'ам — попробуем найти
// member'ов через State (он умеет в cohort_wars_won), а здесь просто
// триггерим пересчёт по winner.
func (s *Subscribers) OnCohortWarFinished(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.CohortWarFinished)
	if !ok || e.WinnerID == nil {
		return nil
	}
	// Без cohort-membership-репо тут мы можем только публиковать факт.
	// Реальный пересчёт случится при следующем XP/match событии.
	// (Защита от over-fetch: не дёргаем БД на ВСЕ membership.)
	return nil
}

func (s *Subscribers) recalc(ctx context.Context, uid uuid.UUID) {
	if uid == uuid.Nil || s.Eval == nil {
		return
	}
	if _, err := s.Eval.EvaluateUserProgress(ctx, uid); err != nil && s.Log != nil {
		s.Log.WarnContext(ctx, "achievements.subscribers: evaluate failed",
			slog.Any("err", err), slog.Any("user_id", uid))
	}
}
