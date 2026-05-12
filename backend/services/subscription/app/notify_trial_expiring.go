// notify_trial_expiring.go — daily cron UC.
//
// Goal: за 24h до конца trial Pro нотифицировать юзера чтобы он
// либо подключил Stripe (Pro 990₽/мес), либо знал что доступ
// прервётся. Без этого pre-warning юзер просто внезапно обнаруживает
// downgrade — bad UX + bad conversion.
//
// Pipeline:
//  1. Repo.ListExpiringTrials(now, now+24h) → []Subscription (admin grants).
//  2. Для каждого: dedup через TrialNotifiedRepo (24h окно — раз в 24h
//     max одна нотификация на юзера).
//  3. Insight upsert (surface=today, anchor=billing:trial_expiring:<date>).
//  4. Outbound notification (telegram если connected, иначе email).
//
// Idempotency: anchor inclu's трейл-конец date так чтобы повторный run
// в течение того же 24h окна не плодил duplicate'ов; уже dismissed остаётся
// dismissed.
//
// Failure mode: если Insight upsert не получился — log warn, continue к
// notification. Одно failure не блокирует целую партию.

package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// TrialExpiringInsightWriter — narrow port для записи insight'а. Реализуется
// bootstrap'ом через тонкий adapter поверх intelligence.InsightRepo.Upsert.
// Inversion: subscription не импортирует intelligence package напрямую.
type TrialExpiringInsightWriter interface {
	// UpsertTrialExpiring пишет/обновляет insight для userID с указанной
	// expiry. now передаётся для GeneratedAt/ExpiresAt в insight row'е.
	UpsertTrialExpiring(ctx context.Context, in TrialExpiringInsight) error
}

// TrialExpiringInsight — payload для writer port'а.
type TrialExpiringInsight struct {
	UserID    uuid.UUID
	TrialEnd  time.Time
	Now       time.Time
	UpgradeCTA string // URL для CTA — e.g. https://druz9.online/upgrade?source=trial-warning
}

// TrialExpiringNotifier — narrow port для outbound notification.
// nil-safe: cron работает и без notifier'а (только insight).
type TrialExpiringNotifier interface {
	NotifyTrialExpiring(ctx context.Context, userID uuid.UUID, trialEnd time.Time) error
}

// NotifyTrialExpiring — daily cron UC.
type NotifyTrialExpiring struct {
	Repo     domain.Repo
	Insights TrialExpiringInsightWriter
	Notifier TrialExpiringNotifier
	Clock    domain.Clock
	Log      *slog.Logger
	// UpgradeURL — base URL для CTA в insight'е. Без trailing slash;
	// мы добавим query params. Default = https://druz9.online/upgrade.
	UpgradeURL string
}

// NewNotifyTrialExpiring — конструктор.
func NewNotifyTrialExpiring(repo domain.Repo, insights TrialExpiringInsightWriter, notifier TrialExpiringNotifier, clk domain.Clock, log *slog.Logger) *NotifyTrialExpiring {
	if log == nil {
		panic("subscription.NewNotifyTrialExpiring: logger is required")
	}
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &NotifyTrialExpiring{
		Repo:       repo,
		Insights:   insights,
		Notifier:   notifier,
		Clock:      clk,
		Log:        log,
		UpgradeURL: "https://druz9.online/upgrade",
	}
}

// Do — runs one pass. Returns count of users processed + first non-fatal
// error (если any). Cron caller log'ует / metric'ует.
//
// Window: (now, now+24h] — это «trial expiry в ближайшие 24h, но ещё не
// expired». Юзер увидит warning за ~24h до конца.
func (uc *NotifyTrialExpiring) Do(ctx context.Context) (NotifyTrialExpiringResult, error) {
	if uc.Repo == nil {
		return NotifyTrialExpiringResult{}, fmt.Errorf("subscription.NotifyTrialExpiring: repo not configured")
	}
	now := uc.Clock.Now().UTC()
	until := now.Add(24 * time.Hour)

	subs, err := uc.Repo.ListExpiringTrials(ctx, now, until, 1000)
	if err != nil {
		return NotifyTrialExpiringResult{}, fmt.Errorf("subscription.NotifyTrialExpiring: list: %w", err)
	}

	var res NotifyTrialExpiringResult
	res.Total = len(subs)
	for _, s := range subs {
		if s.CurrentPeriodEnd == nil {
			continue
		}
		// Insight write — anchor с датой trial-конца чтобы Upsert не плодил
		// daily duplicates если cron run'ится несколько раз в день.
		if uc.Insights != nil {
			if err := uc.Insights.UpsertTrialExpiring(ctx, TrialExpiringInsight{
				UserID:     s.UserID,
				TrialEnd:   *s.CurrentPeriodEnd,
				Now:        now,
				UpgradeCTA: fmt.Sprintf("%s?source=trial-warning&user=%s", uc.UpgradeURL, s.UserID.String()),
			}); err != nil {
				uc.Log.WarnContext(ctx, "subscription.notify_trial_expiring: insight upsert failed",
					slog.String("user_id", s.UserID.String()),
					slog.Any("err", err))
				res.InsightErrors++
				continue
			}
			res.InsightsWritten++
		}
		// Outbound notification — best-effort. notify service сам дедупит
		// по type+user в DefaultDedupWindow.
		if uc.Notifier != nil {
			if err := uc.Notifier.NotifyTrialExpiring(ctx, s.UserID, *s.CurrentPeriodEnd); err != nil {
				uc.Log.WarnContext(ctx, "subscription.notify_trial_expiring: notify failed",
					slog.String("user_id", s.UserID.String()),
					slog.Any("err", err))
				res.NotifyErrors++
				continue
			}
			res.NotificationsSent++
		}
	}
	uc.Log.InfoContext(ctx, "subscription.notify_trial_expiring.done",
		slog.Int("total", res.Total),
		slog.Int("insights", res.InsightsWritten),
		slog.Int("notifications", res.NotificationsSent),
		slog.Int("insight_errors", res.InsightErrors),
		slog.Int("notify_errors", res.NotifyErrors))
	return res, nil
}

// NotifyTrialExpiringResult — sumary для cron каллера + metrics.
type NotifyTrialExpiringResult struct {
	Total             int
	InsightsWritten   int
	NotificationsSent int
	InsightErrors     int
	NotifyErrors      int
}
