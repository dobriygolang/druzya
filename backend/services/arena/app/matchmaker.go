// Package app содержит use-case'ы arena и диспетчер matchmaker.
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

// LockTTL — Redis-лок на user_id на время фиксации игрока в только что
// созданный матч. Делаем коротким, чтобы упавший диспетчер не «застревал» на пользователе.
const LockTTL = 15 * time.Second

// TickInterval — как часто диспетчер просыпается, чтобы пройти по очередям.
const TickInterval = 2 * time.Second

// MatchNotifier — хук, через который matchmaker уведомляет WS-слой о
// том, что для пользователя создан матч. Реализуется WS-хабом.
type MatchNotifier interface {
	NotifyMatched(ctx context.Context, userID uuid.UUID, matchID uuid.UUID)
}

// Matchmaker крутит цикл диспетчера.
type Matchmaker struct {
	Queue    domain.QueueRepo
	Ready    domain.ReadyCheckRepo
	Matches  domain.MatchRepo
	Tasks    domain.TaskRepo
	Bus      sharedDomain.Bus
	Notifier MatchNotifier
	Clock    domain.Clock
	Log      *slog.Logger

	// Секции и режимы, которые проходим на каждом tick. По умолчанию — все секции × Solo1v1.
	SweepPairs []SweepKey
}

// SweepKey описывает одну очередь для сканирования на каждом tick.
type SweepKey struct {
	Section enums.Section
	Mode    enums.ArenaMode
}

// NewMatchmaker собирает matchmaker с дефолтным набором sweep'ов (все
// секции × все режимы, включая duo_2v2 с Phase 5).
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
			enums.ArenaModeDuo2v2,
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

// Start запускает goroutine диспетчера и возвращает функцию stop.
// Возвращаемая stop идемпотентна.
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

