package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"druz9/season/domain"

	"github.com/google/uuid"
)

// memClaimStore — тестовая реализация того же контракта, что
// ClaimStore (Postgres). Поведение по идемпотентности должно быть
// идентично: повторный MarkClaimed возвращает ErrAlreadyClaimed,
// параллельные вызовы детерминированно отдают ровно один успех.

func TestMemClaimStore_Idempotent(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := NewMemClaimStore()
	u, s := uuid.New(), uuid.New()

	if err := st.MarkClaimed(ctx, u, s, domain.TrackFree, 1); err != nil {
		t.Fatalf("first claim must succeed, got %v", err)
	}
	err := st.MarkClaimed(ctx, u, s, domain.TrackFree, 1)
	if !errors.Is(err, domain.ErrAlreadyClaimed) {
		t.Fatalf("second claim must wrap ErrAlreadyClaimed, got %v", err)
	}

	state, err := st.Get(ctx, u, s)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !state.FreeClaimed[1] {
		t.Fatalf("state.FreeClaimed[1] must be true")
	}
}

func TestMemClaimStore_InvalidTrack(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := NewMemClaimStore()
	err := st.MarkClaimed(ctx, uuid.New(), uuid.New(), domain.TrackKind("bogus"), 1)
	if err == nil {
		t.Fatal("expected error for invalid track")
	}
}

// Контракт: из N параллельных MarkClaimed на одну и ту же
// (user, season, kind, tier) ровно один успех, остальные —
// ErrAlreadyClaimed. Это то, что даст Postgres через UNIQUE +
// ON CONFLICT; memClaimStore эмулирует то же под mutex'ом.
func TestMemClaimStore_ConcurrentSingleWinner(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	st := NewMemClaimStore()
	u, s := uuid.New(), uuid.New()

	const N = 32
	var wg sync.WaitGroup
	wg.Add(N)

	var successes int32
	var alreadyClaimed int32

	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			err := st.MarkClaimed(ctx, u, s, domain.TrackFree, 1)
			switch {
			case err == nil:
				atomic.AddInt32(&successes, 1)
			case errors.Is(err, domain.ErrAlreadyClaimed):
				atomic.AddInt32(&alreadyClaimed, 1)
			default:
				t.Errorf("unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Fatalf("want exactly 1 successful claim, got %d", successes)
	}
	if alreadyClaimed != N-1 {
		t.Fatalf("want %d ErrAlreadyClaimed, got %d", N-1, alreadyClaimed)
	}
}
