// Tests for the 2v2 dispatcher path inside Matchmaker.Tick.
// Exercises the integration between Snapshot → PickQuads → CreateMatch +
// ReadyCheck.Start. Uses the MatchRepo / QueueRepo / TaskRepo mocks plus
// in-memory ReadyCheck and a no-op Bus.
package app

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── small in-memory collaborators ─────────────────────────────────────────

// stubReadyRepo records Start calls but otherwise no-ops.
type stubReadyRepo struct {
	mu     sync.Mutex
	starts []readyStart
}

type readyStart struct {
	matchID  uuid.UUID
	users    []uuid.UUID
	deadline time.Time
}

func (s *stubReadyRepo) Start(_ context.Context, matchID uuid.UUID, users []uuid.UUID, deadline time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.starts = append(s.starts, readyStart{matchID, users, deadline})
	return nil
}
func (s *stubReadyRepo) Confirm(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	return false, nil
}
func (s *stubReadyRepo) Get(context.Context, uuid.UUID) (domain.ReadyCheckState, bool, error) {
	return domain.ReadyCheckState{}, false, nil
}
func (s *stubReadyRepo) Clear(context.Context, uuid.UUID) error { return nil }

// noopBus discards published events.
type noopBus struct{}

func (noopBus) Publish(context.Context, sharedDomain.Event) error { return nil }
func (noopBus) Subscribe(string, sharedDomain.Handler)            {}

// stubNotifier counts NotifyMatched calls per user.
type stubNotifier struct {
	mu      sync.Mutex
	matched map[uuid.UUID]uuid.UUID
}

func newStubNotifier() *stubNotifier {
	return &stubNotifier{matched: map[uuid.UUID]uuid.UUID{}}
}
func (s *stubNotifier) NotifyMatched(_ context.Context, userID, matchID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.matched[userID] = matchID
}

// silent slog logger.
func discardLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(nopWriter{}, nil))
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }

// ── helpers ───────────────────────────────────────────────────────────────

// duoSweep returns a single SweepKey for algorithms+duo_2v2 and configures
// the matchmaker to only sweep that pair (so test mocks are deterministic).
func duoSweep() []SweepKey {
	return []SweepKey{{Section: enums.SectionAlgorithms, Mode: enums.ArenaModeDuo2v2}}
}

func ticketAt(elo int, t time.Time) domain.QueueTicket {
	return domain.QueueTicket{
		UserID:     uuid.New(),
		Section:    enums.SectionAlgorithms,
		Mode:       enums.ArenaModeDuo2v2,
		Elo:        elo,
		EnqueuedAt: t,
	}
}

// ── tests ─────────────────────────────────────────────────────────────────

func TestMatchmaker_Duo_FourPlayersCreatesOneMatch(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []domain.QueueTicket{
		ticketAt(1500, now), ticketAt(1500, now),
		ticketAt(1500, now), ticketAt(1500, now),
	}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)
	q.EXPECT().AcquireLock(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(true, nil).Times(4)
	q.EXPECT().Remove(gomock.Any(), gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(nil).Times(4)

	taskID := uuid.New()
	tr.EXPECT().PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: taskID, Version: 1, Section: enums.SectionAlgorithms}, nil)

	matchID := uuid.New()
	mr.EXPECT().CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.Match, parts []domain.Participant) (domain.Match, error) {
			if m.Mode != enums.ArenaModeDuo2v2 {
				t.Fatalf("expected mode duo_2v2, got %s", m.Mode)
			}
			if len(parts) != domain.DuoMatchSize {
				t.Fatalf("want %d participants, got %d", domain.DuoMatchSize, len(parts))
			}
			t1, t2 := 0, 0
			for _, p := range parts {
				switch p.Team {
				case domain.Team1:
					t1++
				case domain.Team2:
					t2++
				}
			}
			if t1 != domain.DuoTeamSize || t2 != domain.DuoTeamSize {
				t.Fatalf("want %d/%d split, got %d/%d", domain.DuoTeamSize, domain.DuoTeamSize, t1, t2)
			}
			m.ID = matchID
			return m, nil
		})

	rdy := &stubReadyRepo{}
	notif := newStubNotifier()
	mm := &Matchmaker{
		Queue: q, Ready: rdy, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: notif, Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}

	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if len(rdy.starts) != 1 {
		t.Fatalf("ready-check Start should fire once, got %d", len(rdy.starts))
	}
	if len(rdy.starts[0].users) != domain.DuoMatchSize {
		t.Fatalf("ready-check should include all 4 players, got %d", len(rdy.starts[0].users))
	}
	if len(notif.matched) != domain.DuoMatchSize {
		t.Fatalf("notifier should fire for all 4, got %d", len(notif.matched))
	}
}

