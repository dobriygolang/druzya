package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Tier — повторное использование shared/enums.SubscriptionPlan вместо дубля.
// Имя "Tier" в subscription-контексте читается естественнее чем "Plan".
type Tier = enums.SubscriptionPlan

const (
	TierFree     = enums.SubscriptionPlanFree
	TierSeeker   = enums.SubscriptionPlanSeeker
	TierAscended = enums.SubscriptionPlanAscendant
)

// Status — жизненный цикл подписки. cancelled != expired: cancelled означает
// что юзер отменил продление, но до current_period_end доступ есть; expired —
// period_end + grace уже в прошлом.
type Status string

const (
	StatusActive    Status = "active"
	StatusCancelled Status = "cancelled"
	StatusExpired   Status = "expired"
)

// Provider — кто ведёт оплату. Расширяемо; enum-стиль для admin-инстансирования.
type Provider string

const (
	ProviderBoosty   Provider = "boosty"
	ProviderYookassa Provider = "yookassa"
	ProviderTBank    Provider = "tbank"
	ProviderAdmin    Provider = "admin" // ручная выдача без оплаты (тест / поддержка)
)

// IsValid — sanity check перед INSERT'ом.
func (p Provider) IsValid() bool {
	switch p {
	case ProviderBoosty, ProviderYookassa, ProviderTBank, ProviderAdmin:
		return true
	}
	return false
}

// Subscription — доменная проекция одной строки `subscriptions`.
// Поля-указатели обозначают nullable: legacy free-записи имеют почти
// всё в nil, admin-grant без expiry — CurrentPeriodEnd/GraceUntil = nil.
type Subscription struct {
	UserID           uuid.UUID
	Tier             Tier
	Status           Status
	Provider         Provider
	ProviderSubID    string
	StartedAt        *time.Time
	CurrentPeriodEnd *time.Time
	GraceUntil       *time.Time
	UpdatedAt        time.Time
}

// ActiveAt возвращает ЭФФЕКТИВНЫЙ tier в момент at. Логика:
//   - tier=free → всегда TierFree (нет чего деактивировать)
//   - status!=active → TierFree (отозвана)
//   - срок действия (max(CurrentPeriodEnd, GraceUntil)) в прошлом → TierFree
//   - admin-grant без срока (все *time в nil, но Tier и Status выставлены) → Tier
//
// Graceful: не бросает ошибки, возвращает степенённый вниз tier.
func (s Subscription) ActiveAt(at time.Time) Tier {
	if s.Tier == TierFree {
		return TierFree
	}
	if s.Status != StatusActive {
		return TierFree
	}
	effectiveEnd := effectiveExpiry(s.CurrentPeriodEnd, s.GraceUntil)
	if effectiveEnd != nil && at.After(*effectiveEnd) {
		return TierFree
	}
	return s.Tier
}

// effectiveExpiry — берёт наиболее поздний срок из двух. nil означает
// "бессрочно" (admin-grant).
func effectiveExpiry(cpe, grace *time.Time) *time.Time {
	switch {
	case cpe == nil && grace == nil:
		return nil
	case cpe == nil:
		return grace
	case grace == nil:
		return cpe
	case grace.After(*cpe):
		return grace
	}
	return cpe
}
