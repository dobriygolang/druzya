// Package app — sync use-cases. Each struct holds its dependencies as
// public fields and exposes a `Run(ctx, in)` method. Handlers in
// cmd/monolith/services/sync compose them.
package app

import (
	"context"
	"fmt"

	"druz9/sync/domain"

	"github.com/google/uuid"
)

// ─── Register ─────────────────────────────────────────────────────────────

// RegisterDevice — POST /api/v1/sync/devices.
type RegisterDevice struct {
	Devices domain.DeviceRepo
}

// RegisterInput — request body + auth subject.
type RegisterInput struct {
	UserID     uuid.UUID
	Name       string
	Platform   string
	AppVersion string
}

// Run inserts the device. Returns ErrDeviceLimit verbatim so handler can
// translate to HTTP 409.
func (uc *RegisterDevice) Run(ctx context.Context, in RegisterInput) (domain.Device, error) {
	out, err := uc.Devices.Register(ctx, domain.DeviceRegistration{
		UserID:     in.UserID,
		Name:       in.Name,
		Platform:   in.Platform,
		AppVersion: in.AppVersion,
	})
	if err != nil {
		return domain.Device{}, fmt.Errorf("sync.RegisterDevice: %w", err)
	}
	return out, nil
}

// ─── List ─────────────────────────────────────────────────────────────────

// ListDevices — GET /api/v1/sync/devices.
type ListDevices struct {
	Devices domain.DeviceRepo
}

// Run returns active devices for the user.
func (uc *ListDevices) Run(ctx context.Context, userID uuid.UUID) ([]domain.Device, error) {
	out, err := uc.Devices.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("sync.ListDevices: %w", err)
	}
	return out, nil
}

// ─── Revoke ───────────────────────────────────────────────────────────────

// RevokeDevice — POST /api/v1/sync/devices/{id}/revoke.
type RevokeDevice struct {
	Devices domain.DeviceRepo
}

// Run marks the device revoked. Returns ErrNotFound when the row is missing
// or already revoked.
func (uc *RevokeDevice) Run(ctx context.Context, userID, deviceID uuid.UUID) error {
	if err := uc.Devices.Revoke(ctx, userID, deviceID); err != nil {
		return fmt.Errorf("sync.RevokeDevice: %w", err)
	}
	return nil
}

// ─── Heartbeat / revocation check ─────────────────────────────────────────

// CheckRevoked — used by the heartbeat middleware on every authenticated
// request. Wraps the repo to keep handler import surface tidy.
type CheckRevoked struct {
	Devices domain.DeviceRepo
}

// Run forwards to the repo. The middleware fail-opens on unknown errors.
func (uc *CheckRevoked) Run(ctx context.Context, userID, deviceID uuid.UUID) error {
	if err := uc.Devices.CheckRevoked(ctx, userID, deviceID); err != nil {
		return fmt.Errorf("sync.CheckRevoked: %w", err)
	}
	return nil
}

// Heartbeat — fire-and-forget last_seen_at touch.
type Heartbeat struct {
	Devices domain.DeviceRepo
}

// Run touches the device row. Caller throttles.
func (uc *Heartbeat) Run(ctx context.Context, deviceID uuid.UUID) error {
	if err := uc.Devices.Touch(ctx, deviceID); err != nil {
		return fmt.Errorf("sync.Heartbeat: %w", err)
	}
	return nil
}
