package infra

import (
	"context"
	"fmt"

	"druz9/subscription/domain"
)

// BoostySourceAdapter — тонкая обёртка превращающая infra.BoostyClient
// (HTTP-детали) в app.BoostySource (domain-facing интерфейс). Разделение
// нужно чтобы app-пакет не импортил infra и оставался легко мокабельным.
type BoostySourceAdapter struct {
	Client *BoostyClient
}

// NewBoostySourceAdapter — может принять nil-клиент (когда токен не выставлен);
// в этом случае ListSubscribers возвращает ErrBoostyUnconfigured, а caller
// (SyncBoosty) пропускает run без ошибок.
func NewBoostySourceAdapter(c *BoostyClient) *BoostySourceAdapter {
	return &BoostySourceAdapter{Client: c}
}

// ListSubscribers — конвертирует []BoostySubscriber → []domain.BoostySubscriberSnapshot.
func (a *BoostySourceAdapter) ListSubscribers(ctx context.Context, limit int) ([]domain.BoostySubscriberSnapshot, error) {
	if a.Client == nil {
		return nil, ErrBoostyUnconfigured
	}
	subs, err := a.Client.ListSubscribers(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("subscription.boosty_source: %w", err)
	}
	out := make([]domain.BoostySubscriberSnapshot, 0, len(subs))
	for _, s := range subs {
		out = append(out, domain.BoostySubscriberSnapshot{
			SubscriberID: s.SubscriberID,
			Username:     s.Username,
			TierName:     s.TierName,
			ExpiresAt:    s.ExpiresAt,
			IsActive:     s.IsActive,
		})
	}
	return out, nil
}

var _ domain.BoostySource = (*BoostySourceAdapter)(nil)
