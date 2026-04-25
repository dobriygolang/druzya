// Package app — quota use-case.
//
// GetQuota объединяет tier-policy + актуальные usage-counters в одну
// projection для frontend'а: «у тебя 7/10 synced notes, 1/1 shared boards,
// 0/5 AI calls этот месяц». Источник усage-данных — UsageReader,
// dependency-injected adapter через который use-case считает counts из
// notes/whiteboard_rooms/editor_rooms таблиц.
//
// Почему отдельный use-case (не в GetTier'е): tier — pure-domain
// (Subscription.ActiveAt), а usage требует cross-service queries. Держим
// boundaries чистыми, читаем usage через port-interface.

package app

import (
	"context"
	"fmt"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// UsageReader — адаптер которым use-case заглядывает в чужие domain'ы
// (notes / whiteboard_rooms / editor_rooms) для подсчёта текущего
// использования. Реализуется в monolith/services/adapters.go через
// raw pgx queries (cross-domain boundary preserved).
type UsageReader interface {
	// Synced notes count — notes у этого user'а на backend'е (after Phase 5
	// migration: notes которые НЕ ephemeral, т.е. реально cloud-stored).
	CountSyncedNotes(ctx context.Context, userID uuid.UUID) (int, error)
	// Active shared whiteboard rooms (visibility=shared) which user owns.
	CountActiveSharedBoards(ctx context.Context, userID uuid.UUID) (int, error)
	// Active shared editor rooms (visibility=shared) which user owns.
	CountActiveSharedRooms(ctx context.Context, userID uuid.UUID) (int, error)
	// AI invocations этим юзером с начала месяца. Реализация может либо
	// SELECT count из ai_usage_log, либо вернуть 0 (если log не ведётся).
	CountAIThisMonth(ctx context.Context, userID uuid.UUID) (int, error)
}

// GetQuota — composite use-case: tier + usage → policy + usage снапшот.
//
// Policy через PolicyResolver: admin-editable values из dynamic_config с
// hardcoded fallback. Если Resolver=nil (legacy callers / tests) — falls
// back на domain.PolicyDefaults напрямую.
type GetQuota struct {
	Tier     *GetTier
	Usage    UsageReader
	Resolver *PolicyResolver // optional, may be nil
}

// NewGetQuota wires use-case зависимости.
func NewGetQuota(tier *GetTier, usage UsageReader, resolver *PolicyResolver) *GetQuota {
	return &GetQuota{Tier: tier, Usage: usage, Resolver: resolver}
}

// QuotaSnapshot — DTO возвращаемый use-case'ом. Frontend renders badges /
// upgrade-prompts на этом snapshot'е.
type QuotaSnapshot struct {
	Tier   domain.Tier
	Policy domain.QuotaPolicy
	Usage  domain.QuotaUsage
}

// Do сводит tier + usage. Все ошибки — fatal для API (500); каждый шаг
// описывает что упало для лога.
func (uc *GetQuota) Do(ctx context.Context, userID uuid.UUID) (QuotaSnapshot, error) {
	tier, err := uc.Tier.Do(ctx, userID)
	if err != nil {
		return QuotaSnapshot{}, fmt.Errorf("subscription.GetQuota: tier: %w", err)
	}
	var policy domain.QuotaPolicy
	if uc.Resolver != nil {
		policy = uc.Resolver.Get(ctx, tier)
	} else {
		policy = domain.PolicyDefaults(tier)
	}

	notes, err := uc.Usage.CountSyncedNotes(ctx, userID)
	if err != nil {
		return QuotaSnapshot{}, fmt.Errorf("subscription.GetQuota: notes count: %w", err)
	}
	boards, err := uc.Usage.CountActiveSharedBoards(ctx, userID)
	if err != nil {
		return QuotaSnapshot{}, fmt.Errorf("subscription.GetQuota: boards count: %w", err)
	}
	rooms, err := uc.Usage.CountActiveSharedRooms(ctx, userID)
	if err != nil {
		return QuotaSnapshot{}, fmt.Errorf("subscription.GetQuota: rooms count: %w", err)
	}
	ai, err := uc.Usage.CountAIThisMonth(ctx, userID)
	if err != nil {
		return QuotaSnapshot{}, fmt.Errorf("subscription.GetQuota: ai count: %w", err)
	}

	return QuotaSnapshot{
		Tier:   tier,
		Policy: policy,
		Usage: domain.QuotaUsage{
			SyncedNotes:        notes,
			ActiveSharedBoards: boards,
			ActiveSharedRooms:  rooms,
			AIThisMonth:        ai,
		},
	}, nil
}
