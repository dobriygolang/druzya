// Package domain — sync bounded context: device identity + cursor-based
// LWW replication. Pure entities + repository interfaces; SQL lives in infra.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ─── Sentinel errors ──────────────────────────────────────────────────────

// ErrNotFound — device row не существует / уже отозван (revocation lookup).
var ErrNotFound = errors.New("sync: not found")

// ErrDeviceLimit — Free-tier юзер пытается зарегистрировать второе
// устройство. Handler маппит в HTTP 409 device_limit_free.
var ErrDeviceLimit = errors.New("sync: device limit reached")

// ErrDeviceRevoked — heartbeat-check нашёл revoked_at != NULL. Маппится
// в HTTP 401 device_revoked.
var ErrDeviceRevoked = errors.New("sync: device revoked")

// ErrUnknownTable — push/pull запросил table вне whitelist'а. Маппится
// в HTTP 400 unknown_table.
var ErrUnknownTable = errors.New("sync: unknown table")

// ErrUnsupportedOp — push операция, которую сервер сознательно не применяет
// (Connect-RPC owns the write path). Не ошибка как таковая — handler
// возвращает её как conflict-reason.
var ErrUnsupportedOp = errors.New("sync: unsupported operation")

// ─── Device entity ────────────────────────────────────────────────────────

// Device — registered client (laptop / phone / desktop). Identity-уровень
// sync; tier-gate enforce'ится в RegisterDevice use-case'е.
type Device struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Name       string
	Platform   string
	AppVersion string
	LastSeenAt time.Time
	CreatedAt  time.Time
	RevokedAt  *time.Time
}

// DeviceRegistration — input для register-flow.
type DeviceRegistration struct {
	UserID     uuid.UUID
	Name       string
	Platform   string
	AppVersion string
}

// ─── Replication ──────────────────────────────────────────────────────────

// PullRequest — input для cursor-based pull.
type PullRequest struct {
	UserID           uuid.UUID
	RequestingDevice uuid.UUID // optional: filter own tombstones
	Cursor           time.Time // zero == initial bootstrap
	FullSnapshot     bool
	Tables           []string
}

// TableDelta — изменения по одной таблице на pull.
type TableDelta struct {
	Table     string
	Rows      []map[string]any
	MaxSeenAt time.Time
	Truncated bool
}

// Tombstone — удалённая row, возвращаемая на pull.
type Tombstone struct {
	Table     string
	RowID     uuid.UUID
	DeletedAt time.Time
}

// PullResult — aggregated pull response (pre-serialization).
type PullResult struct {
	Cursor       time.Time
	Changed      []TableDelta
	Deleted      []Tombstone
	FullSnapshot bool
	Truncated    bool
}

// ─── Push ─────────────────────────────────────────────────────────────────

// PushOpKind — push operation discriminator.
type PushOpKind string

const (
	PushOpUpsert PushOpKind = "upsert"
	PushOpDelete PushOpKind = "delete"
)

// PushOp — single batched mutation. Row/RowID populated based on Kind.
type PushOp struct {
	Index int
	Kind  PushOpKind
	Table string
	Row   map[string]any // upsert
	RowID uuid.UUID      // delete
}

// PushConflict — non-fatal failure for one op in a batch. Indexed back to
// the request slot so the client can retry / surface to user.
type PushConflict struct {
	Index   int
	Reason  string
	Message string
}

// PushRequest — batched push input.
type PushRequest struct {
	UserID         uuid.UUID
	OriginDeviceID uuid.UUID
	Operations     []PushOp
}

// PushResult — push reply (pre-serialization).
type PushResult struct {
	Applied   int
	Skipped   int
	Conflicts []PushConflict
}

// ─── Tier ─────────────────────────────────────────────────────────────────

// Tier — copy of users.storage_tier values relevant to sync. Free = 1
// device cap; Pro/Pro+ = unlimited.
type Tier string

const (
	TierFree Tier = "free"
)
