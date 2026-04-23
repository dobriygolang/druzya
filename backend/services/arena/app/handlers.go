package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/arena/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ConfirmReady records a ready-check confirmation and transitions the match to
// active once both players confirm.
type ConfirmReady struct {
	Matches  domain.MatchRepo
	Ready    domain.ReadyCheckRepo
	Bus      sharedDomain.Bus
	Notifier MatchNotifier
	Clock    domain.Clock
	Log      *slog.Logger
}

// Do handles one confirm call.
func (uc *ConfirmReady) Do(ctx context.Context, matchID, userID uuid.UUID) error {
	clk := uc.Clock
	if clk == nil {
		clk = domain.RealClock{}
	}
	now := clk.Now()

	state, ok, err := uc.Ready.Get(ctx, matchID)
	if err != nil {
		return fmt.Errorf("arena.ConfirmReady: %w", err)
	}
	if !ok {
		return fmt.Errorf("arena.ConfirmReady: %w", domain.ErrNotFound)
	}
	if domain.IsReadyCheckExpired(state.Deadline, now) {
		return fmt.Errorf("arena.ConfirmReady: %w", domain.ErrMatchStateWrong)
	}
	found := false
	for _, u := range state.UserIDs {
		if u == userID {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("arena.ConfirmReady: %w", domain.ErrNotParticipant)
	}
	everyone, err := uc.Ready.Confirm(ctx, matchID, userID)
	if err != nil {
		return fmt.Errorf("arena.ConfirmReady: %w", err)
	}
	if !everyone {
		return nil
	}
	started := now
	if err := uc.Matches.UpdateStatus(ctx, matchID, enums.MatchStatusActive, &started, nil); err != nil {
		return fmt.Errorf("arena.ConfirmReady: update status: %w", err)
	}
	_ = uc.Ready.Clear(ctx, matchID)
	return nil
}

// HandleReadyCheckTimeout must be called by a separate sweeper (or on demand
// from a GET /match/{id}) when the deadline passes without both confirmations.
type HandleReadyCheckTimeout struct {
	Queue   domain.QueueRepo
	Matches domain.MatchRepo
	Ready   domain.ReadyCheckRepo
	Bus     sharedDomain.Bus
	Clock   domain.Clock
	Log     *slog.Logger
}

// Sweep checks the match's ready-check state and, if expired with outstanding
// confirms, cancels the match, re-queues the confirming user with a +5 ELO
// bonus, and raises an anticheat signal on the non-confirming one.
func (uc *HandleReadyCheckTimeout) Sweep(ctx context.Context, matchID uuid.UUID) error {
	clk := uc.Clock
	if clk == nil {
		clk = domain.RealClock{}
	}
	now := clk.Now()

	state, ok, err := uc.Ready.Get(ctx, matchID)
	if err != nil {
		return fmt.Errorf("arena.HandleReadyCheckTimeout: %w", err)
	}
	if !ok {
		return nil
	}
	if !domain.IsReadyCheckExpired(state.Deadline, now) {
		return nil
	}
	// Identify who confirmed / who didn't.
	var confirmed, nonConfirmed []uuid.UUID
	for _, u := range state.UserIDs {
		if state.Confirmed[u] {
			confirmed = append(confirmed, u)
		} else {
			nonConfirmed = append(nonConfirmed, u)
		}
	}
	// Load match to know section+mode.
	m, err := uc.Matches.Get(ctx, matchID)
	if err != nil {
		return fmt.Errorf("arena.HandleReadyCheckTimeout: load match: %w", err)
	}
	// Cancel.
	if err := uc.Matches.UpdateStatus(ctx, matchID, enums.MatchStatusCancelled, nil, &now); err != nil {
		return fmt.Errorf("arena.HandleReadyCheckTimeout: update: %w", err)
	}
	_ = uc.Ready.Clear(ctx, matchID)
	_ = uc.Bus.Publish(ctx, sharedDomain.MatchCancelled{
		MatchID: matchID,
		Reason:  "ready_check_timeout",
	})
	// Re-queue confirming users with +5 ELO bonus.
	parts, _ := uc.Matches.ListParticipants(ctx, matchID)
	eloByUser := map[uuid.UUID]int{}
	for _, p := range parts {
		eloByUser[p.UserID] = p.EloBefore
	}
	for _, u := range confirmed {
		_ = uc.Queue.Enqueue(ctx, domain.QueueTicket{
			UserID:     u,
			Section:    m.Section,
			Mode:       m.Mode,
			Elo:        eloByUser[u] + 5,
			EnqueuedAt: now,
		})
	}
	// Anticheat signal on non-confirming users. NOTE: bible asks for
	// AnticheatTabSwitch if a WS disconnect was observed. The WS hub sets that
	// flag; here we conservatively raise SuspiciousPattern.
	for _, u := range nonConfirmed {
		mID := matchID
		_ = uc.Bus.Publish(ctx, sharedDomain.AnticheatSignalRaised{
			UserID:   u,
			MatchID:  &mID,
			Type:     enums.AnticheatSuspiciousPattern,
			Severity: enums.SeverityMedium,
			Metadata: map[string]any{"reason": "ready_check_no_confirm"},
		})
	}
	return nil
}

// SubmitCode validates size + language, invokes Judge0, and on first pass
// declares the winner and closes the match.
type SubmitCode struct {
	Matches   domain.MatchRepo
	Tasks     domain.TaskRepo
	Judge0    domain.Judge0Client
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
	Clock     domain.Clock
	Log       *slog.Logger
}

// SubmitCodeInput is the input shape.
type SubmitCodeInput struct {
	MatchID  uuid.UUID
	UserID   uuid.UUID
	Code     string
	Language enums.Language
}

// SubmitCodeOutput is the result returned synchronously.
type SubmitCodeOutput struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}

