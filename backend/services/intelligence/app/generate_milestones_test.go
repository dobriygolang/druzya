package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// ─── parseMilestoneJSON ───────────────────────────────────────────────────

func TestParseMilestoneJSON_Envelope(t *testing.T) {
	raw := `{"milestones":[
		{"title":"Week 1 Foundations","detail":"Refresh basics.","category":"foundation"},
		{"title":"Week 2 Algorithms","detail":"Top-30 LeetCode mediums.","category":"practice"},
		{"title":"Week 3 SysDesign","detail":"DDIA Ch 1-5.","category":"practice"},
		{"title":"Week 4 Mock","detail":"Full pipeline mock.","category":"mock"},
		{"title":"Week 5 Final","detail":"Daily warm-ups.","category":"final"}
	]}`
	out, err := parseMilestoneJSON(raw)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(out))
	}
	if out[0].Category != "foundation" || out[3].Category != "mock" {
		t.Fatalf("category mismatch: %+v", out)
	}
}

func TestParseMilestoneJSON_BareArray(t *testing.T) {
	raw := `[
		{"title":"a","detail":"x","category":"practice"},
		{"title":"b","detail":"x","category":"practice"},
		{"title":"c","detail":"x","category":"practice"},
		{"title":"d","detail":"x","category":"final"}
	]`
	out, err := parseMilestoneJSON(raw)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 4 {
		t.Fatalf("expected 4, got %d", len(out))
	}
}

func TestParseMilestoneJSON_StripsFences(t *testing.T) {
	raw := "```json\n{\"milestones\":[" +
		`{"title":"a","detail":"x","category":"practice"},` +
		`{"title":"b","detail":"x","category":"practice"},` +
		`{"title":"c","detail":"x","category":"practice"},` +
		`{"title":"d","detail":"x","category":"final"}` +
		"]}\n```"
	out, err := parseMilestoneJSON(raw)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 4 {
		t.Fatalf("expected 4 entries, got %d", len(out))
	}
}

func TestParseMilestoneJSON_RejectsTooFew(t *testing.T) {
	raw := `{"milestones":[{"title":"only-one","detail":"x","category":"final"}]}`
	if _, err := parseMilestoneJSON(raw); err == nil {
		t.Fatal("expected ≥4 milestones error")
	}
}

func TestValidateMilestones_GracefulCategoryFallback(t *testing.T) {
	in := []milestoneRaw{
		{Title: "a", Detail: "x", Category: "nonsense"},
		{Title: "b", Detail: "x", Category: "PRACTICE"},
		{Title: "c", Detail: "x", Category: "practice"},
		{Title: "d", Detail: "x", Category: "final"},
	}
	out, err := validateMilestones(in)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].Category != "practice" {
		t.Fatalf("expected graceful fallback to 'practice', got %q", out[0].Category)
	}
	if out[1].Category != "practice" {
		t.Fatalf("expected lower-cased to 'practice', got %q", out[1].Category)
	}
}

// ─── GenerateMilestones UC ─────────────────────────────────────────────────

// stubChain — minimal ChatClient.
type stubChain struct {
	resp llmchain.Response
	err  error
}

func (s *stubChain) Chat(_ context.Context, _ llmchain.Request) (llmchain.Response, error) {
	return s.resp, s.err
}

func (s *stubChain) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("stubChain: streaming not used")
}

// fakeMilestoneRepo — in-memory.
type fakeMilestoneRepo struct {
	rows           []domain.Milestone
	latestGenAt    time.Time
	replaceErr     error
	markDoneCalled bool
}

func (r *fakeMilestoneRepo) LatestSet(_ context.Context, userID, goalID uuid.UUID) ([]domain.Milestone, error) {
	out := []domain.Milestone{}
	for _, m := range r.rows {
		if m.UserID == userID && m.GoalID == goalID {
			out = append(out, m)
		}
	}
	return out, nil
}

