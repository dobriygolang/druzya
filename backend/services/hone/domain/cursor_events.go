package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CursorEventKind — типы событий, которые AI cursor рисует на frontend'е.
//
// Каждое событие — атомарный кадр анимации. Frontend подписывается на
// SSE-стрим конкретного юзера и проигрывает их в порядке прихода.
// Reviewer-worker сам ставит искусственные паузы между ними.
type CursorEventKind string

const (
	// CursorMove — точечное перемещение курсора в координатах "доски".
	// Frontend интерполирует движение (linear, ~250ms) от текущей позиции
	// до новой; payload `to` — относительная координата (cardId+offset).
	CursorMove CursorEventKind = "cursor.move"

	// CardFocus — курсор "наводится" на конкретную карточку: frontend
	// рисует подсветку и ховер-стейт.
	CardFocus CursorEventKind = "card.focus"

	// CardThinking — спиннер "AI думает" над карточкой; frontend
	// показывает анимацию пока не придёт следующее событие.
	CardThinking CursorEventKind = "card.thinking"

	// CardComment — оставлен комментарий в треде карточки. Frontend
	// добавляет строку в comments thread (или просто перезапрашивает
	// список комментариев — payload содержит body).
	CardComment CursorEventKind = "card.comment"

	// CardMove — карточка переехала в новый column. Анимация переноса.
	CardMove CursorEventKind = "card.move"

	// CardCategorise — Phase J / H3 (2026-05-12): emitted by the auto-
	// categoriser after CreateTask / BulkAutoCategorise когда LLM
	// determined a kind. Frontend renders a transient toast «Auto-tagged
	// as <Kind>» with reasoning peek + undo affordance. Payload uses:
	//   - Body          → reasoning string
	//   - DetectedKind  → assigned kind (algo / sysdesign / ...)
	//   - Confidence    → 0..1 LLM self-confidence
	CardCategorise CursorEventKind = "card.categorise"
)

// CursorEvent — единственный wire-тип SSE-стрима. Поля используются
// разные для разных Kind: для CursorMove нужен только TaskID + ToColumn
// в качестве "куда летит курсор", для CardComment нужен Body, и так далее.
// Не делаем sum-type через интерфейсы: SSE — JSON-line, поля nullable
// проще для frontend'а.
type CursorEvent struct {
	Kind       CursorEventKind
	UserID     uuid.UUID
	TaskID     uuid.UUID
	ToColumn   TaskStatus // только для CursorMove / CardMove
	FromColumn TaskStatus // только для CardMove
	Body       string     // CardComment reads comment body; CardCategorise reads reasoning
	OccurredAt time.Time
	// Phase J / H3 (2026-05-12) — CardCategorise payload extension.
	DetectedKind TaskKind // только для CardCategorise
	Confidence   float32  // только для CardCategorise, 0..1
}

// CursorEventBus — pub/sub канал per-user. Реализация (in-process channel
// fan-out) в infra/cursor_bus.go. Hone TaskBoard SSE handler
// подписывается через Subscribe; review-worker публикует через Publish.
type CursorEventBus interface {
	// Subscribe возвращает канал событий для конкретного юзера и функцию
	// для отписки. Каналы буферизованы (16) — медленный consumer не
	// блокирует publisher; превышение → drop oldest.
	Subscribe(userID uuid.UUID) (<-chan CursorEvent, func())
	// Publish широковещательный per-user. Не-блокирующий; на полный
	// канал событие дропается с инкрементом метрики.
	Publish(ctx context.Context, e CursorEvent)
}
