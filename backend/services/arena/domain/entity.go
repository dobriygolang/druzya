// Package domain содержит сущности bounded-контекста арены, логику матчмейкинга
// и интерфейсы репозиториев. Импорты фреймворков сюда не допускаются.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel-ошибки.
var (
	ErrNotFound        = errors.New("arena: not found")
	ErrAlreadyInQueue  = errors.New("arena: already in queue")
	ErrNotParticipant  = errors.New("arena: not a match participant")
	ErrMatchStateWrong = errors.New("arena: match not in the required state")
	ErrCodeTooLarge    = errors.New("arena: code exceeds 50KB limit")
)

// MaxCodeSizeBytes — жёсткий лимит размера одной отправки кода (bible §11).
const MaxCodeSizeBytes = 50 * 1024

// InitialELO — стартовый рейтинг для игрока без истории. Хранится здесь, чтобы
// matchmaker не зависел от домена rating.
const InitialELO = 1000

// Match — доменная сущность одного PvP-матча.
type Match struct {
	ID          uuid.UUID
	TaskID      uuid.UUID
	TaskVersion int
	Section     enums.Section
	Mode        enums.ArenaMode
	Status      enums.MatchStatus
	WinnerID    *uuid.UUID
	StartedAt   *time.Time
	FinishedAt  *time.Time
	CreatedAt   time.Time
}

// Participant отражает строку таблицы arena_participants.
type Participant struct {
	MatchID        uuid.UUID
	UserID         uuid.UUID
	Team           int
	EloBefore      int
	EloAfter       *int
	SuspicionScore *float64
	SolveTimeMs    *int64
	SubmittedAt    *time.Time
}

// QueueTicket — ожидающая запись в очереди матчмейкинга, хранится в Redis.
type QueueTicket struct {
	UserID     uuid.UUID
	Section    enums.Section
	Mode       enums.ArenaMode
	Elo        int
	EnqueuedAt time.Time
}

// Pair — два тикета, которые matchmaker решил свести в матч.
type Pair struct {
	A QueueTicket
	B QueueTicket
}

// ReadyCheckWindow — сколько времени даётся обоим игрокам на подтверждение
// готовности до отмены матча (bible §3.4). Экспортируется для тестов.
const ReadyCheckWindow = 10 * time.Second

// PasteSuspicionBump — прибавка к suspicion_score участника за каждое событие
// paste_attempt.
const PasteSuspicionBump = 25.0

// SuspicionHighThreshold — порог suspicion_score, выше которого нужно поднять
// антифрод-сигнал severity=High.
const SuspicionHighThreshold = 75.0

// AnomalousSpeedSuspicion — базовый score, начисляемый, когда решение быстрее
// исторического p5.
const AnomalousSpeedSuspicion = 40.0
