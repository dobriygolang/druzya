package infra

import (
	"context"
	"fmt"
	"time"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pageMaterials выполняет keyset-paged выборку из таблиц с одинаковой
// схемой пагинации: WHERE user_id = $1 AND archived_at IS NULL,
// ORDER BY created_at DESC, id DESC.
//
// baseSelect должен заканчиваться `WHERE user_id = $1 AND archived_at IS NULL`
// (без trailing newline). scan читает одну строку pgx.Rows в T. keyFn
// возвращает (created_at, id) последнего элемента для построения следующего
// курсора.
//
// errCtx — короткий префикс для wrap'а ошибок (например, "hone.ListMaterials").
func pageMaterials[T any](
	ctx context.Context,
	pool *pgxpool.Pool,
	baseSelect string,
	userID uuid.UUID,
	limit int,
	cursor string,
	scan func(pgx.Rows) (T, error),
	keyFn func(T) (time.Time, uuid.UUID),
	errCtx string,
) ([]T, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeCreatedAtCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("%s: %w", errCtx, err)
	}
	peek := int32(limit) + 1
	var rows pgx.Rows
	if c.CreatedAt.IsZero() {
		rows, err = pool.Query(ctx, baseSelect+`
		  ORDER BY created_at DESC, id DESC
		  LIMIT $2`,
			sharedpg.UUID(userID), peek)
	} else {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("%s: cursor id: %w", errCtx, parseErr)
		}
		rows, err = pool.Query(ctx, baseSelect+`
		    AND (created_at, id) < ($2, $3)
		  ORDER BY created_at DESC, id DESC
		  LIMIT $4`,
			sharedpg.UUID(userID), c.CreatedAt, sharedpg.UUID(cid), peek)
	}
	if err != nil {
		return nil, "", fmt.Errorf("%s: %w", errCtx, err)
	}
	defer rows.Close()
	out := make([]T, 0, 16)
	for rows.Next() {
		m, scanErr := scan(rows)
		if scanErr != nil {
			return nil, "", fmt.Errorf("%s: scan: %w", errCtx, scanErr)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("%s: iterate: %w", errCtx, err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		t, id := keyFn(last)
		nextCursor = encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: t,
			ID:        id.String(),
		})
	}
	return out, nextCursor, nil
}
