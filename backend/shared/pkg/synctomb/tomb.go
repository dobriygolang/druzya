// Package synctomb — tombstone writer для cross-device sync (Phase C-4).
//
// Use-case'ы из любого bounded-context'а (hone, intelligence, etc) при
// удалении строки вызывают:
//
//	synctomb.Write(ctx, db, "hone_notes", userID, noteID, deviceID)
//
// Внутри одной TX с самим DELETE — иначе tombstone расходится с реальным
// delete'ом при rollback'е. Use case или infra repo получает
// `synctomb.Writer` interface и решает сам как обернуть в TX.
//
// Pull-endpoint в monolith читает таблицу напрямую (см. services/sync.go);
// этот пакет — только writer-сторона + типы.
package synctomb

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// TableName — допустимые таблицы для tombstone (соответствует CHECK в
// migration 00032). Изменение требует одновременного ALTER constraint.
type TableName string

const (
	TableHoneNotes         TableName = "hone_notes"
	TableHoneWhiteboards   TableName = "hone_whiteboards"
	TableHoneFocusSessions TableName = "hone_focus_sessions"
	TableHonePlans         TableName = "hone_plans"
	TableCoachEpisodes     TableName = "coach_episodes"
)

// Tx — минимальный contract'ом pgx-совместимого исполнителя. Принимаем
// либо *pgxpool.Pool, либо pgx.Tx — оба удовлетворяют (Exec с pgconn.CommandTag).
// Это позволяет caller'у решить нужна ли отдельная TX или достаточно pool.Exec.
type Tx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Write вставляет tombstone-запись. Вызывается ВНУТРИ TX где произошёл
// DELETE — иначе rollback DELETE'а не откатит tombstone, и pull
// возвратит «удалено» хотя в БД row ещё есть.
//
// originDeviceID может быть uuid.Nil — тогда NULL (admin-cleanup, cron).
func Write(ctx context.Context, ex Tx, table TableName, userID, rowID, originDeviceID uuid.UUID) error {
	var devArg any
	if originDeviceID != uuid.Nil {
		devArg = originDeviceID
	}
	if _, err := ex.Exec(ctx,
		`INSERT INTO sync_tombstones (user_id, table_name, row_id, origin_device_id)
		 VALUES ($1, $2, $3, $4)`,
		userID, string(table), rowID, devArg,
	); err != nil {
		return fmt.Errorf("synctomb.Write(%s): %w", table, err)
	}
	return nil
}

// WriteBatch — N tombstone'ов одним INSERT (для сценария где удаляется
// много строк за раз: например, cleanup отдельного user'а или batch
// archive). Все under one user_id и table_name.
func WriteBatch(ctx context.Context, ex Tx, table TableName, userID, originDeviceID uuid.UUID, rowIDs []uuid.UUID) error {
	if len(rowIDs) == 0 {
		return nil
	}
	var devArg any
	if originDeviceID != uuid.Nil {
		devArg = originDeviceID
	}
	// Multi-row INSERT через unnest — безопасный pattern в pgx без
	// рукотворного построения VALUES (...) (...) (...).
	if _, err := ex.Exec(ctx,
		`INSERT INTO sync_tombstones (user_id, table_name, row_id, origin_device_id)
		 SELECT $1, $2, unnest($3::uuid[]), $4`,
		userID, string(table), rowIDs, devArg,
	); err != nil {
		return fmt.Errorf("synctomb.WriteBatch(%s, %d rows): %w", table, len(rowIDs), err)
	}
	return nil
}

// (No compile-time assertion — pgx.Tx и *pgxpool.Pool оба имеют такой
// Exec и удовлетворяют интерфейсу при usage-site type-checking. Явный
// var _ Tx = (...)(nil) тянет circular import shared→pgx→pool.)
