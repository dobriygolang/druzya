// Phase 4.5 — weekly memory consolidation tests.
package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// fakeConsolidateRepo — minimal repo для consolidator. Поля настраиваются
// per-test, остальные методы возвращают zero-values.
type fakeConsolidateRepo struct {
	hasSummary     bool
	hasSummaryErr  error
	counts         map[domain.EpisodeKind]int
	countsErr      error
	appended       []domain.Episode
	appendErr      error
	probeWeekStart time.Time // что приходило в HasWeeklySummary
}

func (r *fakeConsolidateRepo) Append(_ context.Context, e domain.Episode) error {
	if r.appendErr != nil {
		return r.appendErr
	}
	r.appended = append(r.appended, e)
	return nil
}

func (r *fakeConsolidateRepo) LatestByKind(context.Context, uuid.UUID, domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) LatestByKinds(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) LatestPerKind(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) SearchSimilar(context.Context, uuid.UUID, []float32, string, []domain.EpisodeKind, int) ([]domain.EpisodeWithScore, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) PendingEmbeddings(context.Context, int) ([]domain.Episode, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) MarkStaleForReembed(context.Context, string) (int64, error) {
	return 0, nil
}
func (r *fakeConsolidateRepo) SetEmbedding(context.Context, uuid.UUID, []float32, string) error {
	return nil
}
func (r *fakeConsolidateRepo) Stats30d(context.Context, uuid.UUID) (domain.MemoryStats, error) {
	return domain.MemoryStats{}, nil
}
func (r *fakeConsolidateRepo) GetBriefRecommendations(context.Context, uuid.UUID, uuid.UUID) ([]domain.Recommendation, error) {
	return nil, nil
}
func (r *fakeConsolidateRepo) DeleteOlderThan(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func (r *fakeConsolidateRepo) CountByKindInRange(_ context.Context, _ uuid.UUID, _, _ time.Time) (map[domain.EpisodeKind]int, error) {
	if r.countsErr != nil {
		return nil, r.countsErr
	}
	return r.counts, nil
}

func (r *fakeConsolidateRepo) HasWeeklySummary(_ context.Context, _ uuid.UUID, weekStart time.Time) (bool, error) {
	r.probeWeekStart = weekStart
	if r.hasSummaryErr != nil {
		return false, r.hasSummaryErr
	}
	return r.hasSummary, nil
}

func newConsolidator(repo *fakeConsolidateRepo) *ConsolidateWeeklyMemory {
	mem := &Memory{
		Episodes: repo,
		Now:      func() time.Time { return time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC) },
	}
	return &ConsolidateWeeklyMemory{
		Episodes: repo,
		Memory:   mem,
		Now:      mem.Now,
	}
}

// ── tests ────────────────────────────────────────────────────────────────

func TestConsolidate_WritesSummaryEpisodeWithCounts(t *testing.T) {
	repo := &fakeConsolidateRepo{
		counts: map[domain.EpisodeKind]int{
			domain.EpisodeBriefEmitted:         5,
			domain.EpisodeBriefFollowed:        2,
			domain.EpisodeBriefDismissed:       1,
			domain.EpisodeMockPipelineFinished: 4,
		},
	}
	uc := newConsolidator(repo)
	weekStart := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC) // Monday
	out, err := uc.Do(context.Background(), ConsolidateInput{
		UserID:    uuid.New(),
		WeekStart: weekStart,
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Skipped {
		t.Fatalf("expected NOT skipped, got skipped")
	}
	if out.EpisodesCount != 12 {
		t.Fatalf("expected total 12, got %d", out.EpisodesCount)
	}
	if !strings.Contains(out.Summary, "Week of 2026-04-20") {
		t.Fatalf("summary missing week tag: %q", out.Summary)
	}
	if !strings.Contains(out.Summary, "brief_emitted=5") {
		t.Fatalf("summary missing top kind: %q", out.Summary)
	}
	if len(repo.appended) != 1 {
		t.Fatalf("expected 1 appended episode, got %d", len(repo.appended))
	}
	if repo.appended[0].Kind != domain.EpisodeWeeklyMemorySummary {
		t.Fatalf("kind mismatch: %q", repo.appended[0].Kind)
	}
}

func TestConsolidate_SkipsWhenAlreadyConsolidated(t *testing.T) {
	repo := &fakeConsolidateRepo{
		hasSummary: true,
		counts: map[domain.EpisodeKind]int{
			domain.EpisodeBriefEmitted: 5,
		},
	}
	uc := newConsolidator(repo)
	weekStart := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	out, err := uc.Do(context.Background(), ConsolidateInput{
		UserID:    uuid.New(),
		WeekStart: weekStart,
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !out.Skipped {
		t.Fatalf("expected skipped on existing summary")
	}
	if len(repo.appended) != 0 {
		t.Fatalf("expected zero appends on skip, got %d", len(repo.appended))
	}
}

func TestConsolidate_SkipsWhenZeroEpisodes(t *testing.T) {
	repo := &fakeConsolidateRepo{
		counts: map[domain.EpisodeKind]int{},
	}
	uc := newConsolidator(repo)
	out, err := uc.Do(context.Background(), ConsolidateInput{
		UserID:    uuid.New(),
		WeekStart: time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !out.Skipped {
		t.Fatalf("expected skipped on empty week")
	}
	if len(repo.appended) != 0 {
		t.Fatalf("expected no append on empty week")
	}
}

func TestConsolidate_WeekStartTruncatedToDay(t *testing.T) {
	// При передаче weekStart с временем (12:34) consolidator должен
	// truncate до 00:00 UTC, чтобы probe и payload key совпадали.
	repo := &fakeConsolidateRepo{
		counts: map[domain.EpisodeKind]int{domain.EpisodeBriefEmitted: 1},
	}
	uc := newConsolidator(repo)
	weekStart := time.Date(2026, 4, 20, 12, 34, 56, 0, time.UTC)
	if _, err := uc.Do(context.Background(), ConsolidateInput{
		UserID:    uuid.New(),
		WeekStart: weekStart,
	}); err != nil {
		t.Fatalf("Do: %v", err)
	}
	wantStart := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	if !repo.probeWeekStart.Equal(wantStart) {
		t.Fatalf("week_start probe mismatch: got %v want %v", repo.probeWeekStart, wantStart)
	}
}

func TestConsolidate_ReturnsErrorOnAppendFailure(t *testing.T) {
	repo := &fakeConsolidateRepo{
		counts:    map[domain.EpisodeKind]int{domain.EpisodeBriefEmitted: 1},
		appendErr: errors.New("db down"),
	}
	uc := newConsolidator(repo)
	if _, err := uc.Do(context.Background(), ConsolidateInput{
		UserID:    uuid.New(),
		WeekStart: time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC),
	}); err == nil {
		t.Fatalf("expected error on append failure, got nil")
	}
}
