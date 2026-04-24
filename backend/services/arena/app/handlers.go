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

// ConfirmReady фиксирует подтверждение ready-check и переводит матч в
// active, когда оба игрока подтвердили.
type ConfirmReady struct {
	Matches  domain.MatchRepo
	Ready    domain.ReadyCheckRepo
	Bus      sharedDomain.Bus
	Notifier MatchNotifier
	Clock    domain.Clock
	Log      *slog.Logger
}

// Do обрабатывает один вызов confirm.
func (uc *ConfirmReady) Do(ctx context.Context, matchID, userID uuid.UUID) error {
	now := uc.Clock.Now()

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

// HandleReadyCheckTimeout должен вызываться отдельным sweeper'ом (или по
// требованию из GET /match/{id}), когда deadline прошёл без обоих подтверждений.
type HandleReadyCheckTimeout struct {
	Queue   domain.QueueRepo
	Matches domain.MatchRepo
	Ready   domain.ReadyCheckRepo
	Bus     sharedDomain.Bus
	Clock   domain.Clock
	Log     *slog.Logger
}

// Sweep проверяет состояние ready-check матча и, если deadline просрочен
// с не полученными подтверждениями, отменяет матч, возвращает в очередь
// подтвердившего с бонусом +5 ELO и поднимает anticheat-сигнал на
// неподтвердившего.
func (uc *HandleReadyCheckTimeout) Sweep(ctx context.Context, matchID uuid.UUID) error {
	now := uc.Clock.Now()

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
	// Определяем, кто подтвердил, а кто нет.
	var confirmed, nonConfirmed []uuid.UUID
	for _, u := range state.UserIDs {
		if state.Confirmed[u] {
			confirmed = append(confirmed, u)
		} else {
			nonConfirmed = append(nonConfirmed, u)
		}
	}
	// Загружаем матч, чтобы знать section+mode.
	m, err := uc.Matches.Get(ctx, matchID)
	if err != nil {
		return fmt.Errorf("arena.HandleReadyCheckTimeout: load match: %w", err)
	}
	// Отменяем.
	if err := uc.Matches.UpdateStatus(ctx, matchID, enums.MatchStatusCancelled, nil, &now); err != nil {
		return fmt.Errorf("arena.HandleReadyCheckTimeout: update: %w", err)
	}
	_ = uc.Ready.Clear(ctx, matchID)
	_ = uc.Bus.Publish(ctx, sharedDomain.MatchCancelled{
		MatchID: matchID,
		Reason:  "ready_check_timeout",
	})
	// Возвращаем подтвердивших в очередь с бонусом +5 ELO. Если
	// ListParticipants провалился — не можем восстановить EloBefore;
	// логируем и пропускаем re-queue вместо тихого enqueue с ELO 0
	// (это отравило бы matchmaking).
	parts, listErr := uc.Matches.ListParticipants(ctx, matchID)
	if listErr != nil {
		uc.Log.WarnContext(ctx, "arena.HandleReadyCheckTimeout: ListParticipants",
			slog.Any("err", listErr), slog.String("match_id", matchID.String()))
	} else {
		eloByUser := map[uuid.UUID]int{}
		for _, p := range parts {
			eloByUser[p.UserID] = p.EloBefore
		}
		for _, u := range confirmed {
			if err := uc.Queue.Enqueue(ctx, domain.QueueTicket{
				UserID:     u,
				Section:    m.Section,
				Mode:       m.Mode,
				Elo:        eloByUser[u] + 5,
				EnqueuedAt: now,
			}); err != nil {
				uc.Log.WarnContext(ctx, "arena.HandleReadyCheckTimeout: requeue",
					slog.Any("err", err), slog.String("user_id", u.String()))
			}
		}
	}
	// Anticheat-сигнал на неподтвердивших. NOTE: bible требует
	// AnticheatTabSwitch, если был зафиксирован WS-disconnect. Этот флаг
	// ставит WS-хаб; здесь консервативно поднимаем SuspiciousPattern.
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

// SubmitCode валидирует размер + язык, вызывает Judge0 и по первому
// успешному прохождению объявляет победителя и закрывает матч.
type SubmitCode struct {
	Matches   domain.MatchRepo
	Tasks     domain.TaskRepo
	Judge0    domain.Judge0Client
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
	Clock     domain.Clock
	Log       *slog.Logger
}

// SubmitCodeInput — форма входа.
type SubmitCodeInput struct {
	MatchID  uuid.UUID
	UserID   uuid.UUID
	Code     string
	Language enums.Language
}

// SubmitCodeOutput — результат, возвращаемый синхронно.
type SubmitCodeOutput struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}

// Do прогоняет отправку end-to-end.
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
	// Отправлять могут только участники.
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
	// Проверяем состояние — только active.
	switch m.Status {
	case enums.MatchStatusActive:
		// всё ок
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
	suspicion, sErr := uc.Anticheat.GetSuspicion(ctx, in.MatchID, in.UserID)
	if sErr != nil {
		// Non-fatal: suspicion is metadata persisted alongside the result.
		// Losing it shouldn't block the submission; log and fall back to 0.
		uc.Log.WarnContext(ctx, "arena.SubmitCode: GetSuspicion", slog.Any("err", sErr))
		suspicion = 0
	}
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
			// Побеждает первая успешная отправка. Идемпотентно: SetWinner отрабатывает только один раз.
			if err := uc.Matches.SetWinner(ctx, in.MatchID, in.UserID, now); err != nil {
				// Если строки нет — пробрасываем; иначе считаем, что гонку проиграли.
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
					EloDeltas:  map[uuid.UUID]int{}, // реальную дельту считает rating domain
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

// maybeFinishDuo решает, завершает ли только что прошедшая отправка 2v2-матч.
// 2v2-матч выигрывает первая команда, у которой *обоим* участникам
// проставлен submitted_at в их participant-строке (upsert выше в SubmitCode
// это делает). Если отправил только один из команды — ждём.
//
// Persistence — best-effort идемпотентно: SetWinningTeam обновляет строки
// по `id = $1`, поэтому повторный вызов лишь перепроставит finished_at.
func (uc *SubmitCode) maybeFinishDuo(
	ctx context.Context,
	matchID, justFinishedUser uuid.UUID,
	m domain.Match,
	parts []domain.Participant,
	now time.Time,
) {
	// Строим множество passed: участник считается passed, если у его
	// строки уже есть submitted_at ИЛИ если это только что финишировавший
	// пользователь (его строку upsert'нул SubmitCode выше, но локальный
	// slice `parts` загружен *до* этого upsert'а, так что submitted_at
	// здесь всё ещё может быть nil).
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
	// MatchCompleted требует один WinnerID — для 2v2 публикуем только что
	// финишировавшего пользователя как «капитана-победителя», а обоих
	// членов проигравшей команды кладём в LoserIDs. Rating domain читает
	// participant.team_id напрямую из postgres, чтобы начислить team-level дельты.
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

// GetMatch возвращает связку match+participants.
type GetMatch struct {
	Matches domain.MatchRepo
	Tasks   domain.TaskRepo
	Log     *slog.Logger
}

// MatchView — отрисованная view.
type MatchView struct {
	Match        domain.Match
	Task         *domain.TaskPublic
	Participants []domain.Participant
}

// Do возвращает детальную карточку матча.
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
		t, tErr := uc.Tasks.GetByID(ctx, m.TaskID)
		if tErr == nil {
			v.Task = &t
		} else if uc.Log != nil {
			// Task load is soft-fail: match view is still useful without it,
			// but we must not eat the error silently. Log is nil-guarded
			// because existing wiring may pass nil (unlike other use cases in
			// this file) — callers that care should inject a logger.
			uc.Log.WarnContext(ctx, "arena.GetMatch: Tasks.GetByID",
				slog.Any("err", tErr), slog.String("task_id", m.TaskID.String()))
		}
	}
	return v, nil
}

// OnPasteAttempt накапливает suspicion score на событиях paste. Возвращает
// новый score и флаг срабатывания при пересечении порога High.
type OnPasteAttempt struct {
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
}

// Apply принимает одно событие paste.
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

// OnTabSwitch фиксирует событие переключения вкладки.
type OnTabSwitch struct {
	Anticheat domain.AnticheatRepo
	Bus       sharedDomain.Bus
}

// Apply фиксирует одно событие tab-switch.
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