func (r *fakeMilestoneRepo) Replace(_ context.Context, userID, goalID uuid.UUID, items []domain.Milestone) ([]domain.Milestone, error) {
	if r.replaceErr != nil {
		return nil, r.replaceErr
	}
	// Drop existing for (user, goal).
	keep := make([]domain.Milestone, 0, len(r.rows))
	for _, m := range r.rows {
		if !(m.UserID == userID && m.GoalID == goalID) {
			keep = append(keep, m)
		}
	}
	r.rows = keep
	for i := range items {
		items[i].ID = uuid.New()
		items[i].UserID = userID
		items[i].GoalID = goalID
		r.rows = append(r.rows, items[i])
	}
	return items, nil
}

func (r *fakeMilestoneRepo) MarkDone(_ context.Context, userID, milestoneID uuid.UUID, done bool) (domain.Milestone, error) {
	r.markDoneCalled = true
	for i, m := range r.rows {
		if m.ID == milestoneID && m.UserID == userID {
			if done {
				now := time.Now().UTC()
				r.rows[i].DoneAt = &now
			} else {
				r.rows[i].DoneAt = nil
			}
			return r.rows[i], nil
		}
	}
	return domain.Milestone{}, domain.ErrNotFound
}

func (r *fakeMilestoneRepo) LatestGenerationAt(_ context.Context, _, _ uuid.UUID) (time.Time, error) {
	return r.latestGenAt, nil
}

func newSeededGoalRepo(uid uuid.UUID) (*fakePrimaryGoalRepo, domain.PrimaryGoal) {
	repo := &fakePrimaryGoalRepo{}
	g := domain.PrimaryGoal{
		ID:     uuid.New(),
		UserID: uid,
		Kind:   domain.PrimaryGoalKindAnySenior,
		Active: true,
	}
	repo.rows = append(repo.rows, g)
	return repo, g
}

func TestGenerateMilestones_HappyPath(t *testing.T) {
	uid := uuid.New()
	goals, _ := newSeededGoalRepo(uid)
	repo := &fakeMilestoneRepo{}

	canned := `{"milestones":[
		{"title":"Week 1 Foundations","detail":"refresh","category":"foundation"},
		{"title":"Week 2 Algos","detail":"top-30","category":"practice"},
		{"title":"Week 3 SysDesign","detail":"ddia","category":"practice"},
		{"title":"Week 4 Mock","detail":"full pipeline","category":"mock"},
		{"title":"Week 5 Final","detail":"warm-ups","category":"final"}
	]}`
	chain := &stubChain{resp: llmchain.Response{Content: canned}}

	uc := &GenerateMilestones{
		Repo: repo, Goals: goals, Chain: chain,
		Now: func() time.Time { return time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), GenerateMilestonesInput{UserID: uid, Force: true})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 5 {
		t.Fatalf("expected 5 milestones, got %d", len(out))
	}
	if out[0].WeekIndex != 1 || out[4].WeekIndex != 5 {
		t.Fatalf("bad week_index sequence: %+v", out)
	}
	if out[0].Category != domain.MilestoneCategoryFoundation {
		t.Fatalf("bad category: %s", out[0].Category)
	}
	// Persisted в repo.
	if len(repo.rows) != 5 {
		t.Fatalf("repo not populated: got %d", len(repo.rows))
	}
}

func TestGenerateMilestones_CacheHitSkipsLLM(t *testing.T) {
	uid := uuid.New()
	goals, g := newSeededGoalRepo(uid)
	// Pre-populate repo + set recent generation timestamp.
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	repo := &fakeMilestoneRepo{
		rows: []domain.Milestone{
			{ID: uuid.New(), UserID: uid, GoalID: g.ID, WeekIndex: 1, Title: "cached", GeneratedAt: now.Add(-24 * time.Hour)},
		},
		latestGenAt: now.Add(-24 * time.Hour),
	}
	chain := &stubChain{err: errors.New("LLM should NOT be called when cache fresh")}
	uc := &GenerateMilestones{Repo: repo, Goals: goals, Chain: chain, Now: func() time.Time { return now }}
	out, err := uc.Do(context.Background(), GenerateMilestonesInput{UserID: uid, Force: false})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || out[0].Title != "cached" {
		t.Fatalf("expected cached result, got %+v", out)
	}
}

