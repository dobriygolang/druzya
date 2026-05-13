// Package app — Phase J Wave 1 / D coverage for AtlasReader wiring.
//
// Covers:
//   - Zero user_id rejected with ErrInvalidInput.
//   - AtlasReader nil → RelevantResources stays empty (no panic).
//   - AtlasReader wired + goal present → RelevantResources populated and
//     the goalText / recentActivity passed in were derived from the bundle.
//   - AtlasReader error → bundle stays usable, RelevantResources empty.
//   - recentActivityFromBundle de-dups and skips blanks.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ─── Tests ────────────────────────────────────────────────────────────────

func TestGetUserContext_RejectsZeroUserID(t *testing.T) {
	uc := &GetUserContext{}
	_, err := uc.Do(context.Background(), GetUserContextInput{UserID: uuid.Nil})
	if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestGetUserContext_NoAtlasReader_EmptyRelevantResources(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	uc := &GetUserContext{
		Goals:    wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{}),
		Episodes: wireMockEpisodeRepo(ctrl, &episodeStore{}),
		Now:      func() time.Time { return time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), GetUserContextInput{UserID: uid})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.RelevantResources) != 0 {
		t.Fatalf("expected zero RelevantResources without AtlasReader, got %d", len(out.RelevantResources))
	}
}

func TestGetUserContext_AtlasReader_PopulatesRelevantResources(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)

	// Seed an active goal so goalText is derived.
	goalStore := &primaryGoalStore{}
	goalRepo := wireMockPrimaryGoalRepo(ctrl, goalStore)
	_, err := goalRepo.Insert(context.Background(), domain.PrimaryGoal{
		UserID:        uid,
		Kind:          domain.PrimaryGoalKindTopTierCo,
		TargetCompany: "Yandex",
		TargetLevel:   "L4",
		TargetText:    "system design and algorithms",
		Active:        true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Seed recent memory + resource trail signals so recentActivity has content.
	episodes := &episodeStore{
		latestByKinds: []domain.Episode{{
			ID:         uuid.New(),
			UserID:     uid,
			Kind:       domain.EpisodeMockPipelineFinished,
			Summary:    "sysdesign 32",
			OccurredAt: now.Add(-3 * time.Hour),
		}},
	}
	resEng := &resEngStore{
		resp: domain.ResourceEngagement{
			FinishedRecent: []domain.ResourceTouch{
				{AtlasNodeID: "algo.sorting.merge", Kind: "finished"},
				{AtlasNodeID: "algo.sorting.merge", Kind: "finished"},
			},
		},
	}

	atlasTap := &atlasReaderTap{
		refs: []AtlasResourceRef{
			{ID: "algo_basics", Title: "Алгоритмы: основы", URL: "https://example/algo", Kind: "course"},
		},
	}

	uc := &GetUserContext{
		Goals:       goalRepo,
		Episodes:    wireMockEpisodeRepo(ctrl, episodes),
		ResourceEng: wireMockResourceEngagementReader(ctrl, resEng),
		Mocks:       wireMockMockReader(ctrl),
		AtlasReader: wireMockAtlasReader(ctrl, atlasTap),
		Now:         func() time.Time { return now },
	}

	out, err := uc.Do(context.Background(), GetUserContextInput{UserID: uid})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.RelevantResources) != 1 {
		t.Fatalf("expected 1 RelevantResources, got %d", len(out.RelevantResources))
	}
	if out.RelevantResources[0].ID != "algo_basics" {
		t.Fatalf("unexpected ref: %+v", out.RelevantResources[0])
	}
	atlasTap.mu.Lock()
	defer atlasTap.mu.Unlock()
	if atlasTap.callCount != 1 {
		t.Fatalf("expected exactly one AtlasReader call, got %d", atlasTap.callCount)
	}
	if atlasTap.gotLimit != 5 {
		t.Fatalf("expected limit=5, got %d", atlasTap.gotLimit)
	}
	if atlasTap.gotGoalText == "" {
		t.Fatalf("expected non-empty goalText, got empty")
	}
	if len(atlasTap.gotActivity) == 0 {
		t.Fatalf("expected recentActivity to be populated, got empty")
	}
}

func TestGetUserContext_AtlasReaderError_StaysUsable(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	atlasTap := &atlasReaderTap{err: errors.New("boom")}
	uc := &GetUserContext{
		Goals:       wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{}),
		Episodes:    wireMockEpisodeRepo(ctrl, &episodeStore{}),
		AtlasReader: wireMockAtlasReader(ctrl, atlasTap),
		Now:         func() time.Time { return time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), GetUserContextInput{UserID: uid})
	if err != nil {
		t.Fatalf("expected nil error (fail-soft), got %v", err)
	}
	if len(out.RelevantResources) != 0 {
		t.Fatalf("expected zero RelevantResources on reader error, got %d", len(out.RelevantResources))
	}
}

// ─── Pure helpers ─────────────────────────────────────────────────────────

func TestGoalTextFromBundle_NilGoal(t *testing.T) {
	if got := goalTextFromBundle(nil); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestGoalTextFromBundle_FullGoal(t *testing.T) {
	g := &domain.PrimaryGoal{
		Kind:          domain.PrimaryGoalKindTopTierCo,
		TargetCompany: "Yandex",
		TargetLevel:   "L4",
		TargetText:    "system design",
	}
	got := goalTextFromBundle(g)
	for _, want := range []string{"top_tier_co", "Yandex", "L4", "system design"} {
		if !contains(got, want) {
			t.Fatalf("expected %q in %q", want, got)
		}
	}
}

func TestRecentActivityFromBundle_DedupAndSkipsBlanks(t *testing.T) {
	b := UserContextBundle{
		Activity: ActivitySummaryView{TopKinds: []string{"algo", "ALGO", "", "system_design"}},
		RecentMemory: []CoachMemoryEntry{
			{Kind: "algo"},        // dup
			{Kind: "reflection"},  // new
			{Kind: ""},            // blank
		},
		Radar: SkillRadarView{WeakestAxis: "system_design"}, // already present
	}
	got := recentActivityFromBundle(b)
	if len(got) < 2 {
		t.Fatalf("expected at least 2 unique activities, got %v", got)
	}
	seen := make(map[ActivityKind]int, len(got))
	for _, k := range got {
		seen[k]++
	}
	for k, n := range seen {
		if n > 1 {
			t.Fatalf("duplicate %q (%d times) in %v", k, n, got)
		}
	}
}

// contains — tiny helper that mirrors strings.Contains without importing
// strings just for the test file noise.
func contains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	if len(needle) > len(haystack) {
		return false
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
