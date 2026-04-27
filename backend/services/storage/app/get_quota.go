// Package app — storage use-cases. Каждый use-case — структура с
// зависимостями (только domain.StorageRepo) + Run(ctx, in) (out, err).
// HTTP/Connect-обёртки живут вне модуля (в cmd/monolith/services/storage).
package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
)

// GetQuota implements GET /api/v1/storage/quota — отдаёт {used, quota, tier}
// текущему юзеру для отрисовки Settings-страницы usage-bar'а.
type GetQuota struct {
	Repo domain.StorageRepo
}

// Run — single read через repo, без бизнес-логики. Wrapcheck здесь только
// чтобы tag'нуть слой ("storage.GetQuota: ..."), domain.ErrNotFound остаётся
// прозрачным через %w.
func (uc *GetQuota) Run(ctx context.Context, userID uuid.UUID) (domain.Quota, error) {
	q, err := uc.Repo.GetQuota(ctx, userID)
	if err != nil {
		return domain.Quota{}, fmt.Errorf("storage.GetQuota: %w", err)
	}
	return q, nil
}