func TestGenerateMilestones_ForceBypassesCache(t *testing.T) {
	uid := uuid.New()
	goals, g := newSeededGoalRepo(uid)
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	repo := &fakeMilestoneRepo{
		rows: []domain.Milestone{
			{ID: uuid.New(), UserID: uid, GoalID: g.ID, WeekIndex: 1, Title: "cached", GeneratedAt: now.Add(-24 * time.Hour)},
		},
		latestGenAt: now.Add(-24 * time.Hour),
	}
	canned := `{"milestones":[
		{"title":"new w1","detail":"x","category":"foundation"},
		{"title":"new w2","detail":"x","category":"practice"},
		{"title":"new w3","detail":"x","category":"practice"},
		{"title":"new w4","detail":"x","category":"final"}
	]}`
	chain := &stubChain{resp: llmchain.Response{Content: canned}}
	uc := &GenerateMilestones{Repo: repo, Goals: goals, Chain: chain, Now: func() time.Time { return now }}
	out, err := uc.Do(context.Background(), GenerateMilestonesInput{UserID: uid, Force: true})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 4 || out[0].Title != "new w1" {
		t.Fatalf("expected fresh LLM-driven set, got %+v", out)
	}
}

func TestGenerateMilestones_NoChainErrors(t *testing.T) {
	uid := uuid.New()
	goals, _ := newSeededGoalRepo(uid)
	repo := &fakeMilestoneRepo{}
	uc := &GenerateMilestones{Repo: repo, Goals: goals, Chain: nil}
	_, err := uc.Do(context.Background(), GenerateMilestonesInput{UserID: uid, Force: true})
	if err == nil || !errors.Is(err, domain.ErrLLMUnavailable) {
		t.Fatalf("expected ErrLLMUnavailable, got %v", err)
	}
}

func TestGenerateMilestones_NoActiveGoal(t *testing.T) {
	repo := &fakeMilestoneRepo{}
	goals := &fakePrimaryGoalRepo{}
	uc := &GenerateMilestones{Repo: repo, Goals: goals, Chain: &stubChain{}}
	_, err := uc.Do(context.Background(), GenerateMilestonesInput{UserID: uuid.New(), Force: true})
	if err == nil || !strings.Contains(err.Error(), "load goal") {
		t.Fatalf("expected load goal error, got %v", err)
	}
}

// ─── GetMilestones ────────────────────────────────────────────────────────

func TestGetMilestones_ReturnsCached(t *testing.T) {
	uid := uuid.New()
	goals, g := newSeededGoalRepo(uid)
	repo := &fakeMilestoneRepo{
		rows: []domain.Milestone{
			{ID: uuid.New(), UserID: uid, GoalID: g.ID, WeekIndex: 1, Title: "cached"},
		},
	}
	uc := &GetMilestones{Repo: repo, Goals: goals}
	out, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 milestone, got %d", len(out))
	}
}

func TestGetMilestones_NoGoalReturnsNotFound(t *testing.T) {
	repo := &fakeMilestoneRepo{}
	goals := &fakePrimaryGoalRepo{}
	uc := &GetMilestones{Repo: repo, Goals: goals}
	_, err := uc.Do(context.Background(), uuid.New())
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound bubbling, got %v", err)
	}
}

// ─── MarkMilestoneDone ────────────────────────────────────────────────────

func TestMarkMilestoneDone_HappyPath(t *testing.T) {
	uid := uuid.New()
	goalID := uuid.New()
	mid := uuid.New()
	repo := &fakeMilestoneRepo{
		rows: []domain.Milestone{
			{ID: mid, UserID: uid, GoalID: goalID, WeekIndex: 1, Title: "x"},
		},
	}
	uc := &MarkMilestoneDone{Repo: repo}
	out, err := uc.Do(context.Background(), MarkMilestoneDoneInput{
		UserID: uid, MilestoneID: mid, Done: true,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.DoneAt == nil {
		t.Fatal("expected done_at set")
	}
}

func TestMarkMilestoneDone_ValidationErrors(t *testing.T) {
	uc := &MarkMilestoneDone{Repo: &fakeMilestoneRepo{}}
	if _, err := uc.Do(context.Background(), MarkMilestoneDoneInput{MilestoneID: uuid.New()}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero user, got %v", err)
	}
	if _, err := uc.Do(context.Background(), MarkMilestoneDoneInput{UserID: uuid.New()}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero id, got %v", err)
	}
}
