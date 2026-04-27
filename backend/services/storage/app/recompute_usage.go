package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"
)

// RecomputeUsage — hourly cron use-case. Пересчитывает
// users.storage_used_bytes для всех юзеров одним SQL'ем. Caller (cron-loop
// в monolith wiring'е) после успешного Run должен сбросить TTL-cache
// quota-gate'а — иначе свежие used_bytes не видны до истечения 30s TTL.
type RecomputeUsage struct {
	Repo domain.StorageRepo
}

// Run выполняет пересчёт. Ошибка — оборачиваем wrapcheck-friendly.
func (uc *RecomputeUsage) Run(ctx context.Context) error {
	if err := uc.Repo.RecomputeAllUsage(ctx); err != nil {
		return fmt.Errorf("storage.RecomputeUsage: %w", err)
	}
	return nil
}
