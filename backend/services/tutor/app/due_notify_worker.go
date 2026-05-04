package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/shared/enums"
	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// NotifySender — узкий interface к notify-сервису. Cross-domain shim,
// чтобы tutor app не импортил notify/app напрямую. Wired в monolith.
type NotifySender interface {
	Send(ctx context.Context, userID uuid.UUID, notType enums.NotificationType, payload map[string]any) error
}

// TutorDisplayLookup — name resolver для tutor_id → отображаемое имя в
// notification text'е. nil-safe в worker'е (если nil — text без имени).
type TutorDisplayLookup interface {
	DisplayName(ctx context.Context, tutorID uuid.UUID) string
}

// AssignmentDueSoonWorker — cron, который раз в interval'у дёргает все
// assignments с due_at в (now, now+24h], ещё не нотифицированные, и шлёт
// notification.
//
// Идемпотентность через due_notified_at column: success-path always
// marks. Если notify.Send упал — оставляем NULL и попробуем на след
// тике (notify-сервис сам дедупит по DefaultDedupWindow).
type AssignmentDueSoonWorker struct {
	Repo         domain.AssignmentRepo
	Notify       NotifySender
	TutorDisplay TutorDisplayLookup // optional
	Log          *slog.Logger
	Now          func() time.Time
	Interval     time.Duration
	Window       time.Duration // по умолчанию 24h
	BatchLimit   int           // по умолчанию 100
}

// Run blocks until ctx is done. Каждый tick: Tick().
func (w *AssignmentDueSoonWorker) Run(ctx context.Context) {
	if w.Interval <= 0 {
		w.Interval = 5 * time.Minute
	}
	if w.Window <= 0 {
		w.Window = 24 * time.Hour
	}
	if w.BatchLimit <= 0 {
		w.BatchLimit = 100
	}
	t := time.NewTicker(w.Interval)
	defer t.Stop()
	// Первый tick без задержки чтобы по boot'у сразу отработать backlog.
	w.Tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.Tick(ctx)
		}
	}
}

// Tick exposed для тестов. Возвращает кол-во отправленных нотификаций.
func (w *AssignmentDueSoonWorker) Tick(ctx context.Context) int {
	now := nowOr(w.Now)
	items, err := w.Repo.DueWithinNeedsNotify(ctx, now, w.Window, w.BatchLimit)
	if err != nil {
		if w.Log != nil {
			w.Log.Warn("tutor.AssignmentDueSoonWorker: list failed", slog.String("err", err.Error()))
		}
		return 0
	}
	if len(items) == 0 {
		return 0
	}
	sent := 0
	for _, a := range items {
		if a.DueAt == nil {
			continue
		}
		hours := int(a.DueAt.Sub(now).Hours())
		if hours < 1 {
			hours = 1
		}
		tutorName := ""
		if w.TutorDisplay != nil {
			tutorName = w.TutorDisplay.DisplayName(ctx, a.TutorID)
		}
		if tutorName == "" {
			tutorName = "тутор"
		}
		payload := map[string]any{
			"Title":     a.Title,
			"Hours":     hours,
			"TutorName": tutorName,
		}
		if err := w.Notify.Send(ctx, a.StudentID, enums.NotificationTypeAssignmentDueSoon, payload); err != nil {
			if w.Log != nil {
				w.Log.Warn("tutor.AssignmentDueSoonWorker: notify failed",
					slog.String("err", err.Error()),
					slog.String("assignment_id", a.ID.String()),
				)
			}
			continue
		}
		if mErr := w.Repo.MarkDueNotified(ctx, a.ID, now); mErr != nil {
			if w.Log != nil {
				w.Log.Warn("tutor.AssignmentDueSoonWorker: mark failed",
					slog.String("err", mErr.Error()),
					slog.String("assignment_id", a.ID.String()),
				)
			}
			continue
		}
		sent++
	}
	if sent > 0 && w.Log != nil {
		w.Log.Info("tutor.AssignmentDueSoonWorker: notified",
			slog.Int("count", sent), slog.Int("scanned", len(items)))
	}
	return sent
}

var _ = fmt.Sprintf
