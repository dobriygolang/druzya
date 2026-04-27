package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/sync/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Devices — Postgres adapter for domain.DeviceRepo.
type Devices struct {
	pool *pgxpool.Pool
}

// NewDevices wraps a pool.
func NewDevices(pool *pgxpool.Pool) *Devices {
	return &Devices{pool: pool}
}

// Register inserts a new device, enforcing the Free-tier 1-device cap inside
// a serializable TX so two concurrent register calls can't both slip through.
func (d *Devices) Register(ctx context.Context, in domain.DeviceRegistration) (domain.Device, error) {
	tx, err := d.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.Device{}, fmt.Errorf("sync.Devices.Register: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var tier string
	if qErr := tx.QueryRow(ctx,
		`SELECT storage_tier FROM users WHERE id=$1`, in.UserID,
	).Scan(&tier); qErr != nil {
		return domain.Device{}, fmt.Errorf("sync.Devices.Register: tier-lookup: %w", qErr)
	}

	if tier == string(domain.TierFree) {
		var activeCount int
		if qErr := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM devices
			  WHERE user_id=$1 AND revoked_at IS NULL`, in.UserID,
		).Scan(&activeCount); qErr != nil {
			return domain.Device{}, fmt.Errorf("sync.Devices.Register: active-count: %w", qErr)
		}
		if activeCount >= 1 {
			return domain.Device{}, domain.ErrDeviceLimit
		}
	}

	out := domain.Device{UserID: in.UserID, Name: in.Name, Platform: in.Platform, AppVersion: in.AppVersion}
	if err := tx.QueryRow(ctx,
		`INSERT INTO devices (user_id, name, platform, app_version)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, platform, app_version, last_seen_at, created_at`,
		in.UserID, in.Name, in.Platform, in.AppVersion,
	).Scan(&out.ID, &out.Name, &out.Platform, &out.AppVersion, &out.LastSeenAt, &out.CreatedAt); err != nil {
		return domain.Device{}, fmt.Errorf("sync.Devices.Register: insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.Device{}, fmt.Errorf("sync.Devices.Register: commit: %w", err)
	}
	return out, nil
}

// List returns active (non-revoked) devices for the user.
func (d *Devices) List(ctx context.Context, userID uuid.UUID) ([]domain.Device, error) {
	rows, err := d.pool.Query(ctx,
		`SELECT id, name, platform, app_version, last_seen_at, created_at
		   FROM devices
		  WHERE user_id=$1 AND revoked_at IS NULL
		  ORDER BY last_seen_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("sync.Devices.List: query: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Device, 0, 4)
	for rows.Next() {
		dev := domain.Device{UserID: userID}
		if err := rows.Scan(&dev.ID, &dev.Name, &dev.Platform, &dev.AppVersion, &dev.LastSeenAt, &dev.CreatedAt); err != nil {
			return nil, fmt.Errorf("sync.Devices.List: scan: %w", err)
		}
		out = append(out, dev)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sync.Devices.List: rows: %w", err)
	}
	return out, nil
}

// Revoke flips revoked_at = now() for the (user, device) row. Returns
// ErrNotFound if the row was missing or already revoked.
func (d *Devices) Revoke(ctx context.Context, userID, deviceID uuid.UUID) error {
	cmd, err := d.pool.Exec(ctx,
		`UPDATE devices SET revoked_at=now()
		  WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
		deviceID, userID,
	)
	if err != nil {
		return fmt.Errorf("sync.Devices.Revoke: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// CheckRevoked is the heartbeat hot-path — single SELECT, no UPDATE.
// Returns ErrNotFound if the row is missing, ErrDeviceRevoked if revoked,
// or the raw DB error so the caller can fail-open.
func (d *Devices) CheckRevoked(ctx context.Context, userID, deviceID uuid.UUID) error {
	var revokedAt *time.Time
	err := d.pool.QueryRow(ctx,
		`SELECT revoked_at FROM devices WHERE id=$1 AND user_id=$2`,
		deviceID, userID,
	).Scan(&revokedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrNotFound
		}
		return fmt.Errorf("sync.Devices.CheckRevoked: %w", err)
	}
	if revokedAt != nil {
		return domain.ErrDeviceRevoked
	}
	return nil
}

// Touch is the fire-and-forget last_seen_at bump. Caller throttles.
func (d *Devices) Touch(ctx context.Context, deviceID uuid.UUID) error {
	if _, err := d.pool.Exec(ctx,
		`UPDATE devices SET last_seen_at = now() WHERE id=$1 AND revoked_at IS NULL`,
		deviceID,
	); err != nil {
		return fmt.Errorf("sync.Devices.Touch: %w", err)
	}
	return nil
}

var _ domain.DeviceRepo = (*Devices)(nil)