// Tick проходит по каждой сконфигурированной паре (section, mode),
// набирает пары (1v1) или четвёрки (2v2), локает участников и создаёт матчи.
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
		if sk.Mode == enums.ArenaModeDuo2v2 {
			mm.tickDuo(ctx, sk, tickets, now)
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

// tickDuo обрабатывает очередь duo_2v2 для одной секции: чистит
// просроченные тикеты, затем формирует сбалансированные четвёрки и
// создаёт 2v2-матчи.
func (mm *Matchmaker) tickDuo(ctx context.Context, sk SweepKey, tickets []domain.QueueTicket, now time.Time) {
	// Удаляем тикеты, ждавшие дольше DuoQueueTimeout. Делаем это
	// best-effort в Redis, чтобы номера позиций оставались корректными
	// для оставшихся.
	for _, t := range tickets {
		if domain.IsDuoTicketExpired(t, now) {
			if err := mm.Queue.Remove(ctx, t.UserID, sk.Section, sk.Mode); err != nil {
				mm.Log.WarnContext(ctx, "arena.matchmaker.duo.cancelStale", slog.Any("err", err))
			}
		}
	}
	if len(tickets) < domain.DuoMatchSize {
		return
	}
	quads := domain.PickQuads(tickets, now)
	for _, q := range quads {
		if q.EloSpread() > domain.DuoEloSpreadCap {
			mm.Log.InfoContext(ctx, "arena.matchmaker.duo.wideMatch",
				slog.Int("spread", q.EloSpread()),
				slog.String("section", string(sk.Section)),
			)
		}
		if err := mm.createMatchFromQuad(ctx, sk, q, now); err != nil {
			mm.Log.WarnContext(ctx, "arena.matchmaker.duo.createMatch", slog.Any("err", err))
		}
	}
}

// createMatchFromQuad локает всех четверых, выбирает таск, сохраняет
// матч (team_id назначается балансировкой) и запускает ready-check.
func (mm *Matchmaker) createMatchFromQuad(ctx context.Context, sk SweepKey, q domain.Quad, now time.Time) error {
	// Берём локи; отпускаем уже взятые, если следующий не сработает или
	// уже занят. Порядок — по байтовому порядку UserID, чтобы снизить
	// риск deadlock между конкурирующими диспетчерами.
	uids := [domain.DuoMatchSize]uuid.UUID{
		q.Players[0].UserID, q.Players[1].UserID,
		q.Players[2].UserID, q.Players[3].UserID,
	}
	acquired := make([]uuid.UUID, 0, domain.DuoMatchSize)
	releaseAll := func() {
		for _, id := range acquired {
			_ = mm.Queue.ReleaseLock(ctx, id)
		}
	}
	for _, id := range uids {
		ok, err := mm.Queue.AcquireLock(ctx, id, LockTTL)
		if err != nil {
			releaseAll()
			return fmt.Errorf("arena.duo.createMatch: lock %s: %w", id, err)
		}
		if !ok {
			releaseAll()
			return nil // игрока уже перехватил кто-то другой; попробуем на следующем tick.
		}
		acquired = append(acquired, id)
	}

	diff := domain.DifficultyForEloBand(q.MeanElo())
	task, err := mm.Tasks.PickBySectionDifficulty(ctx, sk.Section, diff)
	if err != nil {
		releaseAll()
		return fmt.Errorf("arena.duo.createMatch: pick task: %w", err)
	}

	m := domain.Match{
		TaskID:      task.ID,
		TaskVersion: task.Version,
		Section:     sk.Section,
		Mode:        sk.Mode,
		Status:      enums.MatchStatusConfirming,
	}
	parts := []domain.Participant{
		{UserID: q.Players[0].UserID, Team: domain.Team1, EloBefore: q.Players[0].Elo},
		{UserID: q.Players[1].UserID, Team: domain.Team1, EloBefore: q.Players[1].Elo},
		{UserID: q.Players[2].UserID, Team: domain.Team2, EloBefore: q.Players[2].Elo},
		{UserID: q.Players[3].UserID, Team: domain.Team2, EloBefore: q.Players[3].Elo},
	}
	created, err := mm.Matches.CreateMatch(ctx, m, parts)
	if err != nil {
		releaseAll()
		return fmt.Errorf("arena.duo.createMatch: persist: %w", err)
	}

	for _, id := range uids {
		_ = mm.Queue.Remove(ctx, id, sk.Section, sk.Mode)
	}

	deadline := domain.ReadyCheckDeadline(now)
	if err := mm.Ready.Start(ctx, created.ID, uids[:], deadline); err != nil {
		mm.Log.WarnContext(ctx, "arena.duo.createMatch: readycheck.Start", slog.Any("err", err))
	}

	if err := mm.Bus.Publish(ctx, sharedDomain.MatchStarted{
		MatchID: created.ID,
		Section: sk.Section,
		Players: uids[:],
		TaskID:  task.ID,
		TaskVer: task.Version,
	}); err != nil {
		mm.Log.WarnContext(ctx, "arena.duo.createMatch: publish MatchStarted", slog.Any("err", err))
	}

	if mm.Notifier != nil {
		for _, id := range uids {
			mm.Notifier.NotifyMatched(ctx, id, created.ID)
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

	// Выбираем таск — сложность по среднему ELO-бэнду.
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

	// Удаляем обоих из очереди.
	_ = mm.Queue.Remove(ctx, p.A.UserID, sk.Section, sk.Mode)
	_ = mm.Queue.Remove(ctx, p.B.UserID, sk.Section, sk.Mode)

	// Запускаем ready-check.
	deadline := domain.ReadyCheckDeadline(now)
	if err := mm.Ready.Start(ctx, created.ID, []uuid.UUID{p.A.UserID, p.B.UserID}, deadline); err != nil {
		mm.Log.WarnContext(ctx, "arena.createMatch: readycheck.Start", slog.Any("err", err))
	}

	// Публикуем событие. NOTE: встроенный `base` у MatchStarted в
	// shared/events.go неэкспортируем, поэтому OccurredAt() снаружи shared
	// возвращает нулевое время. Downstream-обработчики (rating, notify)
	// читают только экспортированные поля — для MVP это функционально ок;
	// когда domain'у реально понадобится wall-clock OccurredAt, в
	// shared/events.go надо выставить конструктор.
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

// EnqueueInput — запрос matchmaker'у поставить пользователя в очередь.
type EnqueueInput struct {
	UserID  uuid.UUID
	Elo     int
	Section enums.Section
	Mode    enums.ArenaMode
}

// FindMatch ставит пользователя в очередь (или возвращает, что он уже в матче).
type FindMatch struct {
	Queue domain.QueueRepo
	Clock domain.Clock
}

// FindMatchOutput — форма ответа.
type FindMatchOutput struct {
	Status        string // "queued" | "matched"
	QueuePosition int
	EstWaitSec    int
	MatchID       *uuid.UUID
}

// Do ставит в очередь и возвращает текущее состояние.
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
	// 5с на каждого впереди — грубая MVP-оценка (bible §3.4 допускает эту эвристику).
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

// CancelSearch удаляет пользователя из всех очередей.
type CancelSearch struct {
	Queue domain.QueueRepo
}

// Do удаляет тикет пользователя.
func (uc *CancelSearch) Do(ctx context.Context, userID uuid.UUID) error {
	// Здесь не знаем section/mode — Remove идемпотентна и откатывается на
	// сохранённый индекс.
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
