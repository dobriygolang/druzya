package domain

import (
	"context"

	"github.com/google/uuid"
)

// StorageRepo абстрагирует все persist-операции storage-домена. Делится на
// логические группы (quota-read, archive-write, recompute) — но один
// interface на repo, чтобы infra-имплементация была одной структурой
// поверх *pgxpool.Pool.
type StorageRepo interface {
	// GetQuota возвращает текущий снапшот {used, quota, tier} для юзера.
	// Используется и в REST GET /storage/quota, и в quota-gate
	// middleware (с TTL-кэшем поверх).
	GetQuota(ctx context.Context, userID uuid.UUID) (Quota, error)

	// ArchiveOldestNotes помечает archived_at = now() для N самых старых
	// (по updated_at) активных заметок юзера. Возвращает число
	// затронутых строк.
	ArchiveOldestNotes(ctx context.Context, userID uuid.UUID, count int) (int64, error)

	// SetNoteArchived переключает archived_at для одной заметки. archived
	// = true ставит now(), false — NULL. Возвращает ErrNotFound если
	// строка не найдена (включая случай чужой заметки).
	SetNoteArchived(ctx context.Context, userID, noteID uuid.UUID, archived bool) error

	// RecomputeAllUsage пересчитывает users.storage_used_bytes для ВСЕХ
	// юзеров одним statement'ом (см. SQL в infra). Дёргается hourly
	// cron'ом из app/recompute_usage.go.
	RecomputeAllUsage(ctx context.Context) error
}
