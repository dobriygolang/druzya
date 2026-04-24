// Package app — use-case для страницы /match-history.
//
// GetMyMatches намеренно тонкий: нормализует окно пагинации (клампы
// limit/offset живут в domain, чтобы их можно было тривиально тестировать),
// запрашивает у repo одну страницу и возвращает строки + total. Вся
// форматировка (fallback аватара, метки «vs @user», time-ago строки) — это
// работа фронтенда; мы держим wire-форму плоской и стабильной.
package app

import (
	"context"
	"fmt"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// GetMyMatches возвращает страницу истории матчей вызывающего пользователя.
type GetMyMatches struct {
	Matches domain.MatchRepo
}

// GetMyMatchesInput — форма входа для GetMyMatches.Do.
type GetMyMatchesInput struct {
	UserID  uuid.UUID
	Limit   int
	Offset  int
	Mode    enums.ArenaMode // "" = без фильтра
	Section enums.Section   // "" = без фильтра
}

// GetMyMatchesOutput — страница + total (под применённым фильтром).
type GetMyMatchesOutput struct {
	Items []domain.MatchHistoryEntry
	Total int
}

// Do исполняет use-case. Ошибки repo оборачиваются стандартным префиксом
// "arena.GetMyMatches: %w", чтобы ports-слой мог делать errors.Is на тех
// же sentinel'ах, что и любой другой use-case.
func (uc *GetMyMatches) Do(ctx context.Context, in GetMyMatchesInput) (GetMyMatchesOutput, error) {
	limit := domain.ClampHistoryLimit(in.Limit)
	offset := domain.ClampHistoryOffset(in.Offset)

	// Валидируем фильтры, если заданы — неизвестный mode/section не должен
	// долетать до repo (defence in depth: wire-слой тоже отклоняет невалидные enum'ы).
	if in.Mode != "" && !in.Mode.IsValid() {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: invalid mode %q", in.Mode)
	}
	if in.Section != "" && !in.Section.IsValid() {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: invalid section %q", in.Section)
	}

	items, total, err := uc.Matches.ListByUser(ctx, in.UserID, limit, offset, in.Mode, in.Section)
	if err != nil {
		return GetMyMatchesOutput{}, fmt.Errorf("arena.GetMyMatches: %w", err)
	}
	if items == nil {
		items = []domain.MatchHistoryEntry{}
	}
	return GetMyMatchesOutput{Items: items, Total: total}, nil
}
