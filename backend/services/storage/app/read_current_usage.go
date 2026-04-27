package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
)

// ReadCurrentUsage — use-case для quota-gate middleware'а: тот же SELECT,
// что и GetQuota, но семантически выделен отдельно — gate оборачивает
// результат в TTL-cache (см. cmd/monolith/services/storage). Если/когда
// появится cache на стороне домена — менять подпись будет не больно.
type ReadCurrentUsage struct {
	Repo domain.StorageRepo
}

// Run возвращает свежий снапшот квоты юзера.
func (uc *ReadCurrentUsage) Run(ctx context.Context, userID uuid.UUID) (domain.Quota, error) {
	q, err := uc.Repo.GetQuota(ctx, userID)
	if err != nil {
		return domain.Quota{}, fmt.Errorf("storage.ReadCurrentUsage: %w", err)
	}
	return q, nil
}
