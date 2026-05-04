package infra

import (
	"context"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// GetPercentiles — pivot 2026-05-01: ratings/arena tables dropped, поэтому
// больше нет источника для in_tier / in_global percentile'ей. Возвращаем
// нули (поля сохранены в proto для wire-compat, фронт их не рендерит).
//
// Если когда-то снова появится rating/leaderboard — вернуть SQL-логику
// из git-истории (последняя версия с реальным расчётом — до миграции
// 00029_drop_arena_lobby).
func (p *Postgres) GetPercentiles(ctx context.Context, userID uuid.UUID, _ time.Time) (domain.PercentileView, error) {
	_ = ctx
	_ = userID
	return domain.PercentileView{}, nil
}
