package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListConfig implements GET /api/v1/admin/config.
type ListConfig struct {
	Config domain.ConfigRepo
}

// Do returns every dynamic config entry.
func (uc *ListConfig) Do(ctx context.Context) ([]domain.ConfigEntry, error) {
	out, err := uc.Config.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.ListConfig: %w", err)
	}
	return out, nil
}
