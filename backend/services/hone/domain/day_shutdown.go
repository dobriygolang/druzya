//go:generate mockgen -package mocks -destination mocks/day_shutdown_mock.go -source day_shutdown.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// DayShutdown — одна запись end-of-day shutdown ритуала. На каждого
// (user, calendar_day) — не более одной строки (UPSERT по UNIQUE-индексу
// в day_shutdowns).
type DayShutdown struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	// ShutdownDate — календарный день, который завершён. Не TS — юзер
	// может submit'нуть в 23:55 или в 00:05 следующего дня и иметь в виду
	// предыдущий; клиент отвечает за выбор корректной даты.
	ShutdownDate time.Time
	Done         string
	Pending      string
	Tomorrow     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// DayShutdownRepo — pgx-backed persistence для day_shutdowns.
type DayShutdownRepo interface {
	// Upsert вставляет новую запись либо обновляет существующую по
	// UNIQUE(user_id, shutdown_date). Возвращает hydrated row (с
	// заполненными id / updated_at — нужны фронту для отображения).
	Upsert(ctx context.Context, s DayShutdown) (DayShutdown, error)
	// GetForDate возвращает запись на конкретный календарный день;
	// ErrNotFound если её нет (юзер не закрывал день).
	GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (DayShutdown, error)
	// GetMostRecent возвращает последнюю запись для юзера (по
	// shutdown_date DESC). Используется daily_brief'ом утром: «найди мне
	// вчерашний shutdown, если есть». ErrNotFound если юзер никогда не
	// закрывал.
	GetMostRecent(ctx context.Context, userID uuid.UUID) (DayShutdown, error)
}
