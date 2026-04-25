// Package app: queue.go — use cases для Focus Queue (per-day actionable list).
//
// Queue расширяет Plan: AI-сгенерированный план материализуется в queue_items
// (source='ai') через SyncAIItems, плюс юзер докидывает ручные таски через
// AddUserItem. Today страница рендерит этот список с тремя секциями
// (in_progress / todo / done).
//
// Бизнес-правило одного in_progress: только один item per user может быть
// IN_PROGRESS. UpdateStatus в repo инкапсулирует это (TX reset peers + update).
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── ListQueue ─────────────────────────────────────────────────────────────

// ListQueue возвращает items на дату, отсортированные:
// in_progress (top) → todo (by created_at) → done (bottom).
// Сортировка делается в repo.ListByDate (SQL ORDER BY).
type ListQueue struct {
	Queue domain.QueueRepo
	Now   func() time.Time
}

func (uc *ListQueue) Do(ctx context.Context, userID uuid.UUID, date time.Time) ([]domain.QueueItem, error) {
	if date.IsZero() {
		date = uc.Now().UTC().Truncate(24 * time.Hour)
	}
	items, err := uc.Queue.ListByDate(ctx, userID, date)
	if err != nil {
		return nil, fmt.Errorf("hone.ListQueue.Do: %w", err)
	}
	return items, nil
}

// ─── AddUserItem ───────────────────────────────────────────────────────────

// AddUserItem создаёт user-сгенерированный item на сегодня. Title trim'ается;
// пустой → InvalidArgument-style error.
type AddUserItem struct {
	Queue domain.QueueRepo
	Now   func() time.Time
}

type AddUserItemInput struct {
	UserID uuid.UUID
	Title  string
}

func (uc *AddUserItem) Do(ctx context.Context, in AddUserItemInput) (domain.QueueItem, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.QueueItem{}, fmt.Errorf("hone.AddUserItem.Do: %w", domain.ErrInvalidInput)
	}
	if len(title) > 280 {
		// Защита от mega-string через UI bug. 280 — твиттерное соглашение,
		// для action-item более чем достаточно.
		title = title[:280]
	}
	today := uc.Now().UTC().Truncate(24 * time.Hour)
	out, err := uc.Queue.Create(ctx, domain.QueueItem{
		UserID: in.UserID.String(),
		Title:  title,
		Source: domain.QueueItemSourceUser,
		Status: domain.QueueItemStatusTodo,
		Date:   today,
	})
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.AddUserItem.Do: %w", err)
	}
	return out, nil
}

// ─── UpdateItemStatus ──────────────────────────────────────────────────────

// UpdateItemStatus меняет status. Бизнес-правило «один in_progress per user»
// инкапсулировано в repo.UpdateStatus (атомарный TX).
type UpdateItemStatus struct {
	Queue domain.QueueRepo
}

type UpdateItemStatusInput struct {
	UserID uuid.UUID
	ItemID uuid.UUID
	Status domain.QueueItemStatus
}

func (uc *UpdateItemStatus) Do(ctx context.Context, in UpdateItemStatusInput) (domain.QueueItem, error) {
	if !in.Status.IsValid() {
		return domain.QueueItem{}, fmt.Errorf("hone.UpdateItemStatus.Do: invalid status %q: %w", in.Status, domain.ErrInvalidInput)
	}
	out, err := uc.Queue.UpdateStatus(ctx, in.ItemID, in.UserID, in.Status)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.UpdateItemStatus.Do: %w", err)
	}
	return out, nil
}

// ─── DeleteItem ────────────────────────────────────────────────────────────

// DeleteItem — owner-only hard delete. Без soft-delete: items per-day, не
// важны для history (запросы Stats считают завершённость по дням, not by item).
type DeleteItem struct {
	Queue domain.QueueRepo
}

type DeleteItemInput struct {
	UserID uuid.UUID
	ItemID uuid.UUID
}

func (uc *DeleteItem) Do(ctx context.Context, in DeleteItemInput) error {
	if err := uc.Queue.Delete(ctx, in.ItemID, in.UserID); err != nil {
		return fmt.Errorf("hone.DeleteItem.Do: %w", err)
	}
	return nil
}

// ─── SyncAIItems ───────────────────────────────────────────────────────────

// SyncAIItems берёт сегодняшний Plan и материализует AI items в очередь.
// Идемпотентен: повторный вызов не дублирует. Дедуп — по точному match'у
// (user_id, date=today, title) через repo.ExistsByTitleToday.
//
// Вызывается автоматически в конце GeneratePlan use case. Ошибки sync'а
// non-fatal — план уже сохранён, queue best-effort.
type SyncAIItems struct {
	Plans domain.PlanRepo
	Queue domain.QueueRepo
	Log   *slog.Logger
	Now   func() time.Time
}

func (uc *SyncAIItems) Do(ctx context.Context, userID uuid.UUID) error {
	today := uc.Now().UTC().Truncate(24 * time.Hour)
	plan, err := uc.Plans.GetForDate(ctx, userID, today)
	if err != nil {
		// ErrNotFound = нет плана на сегодня → нечего синкать. Не ошибка.
		return nil //nolint:nilerr // план может ещё не быть сгенерирован
	}
	for _, item := range plan.Items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}
		exists, err := uc.Queue.ExistsByTitleToday(ctx, userID, title)
		if err != nil {
			if uc.Log != nil {
				uc.Log.Warn("hone.SyncAIItems.Do: exists check failed",
					slog.Any("err", err),
					slog.String("user_id", userID.String()),
					slog.String("title", title))
			}
			continue
		}
		if exists {
			continue
		}
		_, err = uc.Queue.Create(ctx, domain.QueueItem{
			UserID:   userID.String(),
			Title:    title,
			Source:   domain.QueueItemSourceAI,
			Status:   domain.QueueItemStatusTodo,
			Date:     today,
			SkillKey: item.SkillKey,
		})
		if err != nil && uc.Log != nil {
			uc.Log.Warn("hone.SyncAIItems.Do: create failed",
				slog.Any("err", err),
				slog.String("user_id", userID.String()),
				slog.String("title", title))
		}
	}
	return nil
}

// ─── GetQueueStats ─────────────────────────────────────────────────────────

// GetQueueStats — агрегаты для Stats endpoint'а: today counter + 7d AI/user
// share. Используется как часть GetStats use case'а.
type GetQueueStats struct {
	Queue domain.QueueRepo
}

func (uc *GetQueueStats) Do(ctx context.Context, userID uuid.UUID) (domain.QueueStats, error) {
	total, done, err := uc.Queue.CountTodayByStatus(ctx, userID)
	if err != nil {
		return domain.QueueStats{}, fmt.Errorf("hone.GetQueueStats.Do: count: %w", err)
	}
	ai, user, err := uc.Queue.GetAIShareLast7Days(ctx, userID)
	if err != nil {
		return domain.QueueStats{}, fmt.Errorf("hone.GetQueueStats.Do: 7d share: %w", err)
	}
	return domain.QueueStats{
		TodayTotal: total,
		TodayDone:  done,
		AIShare:    ai,
		UserShare:  user,
	}, nil
}
