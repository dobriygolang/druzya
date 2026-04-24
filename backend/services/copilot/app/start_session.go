package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// StartSession — implements POST /api/v1/copilot/sessions. The
// single-live-session-per-user constraint is enforced by a partial
// unique index; we translate the unique violation into ErrLiveSessionExists
// so the client can react (usually: "end the previous one first").
type StartSession struct {
	Sessions domain.SessionRepo
	// Limiter ограничивает частоту старта сессий на конкретного юзера
	// (10/min). Без этого free-tier юзер может в цикле start→end и тихо
	// жечь LLM-бюджет фоновым анализатором на EndSession. Ключ — per-user,
	// НЕ per-IP, чтобы каждый имел свой персональный бюджет.
	Limiter domain.RateLimiter
}

type StartSessionInput struct {
	UserID uuid.UUID
	Kind   domain.SessionKind
}

func (uc *StartSession) Do(ctx context.Context, in StartSessionInput) (domain.Session, error) {
	if !in.Kind.IsValid() {
		return domain.Session{}, fmt.Errorf("copilot.StartSession: %w: kind=%q", domain.ErrInvalidInput, in.Kind)
	}
	// Rate-limit per user: 10 стартов в минуту. Лимитер nil-safe — в тестах,
	// которые о rate-limit не волнуются, можно оставить поле пустым.
	if uc.Limiter != nil {
		if _, _, err := uc.Limiter.Allow(ctx, "rl:copilot:start:"+in.UserID.String(), 10, time.Minute); err != nil {
			if errors.Is(err, domain.ErrRateLimited) {
				return domain.Session{}, fmt.Errorf("copilot.StartSession: %w", err)
			}
			return domain.Session{}, fmt.Errorf("copilot.StartSession: rate limit: %w", err)
		}
	}
	s, err := uc.Sessions.Create(ctx, in.UserID, in.Kind)
	if err != nil {
		return domain.Session{}, fmt.Errorf("copilot.StartSession: %w", err)
	}
	return s, nil
}
