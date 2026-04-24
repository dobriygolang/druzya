package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── reconciler-specific fake ──────────────────────────────────────────────

type reconcilerStreakRepo struct {
	mu           sync.Mutex
	drift        []domain.DriftRow
	driftErr     error
	recomputeErr error
	recomputed   []struct {
		userID            uuid.UUID
		day               time.Time
		secs, sess, thres int
	}
}

func (r *reconcilerStreakRepo) GetState(context.Context, uuid.UUID) (domain.StreakState, error) {
	return domain.StreakState{}, nil
}
func (r *reconcilerStreakRepo) ApplyFocusSession(context.Context, uuid.UUID, time.Time, int, int, int) (domain.StreakState, error) {
	return domain.StreakState{}, nil
}
func (r *reconcilerStreakRepo) RangeDays(context.Context, uuid.UUID, time.Time, time.Time) ([]domain.StreakDay, error) {
	return nil, nil
}
func (r *reconcilerStreakRepo) FindDrift(_ context.Context, _ time.Duration) ([]domain.DriftRow, error) {
	return r.drift, r.driftErr
}
func (r *reconcilerStreakRepo) RecomputeDay(_ context.Context, u uuid.UUID, day time.Time, secs, sess, thres int) (domain.StreakState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recomputed = append(r.recomputed, struct {
		userID            uuid.UUID
		day               time.Time
		secs, sess, thres int
	}{u, day, secs, sess, thres})
	return domain.StreakState{}, r.recomputeErr
}

// ─── tests ─────────────────────────────────────────────────────────────────

func TestStreakReconciler_NoDrift_NoRecompute(t *testing.T) {
	t.Parallel()
	repo := &reconcilerStreakRepo{}
	rec := &StreakReconciler{Streaks: repo, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec.runOnce(context.Background(), 48*time.Hour, MinQualifyingFocusSeconds)
	if len(repo.recomputed) != 0 {
		t.Errorf("expected 0 recomputes, got %d", len(repo.recomputed))
	}
}

func TestStreakReconciler_RecomputesEachDriftRow(t *testing.T) {
	t.Parallel()
	u1, u2 := uuid.New(), uuid.New()
	d := time.Date(2026, 4, 24, 0, 0, 0, 0, time.UTC)
	repo := &reconcilerStreakRepo{
		drift: []domain.DriftRow{
			{UserID: u1, Day: d, ActualSeconds: 900, ActualSessions: 2, StoredDayExists: false},
			{UserID: u2, Day: d, ActualSeconds: 300, ActualSessions: 1, StoredSeconds: 100, StoredSessions: 1, StoredDayExists: true},
		},
	}
	rec := &StreakReconciler{Streaks: repo, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec.runOnce(context.Background(), 48*time.Hour, 600)

	if len(repo.recomputed) != 2 {
		t.Fatalf("expected 2 recomputes, got %d", len(repo.recomputed))
	}
	if repo.recomputed[0].secs != 900 || repo.recomputed[0].sess != 2 || repo.recomputed[0].thres != 600 {
		t.Errorf("first recompute args wrong: %+v", repo.recomputed[0])
	}
}

func TestStreakReconciler_FindDriftError_Skips(t *testing.T) {
	t.Parallel()
	repo := &reconcilerStreakRepo{driftErr: errors.New("db down")}
	rec := &StreakReconciler{Streaks: repo, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	// Не должен паниковать / не должен что-либо пересчитывать.
	rec.runOnce(context.Background(), 48*time.Hour, MinQualifyingFocusSeconds)
	if len(repo.recomputed) != 0 {
		t.Errorf("expected no recomputes on FindDrift error, got %d", len(repo.recomputed))
	}
}

func TestStreakReconciler_RecomputeError_ContinuesOtherRows(t *testing.T) {
	t.Parallel()
	u1, u2 := uuid.New(), uuid.New()
	d := time.Date(2026, 4, 24, 0, 0, 0, 0, time.UTC)
	repo := &reconcilerStreakRepo{
		drift: []domain.DriftRow{
			{UserID: u1, Day: d, ActualSeconds: 900, ActualSessions: 2},
			{UserID: u2, Day: d, ActualSeconds: 300, ActualSessions: 1},
		},
		recomputeErr: errors.New("tx aborted"),
	}
	rec := &StreakReconciler{Streaks: repo, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec.runOnce(context.Background(), 48*time.Hour, 600)

	// Even on error, loop continues — both rows attempted.
	if len(repo.recomputed) != 2 {
		t.Errorf("expected 2 attempted recomputes despite errors, got %d", len(repo.recomputed))
	}
}
