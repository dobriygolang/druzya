package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// DeviceRepo — persistence for the device aggregate. Implementations live
// in infra (Postgres). Tier-gate happens inside Register (TX-bounded).
type DeviceRepo interface {
	// Register inserts a new device row. Returns ErrDeviceLimit when the
	// user is on Free tier and already has an active device.
	Register(ctx context.Context, in DeviceRegistration) (Device, error)

	// List returns active (non-revoked) devices for the user, ordered by
	// last_seen_at DESC.
	List(ctx context.Context, userID uuid.UUID) ([]Device, error)

	// Revoke flips revoked_at = now() for (userID, deviceID). Returns
	// ErrNotFound if the row is missing or already revoked.
	Revoke(ctx context.Context, userID, deviceID uuid.UUID) error

	// CheckRevoked is the heartbeat hot-path: confirms (deviceID, userID)
	// row exists AND revoked_at IS NULL. Returns:
	//   - nil: device active
	//   - ErrNotFound: row missing (foreign / already-deleted)
	//   - ErrDeviceRevoked: revoked_at != NULL
	//   - other error: DB outage; caller fail-opens
	CheckRevoked(ctx context.Context, userID, deviceID uuid.UUID) error

	// Touch fire-and-forget last_seen_at update. Caller throttles per-device
	// to keep write-pressure bounded.
	Touch(ctx context.Context, deviceID uuid.UUID) error
}

// ReplicationRepo — pull/push backbone. Returns raw row maps; handler
// serializes. Tombstone GC is its own background concern.
type ReplicationRepo interface {
	// FetchTable — read changed rows from `table` since `cursor`.
	// Returns delta with maxSeenAt + truncated flag.
	FetchTable(ctx context.Context, userID uuid.UUID, table string, cursor time.Time, limit int) (TableDelta, error)

	// FetchTombstones — read tombstones since `cursor`, excluding the
	// requesting device's own deletions.
	FetchTombstones(ctx context.Context, userID, requestingDevice uuid.UUID, cursor time.Time, limit int) (deleted []Tombstone, maxSeenAt time.Time, err error)

	// ApplyDelete — TX: DELETE FROM table WHERE id+user_id, plus
	// INSERT INTO sync_tombstones with origin_device_id.
	ApplyDelete(ctx context.Context, userID, originDevice uuid.UUID, table string, rowID uuid.UUID) error

	// PruneTombstones — DELETE FROM sync_tombstones WHERE deleted_at <
	// cutoff. Returns rows pruned.
	PruneTombstones(ctx context.Context, cutoff time.Time) (int64, error)
}

// TableCatalog — metadata about which tables sync covers. Kept as a
// repo-side interface so that infra owns the canonical list (and the
// columns / cursor-column mapping). Domain queries it for validation +
// app-layer iteration.
type TableCatalog interface {
	// AllTables returns every table sync replicates (in deterministic
	// order). Used as default for `tables=null` pull bodies.
	AllTables() []string
	// Known reports whether table is part of the catalog (validation).
	Known(table string) bool
}
