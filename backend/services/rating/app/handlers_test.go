// handlers_test.go — фиксирует контракт OnMatchCompleted и OnDailyKataCompleted
// после перехода с absolute-overwrite Upsert на атомарный ApplyDelta.
//
// Ключевой инвариант: хэндлеры больше НЕ должны вызывать Upsert или List —
// любое такое обращение означает регрессию к race-prone пути read-modify-write
// и автоматически провалит тест через gomock.
package app

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"

	"druz9/rating/domain"
	"druz9/rating/domain/mocks"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// stubBus — минимальная in-memory реализация sharedDomain.Bus для тестов.
// Собирает все опубликованные события.
type stubBus struct {
	mu     sync.Mutex
	events []sharedDomain.Event
}

func (b *stubBus) Publish(_ context.Context, e sharedDomain.Event) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, e)
	return nil
}

func (b *stubBus) Subscribe(_ string, _ sharedDomain.Handler) {}

func (b *stubBus) captured() []sharedDomain.Event {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]sharedDomain.Event, len(b.events))
	copy(out, b.events)
	return out
}

func discardLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// TestOnMatchCompleted_CallsApplyDelta проверяет, что каждому участнику
// матча хэндлер делает ровно один ApplyDelta c правильным EloDelta. List и
// Upsert не вызываются (это защита от регресса к race-prone пути).
func TestOnMatchCompleted_CallsApplyDelta(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)

	winner := uuid.New()
	loser := uuid.New()
	matchID := uuid.New()
	section := enums.SectionGo

	// Ожидаем ApplyDelta для победителя (+16) и проигравшего (-16).
	// Возвращаем новые ELO так, чтобы oldElo = newElo - delta был осмысленным.
	repo.EXPECT().
		ApplyDelta(gomock.Any(), gomock.AssignableToTypeOf(domain.RatingDelta{})).
		DoAndReturn(func(_ context.Context, d domain.RatingDelta) (int, error) {
			if d.Section != section {
				t.Errorf("wrong section: got %q want %q", d.Section, section)
			}
			switch d.UserID {
			case winner:
				if d.EloDelta != 16 {
					t.Errorf("winner delta: got %d want 16", d.EloDelta)
				}
				return 1016, nil
			case loser:
				if d.EloDelta != -16 {
					t.Errorf("loser delta: got %d want -16", d.EloDelta)
				}
				return 984, nil
			default:
				t.Errorf("unexpected user %s", d.UserID)
				return 0, nil
			}
		}).
		Times(2)

	bus := &stubBus{}
	h := &OnMatchCompleted{Ratings: repo, Bus: bus, Log: discardLog()}

	ev := sharedDomain.MatchCompleted{
		MatchID:  matchID,
		Section:  section,
		WinnerID: winner,
		LoserIDs: []uuid.UUID{loser},
		EloDeltas: map[uuid.UUID]int{
			winner: 16,
			loser:  -16,
		},
	}
	if err := h.Handle(context.Background(), ev); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := bus.captured()
	if len(got) != 2 {
		t.Fatalf("expected 2 RatingChanged events, got %d", len(got))
	}
	for _, e := range got {
		rc, ok := e.(sharedDomain.RatingChanged)
		if !ok {
			t.Fatalf("unexpected event %T", e)
		}
		// Проверяем, что oldElo реконструирован корректно как newElo - delta.
		switch rc.UserID {
		case winner:
			if rc.EloNew != 1016 || rc.EloOld != 1000 {
				t.Errorf("winner: old=%d new=%d, want 1000/1016", rc.EloOld, rc.EloNew)
			}
		case loser:
			if rc.EloNew != 984 || rc.EloOld != 1000 {
				t.Errorf("loser: old=%d new=%d, want 1000/984", rc.EloOld, rc.EloNew)
			}
		}
		if rc.MatchID == nil || *rc.MatchID != matchID {
			t.Errorf("match_id not propagated")
		}
		if rc.Source != "arena" {
			t.Errorf("source: got %q want arena", rc.Source)
		}
	}
}

// TestOnDailyKataCompleted_CallsApplyDelta — аналог для DailyKata.
func TestOnDailyKataCompleted_CallsApplyDelta(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)

	uid := uuid.New()

	repo.EXPECT().
		ApplyDelta(gomock.Any(), gomock.AssignableToTypeOf(domain.RatingDelta{})).
		DoAndReturn(func(_ context.Context, d domain.RatingDelta) (int, error) {
			if d.UserID != uid {
				t.Errorf("user: got %s want %s", d.UserID, uid)
			}
			if d.EloDelta != 4 {
				t.Errorf("kata delta: got %d want 4", d.EloDelta)
			}
			if d.Section != enums.SectionAlgorithms {
				t.Errorf("section: got %q want algorithms", d.Section)
			}
			return 1004, nil
		}).
		Times(1)

	bus := &stubBus{}
	h := &OnDailyKataCompleted{Ratings: repo, Bus: bus, Log: discardLog()}

	if err := h.Handle(context.Background(), sharedDomain.DailyKataCompleted{
		UserID: uid,
		TaskID: uuid.New(),
	}); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := bus.captured()
	if len(got) != 1 {
		t.Fatalf("expected 1 RatingChanged, got %d", len(got))
	}
	rc, ok := got[0].(sharedDomain.RatingChanged)
	if !ok {
		t.Fatalf("unexpected event %T", got[0])
	}
	if rc.Source != "kata" {
		t.Errorf("source: got %q want kata", rc.Source)
	}
	if rc.MatchID != nil {
		t.Errorf("match_id should be nil for kata")
	}
}