// Do runs a submission end-to-end.
func (uc *SubmitCode) Do(ctx context.Context, in SubmitCodeInput) (SubmitCodeOutput, error) {
	if len(in.Code) > domain.MaxCodeSizeBytes {
		return SubmitCodeOutput{}, domain.ErrCodeTooLarge
	}
	if !in.Language.IsValid() {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: invalid language")
	}
	m, err := uc.Matches.Get(ctx, in.MatchID)
	if err != nil {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: %w", err)
	}
	// Only participants may submit.
	parts, err := uc.Matches.ListParticipants(ctx, in.MatchID)
	if err != nil {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: participants: %w", err)
	}
	isPart := false
	for _, p := range parts {
		if p.UserID == in.UserID {
			isPart = true
			break
		}
	}
	if !isPart {
		return SubmitCodeOutput{}, domain.ErrNotParticipant
	}
	// Validate state — only active.
	switch m.Status {
	case enums.MatchStatusActive:
		// ok
	case enums.MatchStatusSearching, enums.MatchStatusConfirming,
		enums.MatchStatusFinished, enums.MatchStatusCancelled:
		return SubmitCodeOutput{}, domain.ErrMatchStateWrong
	default:
		return SubmitCodeOutput{}, domain.ErrMatchStateWrong
	}

	task, err := uc.Tasks.GetByID(ctx, m.TaskID)
	if err != nil {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: task: %w", err)
	}
	res, err := uc.Judge0.Submit(ctx, in.Code, string(in.Language), task)
	if err != nil {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: judge0: %w", err)
	}

	now := uc.clockNow()
	var solveMs *int64
	if m.StartedAt != nil {
		v := now.Sub(*m.StartedAt).Milliseconds()
		solveMs = &v
	}
	suspicion, _ := uc.Anticheat.GetSuspicion(ctx, in.MatchID, in.UserID)
	part := domain.Participant{
		MatchID:        in.MatchID,
		UserID:         in.UserID,
		SolveTimeMs:    solveMs,
		SuspicionScore: &suspicion,
		SubmittedAt:    &now,
	}
	if err := uc.Matches.UpsertParticipantResult(ctx, part); err != nil {
		return SubmitCodeOutput{}, fmt.Errorf("arena.SubmitCode: persist result: %w", err)
	}

	if res.Passed {
		if m.Mode == enums.ArenaModeDuo2v2 {
			uc.maybeFinishDuo(ctx, in.MatchID, in.UserID, m, parts, now)
		} else {
			// First passing submission wins. Idempotent: SetWinner only succeeds once.
			if err := uc.Matches.SetWinner(ctx, in.MatchID, in.UserID, now); err != nil {
				// If the row doesn't exist, bubble; otherwise treat as lost race.
				uc.Log.WarnContext(ctx, "arena.SubmitCode: SetWinner", slog.Any("err", err))
			} else {
				losers := make([]uuid.UUID, 0, len(parts)-1)
				for _, p := range parts {
					if p.UserID != in.UserID {
						losers = append(losers, p.UserID)
					}
				}
				var dur int64
				if m.StartedAt != nil {
					dur = now.Sub(*m.StartedAt).Milliseconds()
				}
				_ = uc.Bus.Publish(ctx, sharedDomain.MatchCompleted{
					MatchID:    in.MatchID,
					Section:    m.Section,
					WinnerID:   in.UserID,
					LoserIDs:   losers,
					EloDeltas:  map[uuid.UUID]int{}, // rating domain computes the real delta
					DurationMs: dur,
				})
			}
		}
	}

	return SubmitCodeOutput{
		Passed:      res.Passed,
		TestsTotal:  res.TestsTotal,
		TestsPassed: res.TestsPassed,
		RuntimeMs:   res.RuntimeMs,
		MemoryKB:    res.MemoryKB,
	}, nil
}

func (uc *SubmitCode) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}

