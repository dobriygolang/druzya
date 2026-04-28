package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// SetTier — use-case для Admin'а (ручная выдача подписки тестеру / поддержке).
// После M3 тот же use-case будет дёргаться Boosty-sync worker'ом — поэтому
// logика валидации и idempotency-записи общая.
type SetTier struct {
	Repo  domain.Repo
	Clock domain.Clock
	Log   *slog.Logger
	// OnTierChanged — optional hook вызываемый ПОСЛЕ успешного Upsert'а.
	// Используется для side-effect'ов в других bounded context'ах,
	// которые держат tier в производных таблицах. Конкретно: copilot_quotas
	// хранит plan + cap per-user и сейчас не sync'ится с subscriptions.plan
	// автоматически — без этого hook'а юзер апгрейдится но видит старые
	// лимиты пока вручную не дёрнется CopilotQuota.UpdatePlan.
	//
	// Hook fire'ится best-effort: если он вернёт error, мы залогируем но
	// SetTier не пропадает (subscription уже committed). Side-effects
	// retry'ются отдельным cron'ом / следующим SetTier вызовом.
	OnTierChanged func(ctx context.Context, userID uuid.UUID, tier domain.Tier) error
}

// NewSetTier — конструктор. Log обязателен (anti-fallback policy).
func NewSetTier(repo domain.Repo, clk domain.Clock, log *slog.Logger) *SetTier {
	if log == nil {
		panic("subscription.NewSetTier: logger is required (anti-fallback policy)")
	}
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &SetTier{Repo: repo, Clock: clk, Log: log}
}

// SetTierInput — payload команды. ProviderSubID нужен только для boosty/
// yookassa (для idempotency webhook'ов); для admin-выдачи пуст.
type SetTierInput struct {
	UserID           uuid.UUID
	Tier             domain.Tier
	Provider         domain.Provider
	ProviderSubID    string
	CurrentPeriodEnd *time.Time // nil = бессрочно (admin grant)
	Reason           string     // попадает в audit log
}

// Do валидирует input, читает текущее состояние, upsert'ит. GracePeriod
// считается автоматически как current_period_end + 24h (смягчает Boosty-лаг).
func (uc *SetTier) Do(ctx context.Context, in SetTierInput) error {
	if !in.Tier.IsValid() {
		return fmt.Errorf("subscription.SetTier: %w: %q", domain.ErrInvalidTier, in.Tier)
	}
	if !in.Provider.IsValid() {
		return fmt.Errorf("subscription.SetTier: invalid provider %q", in.Provider)
	}
	if in.Provider != domain.ProviderAdmin && in.ProviderSubID == "" {
		return fmt.Errorf("subscription.SetTier: provider_sub_id required for non-admin provider %q", in.Provider)
	}

	now := uc.now()
	sub := domain.Subscription{
		UserID:           in.UserID,
		Tier:             in.Tier,
		Status:           domain.StatusActive,
		Provider:         in.Provider,
		ProviderSubID:    in.ProviderSubID,
		StartedAt:        &now,
		CurrentPeriodEnd: in.CurrentPeriodEnd,
		UpdatedAt:        now,
	}
	// Grace = CPE + 24h. Для бессрочной admin-выдачи grace тоже nil.
	if in.CurrentPeriodEnd != nil {
		grace := in.CurrentPeriodEnd.Add(24 * time.Hour)
		sub.GraceUntil = &grace
	}

	if err := uc.Repo.Upsert(ctx, sub); err != nil {
		return fmt.Errorf("subscription.SetTier: upsert: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.set_tier",
		slog.String("user_id", in.UserID.String()),
		slog.String("tier", string(in.Tier)),
		slog.String("provider", string(in.Provider)),
		slog.String("reason", in.Reason))

	// Fire side-effect hook (e.g. copilot_quotas.UpdatePlan). Best-effort:
	// failure здесь логируется но не прерывает SetTier — subscription уже
	// committed, side-effect ретрайнется в следующий вызов / cron.
	if uc.OnTierChanged != nil {
		if err := uc.OnTierChanged(ctx, in.UserID, in.Tier); err != nil {
			uc.Log.WarnContext(ctx, "subscription.set_tier: on_tier_changed hook failed",
				slog.String("user_id", in.UserID.String()),
				slog.String("tier", string(in.Tier)),
				slog.Any("err", err))
		}
	}
	return nil
}

func (uc *SetTier) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
