// Package app contains the arena use cases and the matchmaker dispatcher.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/arena/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// LockTTL is the Redis lock held on a user_id while they are being locked into
// a created match. Kept short so a crashed dispatcher doesn't strand the user.
const LockTTL = 15 * time.Second

// TickInterval is how often the dispatcher wakes up to sweep queues.
const TickInterval = 2 * time.Second

// MatchNotifier is the hook the matchmaker uses to notify the WS layer that a
// match has been created for a user. The WS hub implements this.
type MatchNotifier interface {
	NotifyMatched(ctx context.Context, userID uuid.UUID, matchID uuid.UUID)
}

// Matchmaker runs the dispatcher loop.
type Matchmaker struct {
	Queue    domain.QueueRepo
	Ready    domain.ReadyCheckRepo
	Matches  domain.MatchRepo
	Tasks    domain.TaskRepo
	Bus      sharedDomain.Bus
	Notifier MatchNotifier
	Clock    domain.Clock
	Log      *slog.Logger

	// Sections and modes to sweep each tick. Defaults to all sections × Solo1v1.
	SweepPairs []SweepKey
}

// SweepKey names one queue to scan every tick.
type SweepKey struct {
	Section enums.Section
	Mode    enums.ArenaMode
}

// NewMatchmaker builds a matchmaker with default sweeps (all sections, solo 1v1).
func NewMatchmaker(
	q domain.QueueRepo,
	ready domain.ReadyCheckRepo,
	m domain.MatchRepo,
	tasks domain.TaskRepo,
	bus sharedDomain.Bus,
	notifier MatchNotifier,
	clk domain.Clock,
	log *slog.Logger,
) *Matchmaker {
	if clk == nil {
		clk = domain.RealClock{}
	}
	sweeps := make([]SweepKey, 0, len(enums.AllSections())*5)
	for _, s := range enums.AllSections() {
		for _, mode := range []enums.ArenaMode{
			enums.ArenaModeSolo1v1,
			enums.ArenaModeRanked,
			enums.ArenaModeHardcore,
			enums.ArenaModeCursed,
			// duo_2v2 needs 4 players — out of MVP scope; the dispatcher
			// handles only pair-creation at the moment.
		} {
			sweeps = append(sweeps, SweepKey{Section: s, Mode: mode})
		}
	}
	return &Matchmaker{
		Queue: q, Ready: ready, Matches: m, Tasks: tasks,
		Bus: bus, Notifier: notifier, Clock: clk, Log: log,
		SweepPairs: sweeps,
	}
}

// Start spawns the dispatcher goroutine and returns a stop function.
// The returned stop is idempotent.
func (mm *Matchmaker) Start(ctx context.Context) (stop func()) {
	ctx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(TickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := mm.Tick(ctx, mm.Clock.Now()); err != nil {
					mm.Log.ErrorContext(ctx, "arena.matchmaker.tick", slog.Any("err", err))
				}
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			cancel()
			wg.Wait()
		})
	}
}

// Tick sweeps every configured (section, mode) pair, picks pairs, locks the
// participants, and creates matches.
func (mm *Matchmaker) Tick(ctx context.Context, now time.Time) error {
	for _, sk := range mm.SweepPairs {
		tickets, err := mm.Queue.Snapshot(ctx, sk.Section, sk.Mode)
		if err != nil {
			mm.Log.WarnContext(ctx, "arena.matchmaker.snapshot",
				slog.String("section", string(sk.Section)),
				slog.String("mode", string(sk.Mode)),
				slog.Any("err", err),
			)
			continue
		}
		if len(tickets) < 2 {
			continue
		}
		pairs := domain.PickPairs(tickets, now)
		for _, p := range pairs {
			if err := mm.createMatchFromPair(ctx, sk, p, now); err != nil {
				mm.Log.WarnContext(ctx, "arena.matchmaker.createMatch", slog.Any("err", err))
			}
		}
	}
	return nil
}

