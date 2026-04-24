// Package pg содержит мелкие helpers для pgx/pgtype, которые дублировались
// во многих сервисах. Вынесены в shared, чтобы правки конвертаций
// (Valid-флаг, обработка uuid.Nil) были в одном месте.
package pg

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// UUID конвертирует uuid.UUID в pgtype.UUID. uuid.Nil -> Valid=false,
// чтобы в БД уходил NULL там, где колонка nullable. Для NOT NULL колонок
// вызывающий сам обязан проверить, что id != uuid.Nil до вызова.
func UUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil}
}

// UUIDFrom разворачивает pgtype.UUID обратно в uuid.UUID. Для NULL-значений
// возвращает uuid.Nil — это согласовано с тем, что UUID() записывает Nil
// как Valid=false.
func UUIDFrom(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}
