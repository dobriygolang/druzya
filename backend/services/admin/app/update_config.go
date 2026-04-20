package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// UpdateConfigInput is the use-case payload.
type UpdateConfigInput struct {
	Key         string
	Value       []byte
	UpdatedBy   *uuid.UUID // caller (admin) for audit trail
	Description string     // optional refresh of the description
}

// UpdateConfig implements PUT /api/v1/admin/config/{key}.
//
// Behaviour:
//   - The entry must already exist — the type discriminator is taken from the
//     stored row so curators cannot accidentally change a bool into a string
//     via the value-only payload shape in openapi (ConfigUpdate has `value`
//     only).
//   - Value is validated against the stored type.
//   - After a successful upsert the new entry is fan-out on Redis Pub/Sub so
//     every subscriber (ai_mock / arena / season …) can refresh its in-memory
//     snapshot sub-100 ms.
//
// STUB: a proper audit log (who changed what, when) is nice-to-have but not
// wired for MVP — we stamp updated_at / updated_by on the row itself and rely
// on backup-based point-in-time recovery for deeper forensic questions.
type UpdateConfig struct {
	Config      domain.ConfigRepo
	Broadcaster domain.ConfigBroadcaster
	Log         *slog.Logger
}

// Do validates, persists, then broadcasts.
func (uc *UpdateConfig) Do(ctx context.Context, in UpdateConfigInput) (domain.ConfigEntry, error) {
	existing, err := uc.Config.Get(ctx, in.Key)
	if err != nil {
		return domain.ConfigEntry{}, fmt.Errorf("admin.UpdateConfig: %w", err)
	}
	if err := domain.ValidateConfigValue(in.Key, in.Value, existing.Type); err != nil {
		return domain.ConfigEntry{}, fmt.Errorf("admin.UpdateConfig: %w", err)
	}
	desc := existing.Description
	if in.Description != "" {
		desc = in.Description
	}
	next := domain.ConfigEntry{
		Key:         in.Key,
		Value:       in.Value,
		Type:        existing.Type,
		Description: desc,
	}
	saved, err := uc.Config.Upsert(ctx, next, in.UpdatedBy)
	if err != nil {
		return domain.ConfigEntry{}, fmt.Errorf("admin.UpdateConfig: %w", err)
	}
	if uc.Broadcaster != nil {
		if perr := uc.Broadcaster.Publish(ctx, saved); perr != nil && uc.Log != nil {
			// Non-fatal: the row is saved; subscribers fall back to poll.
			uc.Log.WarnContext(ctx, "admin.UpdateConfig: broadcast failed",
				slog.String("key", saved.Key), slog.Any("err", perr))
		}
	}
	return saved, nil
}
