// energy.go — energy tracker use cases (Phase K Wave 15).
//
// Simple capture: юзер тэгает уровень 1-5 раз в N часов, бэк хранит,
// клиент строит тренд. Нет AI, нет coach hooks — pure data plumbing.
package app

import (
	"context"
	"fmt"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// LogEnergy создаёт одну точку.
type LogEnergy struct {
	Energy domain.EnergyRepo
}

// LogEnergyInput.
type LogEnergyInput struct {
	UserID uuid.UUID
	Level  int
	Note   string
}

// Do executes the use case.
func (uc *LogEnergy) Do(ctx context.Context, in LogEnergyInput) (domain.EnergyLog, error) {
	if in.Level < domain.EnergyMinLevel || in.Level > domain.EnergyMaxLevel {
		return domain.EnergyLog{}, fmt.Errorf("hone.LogEnergy: %w: level out of range (1..5), got %d",
			domain.ErrInvalidInput, in.Level)
	}
	l, err := uc.Energy.Create(ctx, domain.EnergyLog{
		UserID: in.UserID,
		Level:  in.Level,
		Note:   in.Note,
	})
	if err != nil {
		return domain.EnergyLog{}, fmt.Errorf("hone.LogEnergy: %w", err)
	}
	return l, nil
}

// ListEnergyLogs возвращает recent точки юзера.
type ListEnergyLogs struct {
	Energy domain.EnergyRepo
}

// Do executes the use case.
func (uc *ListEnergyLogs) Do(ctx context.Context, userID uuid.UUID, days int) ([]domain.EnergyLog, error) {
	rows, err := uc.Energy.ListRecent(ctx, userID, days)
	if err != nil {
		return nil, fmt.Errorf("hone.ListEnergyLogs: %w", err)
	}
	return rows, nil
}
