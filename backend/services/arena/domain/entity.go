// Package domain contains the arena bounded-context entities, matchmaking logic
// and repository interfaces. No framework imports here.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel errors.
var (
	ErrNotFound        = errors.New("arena: not found")
	ErrAlreadyInQueue  = errors.New("arena: already in queue")
	ErrNotParticipant  = errors.New("arena: not a match participant")
	ErrMatchStateWrong = errors.New("arena: match not in the required state")
	ErrCodeTooLarge    = errors.New("arena: code exceeds 50KB limit")
)

// MaxCodeSizeBytes is the hard per-submission cap (bible §11).
const MaxCodeSizeBytes = 50 * 1024

// InitialELO is the default rating for a never-rated player — kept here so the
// matchmaker doesn't need to import the rating domain.
const InitialELO = 1000

// Match is the domain entity for a single PvP match.
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

// Participant mirrors an arena_participants row.
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

// QueueTicket is a pending matchmaking entry, tracked in Redis.
type QueueTicket struct {
	UserID     uuid.UUID
	Section    enums.Section
	Mode       enums.ArenaMode
	Elo        int
	EnqueuedAt time.Time
}

// Pair is two tickets the matchmaker has decided to match.
type Pair struct {
	A QueueTicket
	B QueueTicket
}

// ReadyCheckWindow is how long both players have to confirm before the match
// is cancelled (bible §3.4). Exposed for tests.
const ReadyCheckWindow = 10 * time.Second

// PasteSuspicionBump is added to a participant's suspicion_score per
// paste_attempt event.
const PasteSuspicionBump = 25.0

// SuspicionHighThreshold is the score above which a High-severity anticheat
// signal must be raised.
const SuspicionHighThreshold = 75.0

// AnomalousSpeedSuspicion is the baseline score assigned when a solve is faster
// than the historical p5.
const AnomalousSpeedSuspicion = 40.0
