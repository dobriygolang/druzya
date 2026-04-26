// skill_writer.go — narrow port for writing per-user atlas progress.
//
// Mock-interview не импортирует profile/domain напрямую (cross-context
// дискrete bounded contexts). Bootstrap-адаптер (см. cmd/monolith/
// services/mock_interview.go) реализует этот интерфейс через
// profile/infra.Postgres.UpsertSkillNode.
//
// Зачем: после FinishPipeline orchestrator должен подвинуть прогресс на
// атласе (stage_kind → atlas node_key, score → progress%). Иначе
// пользователь жалуется «прошёл мок, а атлас не изменился».
package domain

import (
	"context"

	"github.com/google/uuid"
)

// SkillNodeWriter — write-only порт. Implementations MUST be idempotent
// (UPSERT с GREATEST на progress) — orchestrator может повторять вызов
// при retry'ях.
type SkillNodeWriter interface {
	UpsertSkillNode(ctx context.Context, userID uuid.UUID, nodeKey string, progress int) error
}