func (mm *Matchmaker) createMatchFromPair(ctx context.Context, sk SweepKey, p domain.Pair, now time.Time) error {
	okA, err := mm.Queue.AcquireLock(ctx, p.A.UserID, LockTTL)
	if err != nil {
		return fmt.Errorf("arena.createMatch: lock A: %w", err)
	}
	if !okA {
		return nil
	}
	okB, err := mm.Queue.AcquireLock(ctx, p.B.UserID, LockTTL)
	if err != nil {
		_ = mm.Queue.ReleaseLock(ctx, p.A.UserID)
		return fmt.Errorf("arena.createMatch: lock B: %w", err)
	}
	if !okB {
		_ = mm.Queue.ReleaseLock(ctx, p.A.UserID)
		return nil
	}

	// Pick a task — difficulty by mean ELO band.
	mean := (p.A.Elo + p.B.Elo) / 2
	diff := domain.DifficultyForEloBand(mean)
	task, err := mm.Tasks.PickBySectionDifficulty(ctx, sk.Section, diff)
	if err != nil {
		_ = mm.Queue.ReleaseLock(ctx, p.A.UserID)
		_ = mm.Queue.ReleaseLock(ctx, p.B.UserID)
		return fmt.Errorf("arena.createMatch: pick task: %w", err)
	}

	m := domain.Match{
		TaskID:      task.ID,
		TaskVersion: task.Version,
		Section:     sk.Section,
		Mode:        sk.Mode,
		Status:      enums.MatchStatusConfirming,
	}
	parts := []domain.Participant{
		{UserID: p.A.UserID, Team: 0, EloBefore: p.A.Elo},
		{UserID: p.B.UserID, Team: 1, EloBefore: p.B.Elo},
	}
	created, err := mm.Matches.CreateMatch(ctx, m, parts)
	if err != nil {
		_ = mm.Queue.ReleaseLock(ctx, p.A.UserID)
		_ = mm.Queue.ReleaseLock(ctx, p.B.UserID)
		return fmt.Errorf("arena.createMatch: persist: %w", err)
	}

	// Remove both from the queue.
	_ = mm.Queue.Remove(ctx, p.A.UserID, sk.Section, sk.Mode)
	_ = mm.Queue.Remove(ctx, p.B.UserID, sk.Section, sk.Mode)

	// Start ready-check.
	deadline := domain.ReadyCheckDeadline(now)
	if err := mm.Ready.Start(ctx, created.ID, []uuid.UUID{p.A.UserID, p.B.UserID}, deadline); err != nil {
		mm.Log.WarnContext(ctx, "arena.createMatch: readycheck.Start", slog.Any("err", err))
	}

	// Publish the event. NOTE: shared/events.go MatchStarted's embedded `base`
	// is unexported so OccurredAt() reports a zero time from outside shared.
	// Downstream handlers (rating, notify) only read the exported fields, so
	// this is functionally fine for MVP; when a domain needs wall-clock OccurredAt
	// the shared/events.go side should expose a constructor.
	if err := mm.Bus.Publish(ctx, sharedDomain.MatchStarted{
		MatchID: created.ID,
		Section: sk.Section,
		Players: []uuid.UUID{p.A.UserID, p.B.UserID},
		TaskID:  task.ID,
		TaskVer: task.Version,
	}); err != nil {
		mm.Log.WarnContext(ctx, "arena.createMatch: publish MatchStarted", slog.Any("err", err))
	}

	if mm.Notifier != nil {
		mm.Notifier.NotifyMatched(ctx, p.A.UserID, created.ID)
		mm.Notifier.NotifyMatched(ctx, p.B.UserID, created.ID)
	}
	return nil
}

// EnqueueInput asks the matchmaker to enqueue a user.
type EnqueueInput struct {
	UserID  uuid.UUID
	Elo     int
	Section enums.Section
	Mode    enums.ArenaMode
}

// FindMatch enqueues the user (or returns that they're already matched).
type FindMatch struct {
	Queue domain.QueueRepo
	Clock domain.Clock
}

// FindMatchOutput is the response shape.
type FindMatchOutput struct {
	Status        string // "queued" | "matched"
	QueuePosition int
	EstWaitSec    int
	MatchID       *uuid.UUID
}

// Do enqueues and returns current state.
func (uc *FindMatch) Do(ctx context.Context, in EnqueueInput) (FindMatchOutput, error) {
	if !in.Section.IsValid() || !in.Mode.IsValid() {
		return FindMatchOutput{}, fmt.Errorf("arena.FindMatch: invalid section/mode")
	}
	clk := uc.Clock
	if clk == nil {
		clk = domain.RealClock{}
	}
	t := domain.QueueTicket{
		UserID:     in.UserID,
		Elo:        in.Elo,
		Section:    in.Section,
		Mode:       in.Mode,
		EnqueuedAt: clk.Now(),
	}
	if err := uc.Queue.Enqueue(ctx, t); err != nil && !errors.Is(err, domain.ErrAlreadyInQueue) {
		return FindMatchOutput{}, fmt.Errorf("arena.FindMatch: %w", err)
	}
	pos, err := uc.Queue.Position(ctx, in.UserID, in.Section, in.Mode)
	if err != nil {
		return FindMatchOutput{}, fmt.Errorf("arena.FindMatch: position: %w", err)
	}
	// 5s per person ahead — rough MVP estimate (bible §3.4 allows this heuristic).
	est := (pos - 1) * 5
	if est < 0 {
		est = 0
	}
	return FindMatchOutput{
		Status:        "queued",
		QueuePosition: pos,
		EstWaitSec:    est,
	}, nil
}

// CancelSearch removes the user from every queue.
type CancelSearch struct {
	Queue domain.QueueRepo
}

// Do removes the user's ticket.
func (uc *CancelSearch) Do(ctx context.Context, userID uuid.UUID) error {
	// We don't know the section/mode here — Remove is idempotent and falls
	// back to the stored index.
	for _, s := range enums.AllSections() {
		for _, m := range []enums.ArenaMode{
			enums.ArenaModeSolo1v1, enums.ArenaModeRanked, enums.ArenaModeHardcore, enums.ArenaModeCursed, enums.ArenaModeDuo2v2,
		} {
			if err := uc.Queue.Remove(ctx, userID, s, m); err != nil {
				return fmt.Errorf("arena.CancelSearch: %w", err)
			}
		}
	}
	return nil
}
