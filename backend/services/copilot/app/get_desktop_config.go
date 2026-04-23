package app

import (
	"context"
	"fmt"

	"druz9/copilot/domain"
)

// GetDesktopConfig implements GET /api/v1/copilot/desktop-config.
//
// Supports a rev-based short-circuit: if the caller's KnownRev matches the
// server's current rev, the returned config has Rev set and all other
// fields zeroed, meaning "you are up to date — use your cached copy".
type GetDesktopConfig struct {
	Config domain.ConfigProvider
}

// GetDesktopConfigInput validates caller intent.
type GetDesktopConfigInput struct {
	KnownRev int64
}

// Do executes the use case.
func (uc *GetDesktopConfig) Do(ctx context.Context, in GetDesktopConfigInput) (domain.DesktopConfig, error) {
	cfg, err := uc.Config.Load(ctx)
	if err != nil {
		return domain.DesktopConfig{}, fmt.Errorf("copilot.GetDesktopConfig: %w", err)
	}
	if in.KnownRev > 0 && in.KnownRev == cfg.Rev {
		// Short-circuit — caller is current. Return a Rev-only payload.
		return domain.DesktopConfig{Rev: cfg.Rev}, nil
	}
	return cfg, nil
}
