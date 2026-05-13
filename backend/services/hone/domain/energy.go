//go:generate mockgen -package mocks -destination mocks/energy_mock.go -source energy.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Energy tracker sub-context (Phase K Wave 15, 2026-05-14).
//
// Один лог-строкa = «сейчас энергия 1..5 + optional note». Через N точек
// строится трендовый график, который помогает планировать сложные задачи
// на пик энергии (см. time-blocking page in Hone).
//
// Не AI, не coach — простая capture-приhost'а с такой же offline-семантикой
// как focus_reflections.

// EnergyMinLevel / EnergyMaxLevel — допустимый диапазон.
const (
	EnergyMinLevel = 1
	EnergyMaxLevel = 5
)

// EnergyLog — одна строка в energy_logs.
type EnergyLog struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Level    int    // 1..5
	Note     string // optional
	LoggedAt time.Time
}

// EnergyRepo персистит energy_logs.
type EnergyRepo interface {
	// Create вставляет одну точку. ID + LoggedAt заполняет если zero.
	Create(ctx context.Context, l EnergyLog) (EnergyLog, error)
	// ListRecent возвращает точки юзера за последние `days` дней,
	// отсортированные logged_at DESC. Cap 90 дней — дальше нет смысла,
	// паттерны устаревают.
	ListRecent(ctx context.Context, userID uuid.UUID, days int) ([]EnergyLog, error)
}
