// Tests for the 1v1 dispatcher path inside Matchmaker.Tick.
//
// Проверяем главное инвариант-свойство createMatchFromPair: участники
// уезжают в репозиторий с Team = domain.Team1 и domain.Team2, а не с
// хардкод-0/1. Это закрывает регресс, где первый игрок получал Team=0
// (коллизия с «нет команды»), а второй — Team=1 (коллизия с Team1 2v2).
package app

import (
	"context"
	"testing"
	"time"

	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// soloSweep — единственная пара (section, mode) для solo_1v1, чтобы тесту
// хватило одного набора mock-expectations.
func soloSweep() []SweepKey {
	return []SweepKey{{Section: enums.SectionAlgorithms, Mode: enums.ArenaModeSolo1v1}}
}

func soloTicket(elo int, t time.Time) domain.QueueTicket {
	return domain.QueueTicket{
		UserID:     uuid.New(),
		Section:    enums.SectionAlgorithms,
		Mode:       enums.ArenaModeSolo1v1,
		Elo:        elo,
		EnqueuedAt: t,
	}
}

// TestMatchmaker_Solo_ParticipantsGetTeamEnumConstants — проверяем, что на
// сохранение в репо летит Team1/Team2, а не «0/1». Если кто-то вернёт старый
// хардкод — тест упадёт.
func TestMatchmaker_Solo_ParticipantsGetTeamEnumConstants(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	q := mocks.NewMockQueueRepo(ctrl)
	mr := mocks.NewMockMatchRepo(ctrl)
	tr := mocks.NewMockTaskRepo(ctrl)

	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	tickets := []domain.QueueTicket{soloTicket(1500, now), soloTicket(1510, now)}

	q.EXPECT().Snapshot(gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeSolo1v1).
		Return(tickets, nil)
	q.EXPECT().AcquireLock(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(true, nil).Times(2)
	q.EXPECT().Remove(gomock.Any(), gomock.Any(), enums.SectionAlgorithms, enums.ArenaModeSolo1v1).
		Return(nil).Times(2)

	taskID := uuid.New()
	tr.EXPECT().PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: taskID, Version: 1, Section: enums.SectionAlgorithms}, nil)

	matchID := uuid.New()
	mr.EXPECT().CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.Match, parts []domain.Participant) (domain.Match, error) {
			if m.Mode != enums.ArenaModeSolo1v1 {
				t.Fatalf("expected mode solo_1v1, got %s", m.Mode)
			}
			if len(parts) != 2 {
				t.Fatalf("want 2 participants, got %d", len(parts))
			}
			if parts[0].Team != domain.Team1 {
				t.Fatalf("parts[0].Team=%d, want domain.Team1 (%d)", parts[0].Team, domain.Team1)
			}
			if parts[1].Team != domain.Team2 {
				t.Fatalf("parts[1].Team=%d, want domain.Team2 (%d)", parts[1].Team, domain.Team2)
			}
			m.ID = matchID
			return m, nil
		})

	mm := &Matchmaker{
		Queue: q, Ready: &stubReadyRepo{}, Matches: mr, Tasks: tr,
		Bus: noopBus{}, Notifier: newStubNotifier(), Clock: domain.RealClock{},
		Log:        discardLog(),
		SweepPairs: soloSweep(),
	}

	if err := mm.Tick(context.Background(), now); err != nil {
		t.Fatal(err)
	}
}
