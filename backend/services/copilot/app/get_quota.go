package app

import (
	"context"
	"fmt"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// GetQuota implements GET /api/v1/copilot/quota.
//
// Returns the caller's current bucket. Rotates the window lazily — if the
// reset time has passed, the counter is zeroed in the DB before we return.
// This lets the client treat GetQuota as authoritative without racing
// the Analyze path's reset logic.
type GetQuota struct {
	Quotas domain.QuotaRepo
	Now    func() time.Time
}

// GetQuotaInput validates caller intent.
type GetQuotaInput struct {
	UserID uuid.UUID
}

// Do executes the use case.
func (uc *GetQuota) Do(ctx context.Context, in GetQuotaInput) (domain.Quota, error) {
	q, err := uc.Quotas.GetOrInit(ctx, in.UserID)
	if err != nil {
		return domain.Quota{}, fmt.Errorf("copilot.GetQuota: %w", err)
	}
	now := uc.now()
	if rotated, changed := q.RotateIfDue(now); changed {
		if err := uc.Quotas.ResetWindow(ctx, in.UserID); err != nil {
			return domain.Quota{}, fmt.Errorf("copilot.GetQuota: reset: %w", err)
		}
		q = rotated
	}
	return q, nil
}

func (uc *GetQuota) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}
