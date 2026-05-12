// trial_notify_adapter.go — anti-cycle bridge subscription ↔ notify.
//
// Subscription cron NotifyTrialExpiring дёргает узкий port
// TrialExpiringNotifier (subscription/app); конкретная реализация требует
// notify SendNotification UC, но subscription/app не должен импортировать
// notify-домен (a) чтобы избежать cycle, (b) чтобы тесты subscription/app
// не тянули notify-зависимости. Здесь — в bootstrap-слое — оба пакета
// видимы, поэтому adapter живёт тут.
//
// Flow:
//
//	subscription cron Do() →
//	  TrialExpiringNotifier.NotifyTrialExpiring(userID, trialEnd) →
//	    notify SendNotification.Do(SendInput{Type:trial_expiring, Payload:{Hours, UpgradeURL}})
//	      → render template (telegram primary, email fallback)
//	      → enqueue Redis queue
//	      → worker picks up + dispatches via Sender (TG retry built-in)
//
// nil-safe: при отсутствии notify-Send (notify не wired) adapter всё равно
// конструируется, но NotifyTrialExpiring(no-op return nil) — cron видит
// «notification sent OK», падая обратно к Insight-only mode.
//
// Idempotency: notify SendNotification сам дедупит (user, type) внутри
// DefaultDedupWindow (30m). Cron'ный ticker — 24h, так что 30m окошка
// достаточно. Если user блокирует бота — TG sender вернёт error и worker
// MarkFailed; повторный run завтра попадёт в новое окно — попробуем снова
// (graceful re-tries вместо forever-skip).

package subscription

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	notifyApp "druz9/notify/app"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// trialExpiringNotifyAdapter реализует subApp.TrialExpiringNotifier поверх
// notify SendNotification.
type trialExpiringNotifyAdapter struct {
	send       *notifyApp.SendNotification
	upgradeURL string
	log        *slog.Logger
}

// newTrialExpiringNotifyAdapter создаёт adapter. Возвращает non-nil даже
// при nil send'е чтобы caller'у не было ветвлений; в no-op режиме просто
// log + return nil.
func newTrialExpiringNotifyAdapter(send *notifyApp.SendNotification, upgradeURL string, log *slog.Logger) *trialExpiringNotifyAdapter {
	if upgradeURL == "" {
		upgradeURL = "https://druz9.online/upgrade"
	}
	return &trialExpiringNotifyAdapter{send: send, upgradeURL: upgradeURL, log: log}
}

// NotifyTrialExpiring рендерит payload + дёргает notify pipeline. Errors
// пропагируются обратно в cron (он MarkFails и retry'ит завтра).
func (a *trialExpiringNotifyAdapter) NotifyTrialExpiring(ctx context.Context, userID uuid.UUID, trialEnd time.Time) error {
	if a == nil || a.send == nil {
		// No-op: notify не wired → cron работает только с Insight-частью.
		return nil
	}
	now := time.Now().UTC()
	hours := int(trialEnd.Sub(now).Hours())
	if hours < 1 {
		hours = 1
	}
	// Per-user upgrade URL чтобы Stripe Checkout открылся с правильным session.
	upgrade := fmt.Sprintf("%s?source=trial-warning&user=%s", a.upgradeURL, userID.String())
	payload := map[string]any{
		"Hours":      hours,
		"UpgradeURL": upgrade,
	}
	if err := a.send.Do(ctx, notifyApp.SendInput{
		UserID:  userID,
		Type:    enums.NotificationTypeTrialExpiring,
		Payload: payload,
	}); err != nil {
		if a.log != nil {
			a.log.WarnContext(ctx, "subscription.trial_notify_adapter: notify failed",
				slog.String("user_id", userID.String()),
				slog.Any("err", err))
		}
		return fmt.Errorf("trial_notify_adapter: %w", err)
	}
	return nil
}
