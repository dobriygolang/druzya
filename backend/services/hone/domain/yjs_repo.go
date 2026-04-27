package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// YjsKind описывает per-domain параметры таблиц для generic CRDT-persistence
// (notes / whiteboards / ...). Те же 3 SQL-параметра, что в monolith handler'е,
// — переехали в domain, чтобы repo-уровень не знал про HTTP slug'и.
type YjsKind struct {
	// Parent table where ownership is recorded (hone_notes, hone_whiteboards).
	ParentTable string
	// Updates table — где писать append'ы (note_yjs_updates, ...).
	UpdatesTable string
	// FK column в updates table указывающая на parent (note_id, whiteboard_id).
	ForeignKey string
}

// YjsUpdate — одна row из updates-таблицы.
type YjsUpdate struct {
	Seq            int64
	Data           []byte
	OriginDeviceID *uuid.UUID
	CreatedAt      time.Time
}

// YjsAppendResult — результат append'а.
type YjsAppendResult struct {
	Seq       int64
	CreatedAt time.Time
}

// YjsCompactResult — результат compact'а.
type YjsCompactResult struct {
	Seq     int64
	Removed int64
}

// YjsRepo — generic CRDT-persistence уровня domain. Все методы принимают
// YjsKind, выбирающий конкретную пару (parent, updates) таблиц.
type YjsRepo interface {
	// OwnsParent — true если (userID, parentID) указывают на существующую
	// строку в parent-таблице.
	OwnsParent(ctx context.Context, k YjsKind, userID, parentID uuid.UUID) (bool, error)

	// Append вставляет одну update-row, возвращает seq+createdAt.
	Append(ctx context.Context, k YjsKind, userID, parentID uuid.UUID, data []byte, originDeviceID *uuid.UUID) (YjsAppendResult, error)

	// ListSince возвращает updates с seq > since, сортированы ASC, max
	// `limit` rows.
	ListSince(ctx context.Context, k YjsKind, userID, parentID uuid.UUID, since int64, limit int) ([]YjsUpdate, error)

	// Compact: внутри одной TX: insert merged-update + delete все update'ы
	// с seq < newSeq.
	Compact(ctx context.Context, k YjsKind, userID, parentID uuid.UUID, mergedData []byte, originDeviceID *uuid.UUID) (YjsCompactResult, error)
}

// SyncEventPublisher — domain-level интерфейс для broadcast write-event'ов
// на другие устройства юзера. nil-реализация — no-op.
//
// Реальная реализация (in-process broker) живёт в monolith services. Hone
// домен зависит только от этого узкого интерфейса.
type SyncEventPublisher interface {
	// PublishYjsAppend — fan-out на other devices: «в kind/parentID
	// прилетел новый update, тяните /updates».
	PublishYjsAppend(userID uuid.UUID, kindSlug string, parentID string, originDeviceID uuid.UUID)
	// PublishSyncChange — fan-out на other devices: «таблица table
	// изменилась, тяните replication».
	PublishSyncChange(userID uuid.UUID, table string, originDeviceID uuid.UUID)
}
