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
	return nil
}

func (uc *SetTier) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