// maybeFinishDuo decides whether the just-passing submission completes a 2v2
// match. A 2v2 match is won by the first team where *both* members have
// submitted_at set on their participant row (the SubmitCode upsert above
// stamps it). If only one team-member has submitted we wait.
//
// The persistence is best-effort idempotent: SetWinningTeam updates rows
// matching `id = $1`, so a duplicate call only re-stamps finished_at.
func (uc *SubmitCode) maybeFinishDuo(
	ctx context.Context,
	matchID, justFinishedUser uuid.UUID,
	m domain.Match,
	parts []domain.Participant,
	now time.Time,
) {
	// Build a passed-set: a participant is considered passed when their
	// row already has a submitted_at OR when they're the just-finished user
	// (whose row was upserted by SubmitCode but the local `parts` slice was
	// loaded *before* that upsert, so submitted_at could still be nil here).
	passed := make(map[uuid.UUID]bool, len(parts))
	for _, p := range parts {
		if p.SubmittedAt != nil {
			passed[p.UserID] = true
		}
	}
	passed[justFinishedUser] = true

	winningTeam, decided := domain.ResolveDuoWinner(parts, passed)
	if !decided || winningTeam == 0 {
		return
	}
	if err := uc.Matches.SetWinningTeam(ctx, matchID, winningTeam, now); err != nil {
		uc.Log.WarnContext(ctx, "arena.SubmitCode: SetWinningTeam", slog.Any("err", err))
		return
	}
	// MatchCompleted requires a single WinnerID — for 2v2 we publish the
	// just-finished user as the "winning captain" and put both teammates in
	// LoserIDs of the opposing team. The rating domain will read the
	// participant team_id from postgres directly to award team-level deltas.
	losers := make([]uuid.UUID, 0, len(parts))
	for _, p := range parts {
		if p.Team != winningTeam {
			losers = append(losers, p.UserID)
		}
	}
	var dur int64
	if m.StartedAt != nil {
		dur = now.Sub(*m.StartedAt).Milliseconds()
	}
	_ = uc.Bus.Publish(ctx, sharedDomain.MatchCompleted{
		MatchID:    matchID,
		Section:    m.Section,
		WinnerID:   justFinishedUser,
		LoserIDs:   losers,
		EloDeltas:  map[uuid.UUID]int{},
		DurationMs: dur,
	})
}

// GetMatch returns the match+participants view.
type GetMatch struct {
	Matches domain.MatchRepo
	Tasks   domain.TaskRepo
}

// MatchView is the rendered view.
type MatchView struct {
	Match        domain.Match
	Task         *domain.TaskPublic
	Participants []domain.Participant
}

// Do returns the match detail.
func (uc *GetMatch) Do(ctx context.Context, matchID uuid.UUID) (MatchView, error) {
	m, err := uc.Matches.Get(ctx, matchID)
	if err != nil {
		return MatchView{}, fmt.Errorf("arena.GetMatch: %w", err)
	}
	parts, err := uc.Matches.ListParticipants(ctx, matchID)
	if err != nil {
		return MatchView{}, fmt.Errorf("arena.GetMatch: %w", err)
	}
	v := MatchView{Match: m, Participants: parts}
	if m.TaskID != uuid.Nil {
		t, err := uc.Tasks.GetByID(ctx, m.TaskID)
		if err == nil {
			v.Task = &t
		}
	}
	return v, nil
}

// OnPasteAttempt accumulates suspicion score on paste events. Returns the new
// score and a raised flag when High threshold is crossed.
type OnPasteAttempt struct {
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
}

// Apply ingests one paste event.
func (uc *OnPasteAttempt) Apply(ctx context.Context, matchID, userID uuid.UUID) error {
	cur, err := uc.Anticheat.GetSuspicion(ctx, matchID, userID)
	if err != nil {
		return fmt.Errorf("arena.OnPasteAttempt: %w", err)
	}
	newScore, crossed := domain.AccumulateSuspicion(cur, domain.PasteSuspicionBump)
	if _, err := uc.Anticheat.AddSuspicion(ctx, matchID, userID, newScore-cur); err != nil {
		return fmt.Errorf("arena.OnPasteAttempt: %w", err)
	}
	if crossed {
		mID := matchID
		_ = uc.Bus.Publish(ctx, sharedDomain.AnticheatSignalRaised{
			UserID:   userID,
			MatchID:  &mID,
			Type:     enums.AnticheatPasteDetected,
			Severity: enums.SeverityHigh,
			Metadata: map[string]any{"score": newScore},
		})
	}
	return nil
}

// OnTabSwitch records a tab-switch event.
type OnTabSwitch struct {
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
}

// Apply records one tab-switch event.
func (uc *OnTabSwitch) Apply(ctx context.Context, matchID, userID uuid.UUID) error {
	n, err := uc.Anticheat.IncrTabSwitch(ctx, matchID, userID)
	if err != nil {
		return fmt.Errorf("arena.OnTabSwitch: %w", err)
	}
	mID := matchID
	_ = uc.Bus.Publish(ctx, sharedDomain.AnticheatSignalRaised{
		UserID:   userID,
		MatchID:  &mID,
		Type:     enums.AnticheatTabSwitch,
		Severity: domain.TabSwitchSeverity(n),
		Metadata: map[string]any{"count": n},
	})
	return nil
}
