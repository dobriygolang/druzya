package app

import (
	"context"
	"fmt"

	"druz9/season/domain"

	"github.com/google/uuid"
)

// ClaimReward is a domain-level helper for redeeming a tier on a track.
//
// FLAG: NOT wired to an HTTP endpoint today — openapi.yaml does not expose a
// /season/claim route. Keep here so the domain stays self-sufficient; when a
// route is added wire it via ports/server.go.
type ClaimReward struct {
	Seasons domain.SeasonRepo
	Tiers   domain.TierRepo
	Claims  domain.ClaimRepo
}

// NewClaimReward wires the helper.
func NewClaimReward(s domain.SeasonRepo, t domain.TierRepo, c domain.ClaimRepo) *ClaimReward {
	return &ClaimReward{Seasons: s, Tiers: t, Claims: c}
}

// Do is idempotent: calling it twice on an already-claimed (kind, tier) returns
// ErrAlreadyClaimed without mutating state.
//
// Последовательность шагов Get+CanClaim→MarkClaimed содержит TOCTOU:
// два параллельных вызова могут одновременно пройти CanClaim. Мы
// всё равно дёргаем Get+CanClaim, потому что это единственное место,
// где проверяется бизнес-логика (tier доступен / premium-подписка /
// enum TrackKind). Защиту от гонки берёт на себя ClaimRepo.MarkClaimed:
// Postgres-реализация вставляет строку под UNIQUE, и при дубле
// возвращает domain.ErrAlreadyClaimed атомарно — ровно один из
// конкурирующих вызовов завершится успехом.
func (uc *ClaimReward) Do(ctx context.Context, userID, seasonID uuid.UUID, kind domain.TrackKind, tier int) error {
	p, err := uc.Seasons.GetProgress(ctx, userID, seasonID)
	if err != nil {
		return fmt.Errorf("season.ClaimReward: %w", err)
	}
	ladder, err := uc.Tiers.Tracks(ctx, seasonID, kind)
	if err != nil {
		return fmt.Errorf("season.ClaimReward: %w", err)
	}
	state, err := uc.Claims.Get(ctx, userID, seasonID)
	if err != nil {
		return fmt.Errorf("season.ClaimReward: %w", err)
	}
	if err := domain.CanClaim(p, ladder, state, kind, tier); err != nil {
		return fmt.Errorf("season.ClaimReward: %w", err)
	}
	if err := uc.Claims.MarkClaimed(ctx, userID, seasonID, kind, tier); err != nil {
		// MarkClaimed оборачивает ErrAlreadyClaimed через %w — пробрасываем
		// как есть, чтобы вызывающий (когда появится HTTP-route) мог
		// различить гонку через errors.Is(err, domain.ErrAlreadyClaimed).
		return fmt.Errorf("season.ClaimReward: %w", err)
	}
	return nil
}
