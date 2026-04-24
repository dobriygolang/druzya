package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ProviderLink — привязка druz9-user'а к учётной записи у стороннего
// payment-провайдера (Boosty / ЮKassa / Т-Банк). Отделена от Subscription
// намеренно: link существует ДО того как юзер оплатил (юзер ввёл свой
// boosty_username заранее), и ПОСЛЕ отмены подписки (на случай возврата).
type ProviderLink struct {
	UserID       uuid.UUID
	Provider     Provider
	ExternalID   string     // boosty_username / email / ...
	ExternalTier string     // сырое имя tier'а у провайдера на момент last sync
	VerifiedAt   *time.Time // nil пока sync не подтвердил активную подписку
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// LinkRepo — persistence port для provider_links.
type LinkRepo interface {
	Upsert(ctx context.Context, link ProviderLink) error
	Get(ctx context.Context, userID uuid.UUID, provider Provider) (ProviderLink, error)
	// FindUserByExternalID — обратный индекс для sync'а: external_id (напр.
	// boosty_username) → наш user_id. ErrNotFound если нет линка.
	FindUserByExternalID(ctx context.Context, provider Provider, externalID string) (uuid.UUID, error)
	ListByProvider(ctx context.Context, provider Provider, limit, offset int) ([]ProviderLink, error)
}