func TestMatchmaker_Duo_ThreePlayersDoesNothing(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []domain.QueueTicket{
		ticketAt(1500, now), ticketAt(1500, now), ticketAt(1500, now),
	}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)
	// No AcquireLock / CreateMatch / Tasks.PickBy* expected — gomock will fail
	// the test if those are called.

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}
	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}

func TestMatchmaker_Duo_ExpiredTicketsAreCancelled(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	base := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	now := base.Add(domain.DuoQueueTimeout + time.Second)
	expiredA := ticketAt(1500, base)
	expiredB := ticketAt(1600, base)
	tickets := []domain.QueueTicket{expiredA, expiredB}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)
	q.EXPECT().Remove(gomock.Any(), expiredA.UserID, enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(nil)
	q.EXPECT().Remove(gomock.Any(), expiredB.UserID, enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(nil)

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}
	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}

func TestMatchmaker_Duo_LockContentionAbortsAndReleases(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []domain.QueueTicket{
		ticketAt(1500, now), ticketAt(1500, now),
		ticketAt(1500, now), ticketAt(1500, now),
	}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)

	// Stateful AcquireLock: succeed for the first 3 distinct users, fail
	// for the 4th. Order of UUID iteration in createMatchFromQuad is fixed
	// (from uids array) but the underlying tickets shuffle, so we count
	// instead of binding to specific IDs.
	var acquireCount int
	q.EXPECT().AcquireLock(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ time.Duration) (bool, error) {
			acquireCount++
			return acquireCount <= 3, nil
		}).Times(4)
	q.EXPECT().ReleaseLock(gomock.Any(), gomock.Any()).Return(nil).Times(3)
	// No Tasks.Pick* / CreateMatch / Remove expected — abort path.

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}
	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}

func TestMatchmaker_Duo_EightPlayersFormsTwoMatches(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := make([]domain.QueueTicket, 0, 8)
	for i := 0; i < 8; i++ {
		tickets = append(tickets, ticketAt(1000+i*5, now))
	}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)
	q.EXPECT().AcquireLock(gomock.Any(), gomock.Any(), gomock.Any()).Return(true, nil).Times(8)
	q.EXPECT().Remove(gomock.Any(), gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(nil).Times(8)
	tr.EXPECT().PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: uuid.New(), Version: 1, Section: enums.SectionAlgorithms}, nil).Times(2)

	createCount := 0
	mr.EXPECT().CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.Match, _ []domain.Participant) (domain.Match, error) {
			createCount++
			m.ID = uuid.New()
			return m, nil
		}).Times(2)

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}
	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if createCount != 2 {
		t.Fatalf("want 2 CreateMatch calls, got %d", createCount)
	}
}

func TestMatchmaker_Duo_WideSpreadStillCreatesMatch(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	// Spread 1500 — exceeds DuoEloSpreadCap (600) but match still goes through;
	// the dispatcher only logs a wideMatch warning.
	tickets := []domain.QueueTicket{
		ticketAt(800, now),
		ticketAt(900, now),
		ticketAt(2200, now),
		ticketAt(2300, now),
	}
	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(tickets, nil)
	q.EXPECT().AcquireLock(gomock.Any(), gomock.Any(), gomock.Any()).Return(true, nil).Times(4)
	q.EXPECT().Remove(gomock.Any(), gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeDuo2v2).
		Return(nil).Times(4)
	tr.EXPECT().PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: uuid.New(), Version: 1, Section: enums.SectionAlgorithms}, nil)
	mr.EXPECT().CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.Match, _ []domain.Participant) (domain.Match, error) {
			m.ID = uuid.New()
			return m, nil
		})

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: duoSweep(),
	}
	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}
