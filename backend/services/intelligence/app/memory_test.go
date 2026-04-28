package app

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

func TestMemoryRecallKeepsSemanticHitsBeforeRecentTail(t *testing.T) {
	now := time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC)
	userID := uuid.New()
	semanticOld := domain.Episode{
		ID:         uuid.New(),
		UserID:     userID,
		Kind:       domain.EpisodeBriefEmitted,
		Summary:    "old but relevant cache advice",
		OccurredAt: now.Add(-20 * 24 * time.Hour),
	}
	recentNoise := domain.Episode{
		ID:         uuid.New(),
		UserID:     userID,
		Kind:       domain.EpisodeBriefEmitted,
		Summary:    "recent unrelated advice",
		OccurredAt: now.Add(-time.Hour),
	}
	repo := &recallEpisodeRepo{
		similar: []domain.EpisodeWithScore{{Episode: semanticOld, Score: 0.9}},
		latest:  []domain.Episode{recentNoise, semanticOld},
	}
	memory := &Memory{
		Episodes: repo,
		Embed:    staticEmbedder{},
		Log:      slog.Default(),
		Now:      func() time.Time { return now },
	}

	got, err := memory.Recall(context.Background(), RecallParams{
		UserID:        userID,
		Query:         "cache",
		Kinds:         []domain.EpisodeKind{domain.EpisodeBriefEmitted},
		SinceDays:     60,
		K:             4,
		PerKindRecent: 4,
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len=%d, want 2: %#v", len(got), got)
	}
	if got[0].ID != semanticOld.ID {
		t.Fatalf("first=%q, want semantic hit first", got[0].Summary)
	}
	if got[1].ID != recentNoise.ID {
		t.Fatalf("second=%q, want recent tail second", got[1].Summary)
	}
}

type staticEmbedder struct{}

func (staticEmbedder) Embed(context.Context, string) ([]float32, string, error) {
	return []float32{1, 0, 0}, "test", nil
}

type recallEpisodeRepo struct {
	similar []domain.EpisodeWithScore
	latest  []domain.Episode
}

func (r *recallEpisodeRepo) Append(context.Context, domain.Episode) error { return nil }

func (r *recallEpisodeRepo) LatestByKind(context.Context, uuid.UUID, domain.EpisodeKind, int) ([]domain.Episode, error) {
	return r.latest, nil
}

func (r *recallEpisodeRepo) LatestByKinds(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}

func (r *recallEpisodeRepo) LatestPerKind(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return r.latest, nil
}

func (r *recallEpisodeRepo) SearchSimilar(context.Context, uuid.UUID, []float32, []domain.EpisodeKind, int) ([]domain.EpisodeWithScore, error) {
	return r.similar, nil
}

func (r *recallEpisodeRepo) PendingEmbeddings(context.Context, int) ([]domain.Episode, error) {
	return nil, nil
}

func (r *recallEpisodeRepo) SetEmbedding(context.Context, uuid.UUID, []float32, string) error {
	return nil
}

func (r *recallEpisodeRepo) Stats30d(context.Context, uuid.UUID) (domain.MemoryStats, error) {
	return domain.MemoryStats{}, nil
}

func (r *recallEpisodeRepo) GetBriefRecommendations(context.Context, uuid.UUID, uuid.UUID) ([]domain.Recommendation, error) {
	return nil, domain.ErrEpisodeNotFound
}

func (r *recallEpisodeRepo) DeleteOlderThan(context.Context, time.Time) (int64, error) {
	return 0, nil
}
