package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

func TestSelectCueMemoriesKeepsOnlyUsefulCompactEvidence(t *testing.T) {
	now := time.Date(2026, 4, 27, 8, 0, 0, 0, time.UTC)
	rows := []domain.Episode{
		cueEpisode(t, now, "answered", "User struggled with Redis cache invalidation.", []string{"system design", "backend"}),
		cueEpisode(t, now.Add(-time.Minute), "skipped", "Skipped turn should not matter.", []string{"general"}),
		cueEpisode(t, now.Add(-2*time.Minute), "unclear", "Unclear turn should not matter.", []string{"general"}),
		cueEpisode(t, now.Add(-3*time.Minute), "weak", "Frontend answer was shallow around hydration.", []string{"frontend"}),
		cueEpisode(t, now.Add(-4*time.Minute), "answered", "User struggled with Redis cache invalidation.", []string{"system design"}),
	}

	got := selectCueMemories(rows, 5)
	if len(got) != 2 {
		t.Fatalf("len=%d, want 2: %#v", len(got), got)
	}
	if got[0].Summary != "User struggled with Redis cache invalidation." {
		t.Fatalf("first summary=%q", got[0].Summary)
	}
	if got[1].Summary != "Frontend answer was shallow around hydration." {
		t.Fatalf("second summary=%q", got[1].Summary)
	}
}

func TestSelectCueMemoriesRespectsLimit(t *testing.T) {
	now := time.Date(2026, 4, 27, 8, 0, 0, 0, time.UTC)
	rows := []domain.Episode{
		cueEpisode(t, now, "answered", "one", nil),
		cueEpisode(t, now.Add(-time.Minute), "answered", "two", nil),
		cueEpisode(t, now.Add(-2*time.Minute), "weak", "three", nil),
	}

	got := selectCueMemories(rows, 2)
	if len(got) != 2 {
		t.Fatalf("len=%d, want 2", len(got))
	}
	if got[0].Summary != "one" || got[1].Summary != "two" {
		t.Fatalf("summaries=%q/%q", got[0].Summary, got[1].Summary)
	}
}

func TestCodexTopicsForBriefCollectsSignals(t *testing.T) {
	now := time.Date(2026, 4, 27, 8, 0, 0, 0, time.UTC)
	got := codexTopicsForBrief(
		[]domain.MockSessionSummary{{
			Section:    "system_design",
			WeakTopics: []string{"cache-design", "sharding"},
		}},
		[]domain.SkillWeak{{SkillKey: "redis", Title: "Redis caching"}},
		[]domain.MockKeywords{{Keyword: "consistent-hashing", Count: 4}},
		[]domain.ArenaMatchSummary{{Section: "algorithms"}},
		[]domain.Episode{cueEpisode(t, now, "weak", "weak cache answer", []string{"backend"})},
	)
	for _, want := range []string{"system_design", "cache-design", "sharding", "redis", "redis caching", "consistent-hashing", "algorithms", "backend"} {
		if !containsString(got, want) {
			t.Fatalf("topics=%v missing %q", got, want)
		}
	}
}

func TestBriefMemoryRecallQueryUsesCurrentSignals(t *testing.T) {
	got := briefMemoryRecallQuery(
		[]domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			CurrentLevel: "L5",
			DaysFromNow:  3,
		}},
		[]domain.MockSessionSummary{{Section: "system_design", WeakTopics: []string{"cache-design"}}},
		[]domain.SkillWeak{{SkillKey: "redis", Title: "Redis caching"}},
		[]domain.MockKeywords{{Keyword: "consistent-hashing", Count: 4}},
		[]domain.ArenaMatchSummary{{Section: "algorithms"}},
		domain.QueueSnapshot{Items: []domain.QueueLine{{Title: "Capacity estimation prompt", SkillKey: "system_design"}}},
		[]domain.SkippedPlanItem{{Title: "Read cache notes", SkillKey: "cache-design"}},
		[]domain.NoteHead{{Title: "Redis deep dive", Excerpt: "invalidation and write-through cache notes"}},
		[]domain.DailyNoteHead{{Excerpt: "stuck on sharding and cache invalidation today"}},
	)
	for _, want := range []string{
		"yandex",
		"backend",
		"system_design",
		"cache-design",
		"redis",
		"consistent-hashing",
		"capacity estimation prompt",
		"redis deep dive",
		"stuck on sharding",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("query=%q missing %q", got, want)
		}
	}
}

func TestGetDailyBriefKeepsBriefIDOnlyWhenMemoryAppendSucceeds(t *testing.T) {
	now := time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC)
	userID := uuid.New()
	briefs := &fakeDailyBriefRepo{}
	episodes := &fakeEpisodeRepo{}
	uc := testDailyBriefUseCase(now, briefs, episodes)

	got, err := uc.Do(context.Background(), GetDailyBriefInput{UserID: userID})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got.BriefID == uuid.Nil {
		t.Fatal("BriefID is nil, want generated id")
	}
	if briefs.saved.BriefID != got.BriefID {
		t.Fatalf("saved brief id=%s, want %s", briefs.saved.BriefID, got.BriefID)
	}
	if len(episodes.appended) != 1 {
		t.Fatalf("appended=%d, want 1", len(episodes.appended))
	}
	if !strings.Contains(episodes.appended[0].Summary, "Write 3 cache tradeoffs.") {
		t.Fatalf("memory summary=%q, want recommendation title included", episodes.appended[0].Summary)
	}
	var payload emittedBriefPayload
	if err := json.Unmarshal(episodes.appended[0].Payload, &payload); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	if payload.BriefID != got.BriefID.String() {
		t.Fatalf("payload brief_id=%q, want %s", payload.BriefID, got.BriefID)
	}
	if len(payload.Recommendations) != 1 || payload.Recommendations[0].Title != "Write 3 cache tradeoffs." {
		t.Fatalf("payload recommendations=%#v", payload.Recommendations)
	}
}

func TestGetDailyBriefClearsBriefIDWhenMemoryAppendFails(t *testing.T) {
	now := time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC)
	userID := uuid.New()
	briefs := &fakeDailyBriefRepo{}
	episodes := &fakeEpisodeRepo{appendErr: errors.New("append failed")}
	uc := testDailyBriefUseCase(now, briefs, episodes)

	got, err := uc.Do(context.Background(), GetDailyBriefInput{UserID: userID})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got.BriefID != uuid.Nil {
		t.Fatalf("BriefID=%s, want nil when memory append fails", got.BriefID)
	}
	if briefs.saved.BriefID != uuid.Nil {
		t.Fatalf("saved BriefID=%s, want nil", briefs.saved.BriefID)
	}
}

func TestCacheFreshEnoughInvalidatesAfterNewUserSignal(t *testing.T) {
	now := time.Date(2026, 4, 28, 9, 0, 0, 0, time.UTC)
	generatedAt := now.Add(-time.Hour)
	episodes := &fakeEpisodeRepo{
		latestByKinds: []domain.Episode{{
			Kind:       domain.EpisodeNoteCreated,
			OccurredAt: generatedAt.Add(time.Minute),
		}},
	}
	uc := testDailyBriefUseCase(now, &fakeDailyBriefRepo{}, episodes)

	got, err := uc.cacheFreshEnough(context.Background(), uuid.New(), generatedAt, now)
	if err != nil {
		t.Fatalf("cacheFreshEnough: %v", err)
	}
	if got {
		t.Fatal("cacheFreshEnough=true, want false after a newer memory signal")
	}
}

func TestFreshRecentNotesDropsStaleStandupEvidence(t *testing.T) {
	today := time.Date(2026, 4, 28, 0, 0, 0, 0, time.UTC)
	notes := []domain.NoteHead{
		{Title: "Standup 2026-04-25", UpdatedAt: today.Add(-72 * time.Hour)},
		{Title: "Redis cache drill", UpdatedAt: today.Add(-time.Hour)},
	}

	got := freshRecentNotesForBrief(notes, today)
	if len(got) != 1 {
		t.Fatalf("len=%d, want 1: %#v", len(got), got)
	}
	if got[0].Title != "Redis cache drill" {
		t.Fatalf("note=%q, want fresh non-standup note", got[0].Title)
	}
}

func TestAckRecommendationScopesBriefLookupToUser(t *testing.T) {
	now := time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC)
	userID := uuid.New()
	briefID := uuid.New()
	episodes := &fakeEpisodeRepo{
		getRecs: []domain.Recommendation{{
			Kind:      domain.RecommendationTinyTask,
			Title:     "Write 3 cache tradeoffs.",
			Rationale: "cache-design is repeated.",
		}},
	}
	memory := &Memory{
		Episodes: episodes,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:      func() time.Time { return now },
	}

	if err := memory.AckRecommendation(context.Background(), userID, briefID, 0, true); err != nil {
		t.Fatalf("AckRecommendation: %v", err)
	}
	if episodes.getUserID != userID {
		t.Fatalf("lookup user=%s, want %s", episodes.getUserID, userID)
	}
	if episodes.getBriefID != briefID {
		t.Fatalf("lookup brief=%s, want %s", episodes.getBriefID, briefID)
	}
	if len(episodes.appended) != 1 {
		t.Fatalf("appended=%d, want 1", len(episodes.appended))
	}
	if episodes.appended[0].UserID != userID || episodes.appended[0].Kind != domain.EpisodeBriefFollowed {
		t.Fatalf("appended episode=%#v", episodes.appended[0])
	}
}

func TestAckRecommendationInvalidIndexIsInvalidInput(t *testing.T) {
	now := time.Date(2026, 4, 27, 9, 0, 0, 0, time.UTC)
	episodes := &fakeEpisodeRepo{
		getRecs: []domain.Recommendation{{
			Kind:  domain.RecommendationTinyTask,
			Title: "Write 3 cache tradeoffs.",
		}},
	}
	memory := &Memory{
		Episodes: episodes,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:      func() time.Time { return now },
	}

	err := memory.AckRecommendation(context.Background(), uuid.New(), uuid.New(), 3, true)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err=%v, want ErrInvalidInput", err)
	}
}

func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func testDailyBriefUseCase(now time.Time, briefs *fakeDailyBriefRepo, episodes *fakeEpisodeRepo) *GetDailyBrief {
	return &GetDailyBrief{
		Briefs:      briefs,
		Focus:       fakeFocusReader{},
		Plans:       fakePlanReader{},
		Notes:       fakeNotesReader{},
		Synthesiser: fakeBriefSynthesizer{},
		Log:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:         func() time.Time { return now },
		Memory: &Memory{
			Episodes: episodes,
			Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
			Now:      func() time.Time { return now },
		},
	}
}

type fakeDailyBriefRepo struct {
	saved domain.DailyBrief
}

func (r *fakeDailyBriefRepo) GetForDate(context.Context, uuid.UUID, time.Time) (domain.DailyBrief, error) {
	return domain.DailyBrief{}, domain.ErrNotFound
}

func (r *fakeDailyBriefRepo) Upsert(_ context.Context, _ uuid.UUID, _ time.Time, b domain.DailyBrief) error {
	r.saved = b
	return nil
}

func (r *fakeDailyBriefRepo) LastForcedAt(context.Context, uuid.UUID) (time.Time, error) {
	return time.Time{}, nil
}

type fakeFocusReader struct{}

func (fakeFocusReader) LastNDays(context.Context, uuid.UUID, int) ([]domain.FocusDay, error) {
	return nil, nil
}

type fakePlanReader struct{}

func (fakePlanReader) SkippedItems(context.Context, uuid.UUID, time.Time) ([]domain.SkippedPlanItem, error) {
	return nil, nil
}

func (fakePlanReader) CompletedItems(context.Context, uuid.UUID, time.Time) ([]domain.CompletedPlanItem, error) {
	return nil, nil
}

type fakeNotesReader struct{}

func (fakeNotesReader) RecentReflections(context.Context, uuid.UUID, int) ([]domain.Reflection, error) {
	return nil, nil
}

func (fakeNotesReader) RecentNotes(context.Context, uuid.UUID, int) ([]domain.NoteHead, error) {
	return nil, nil
}

func (fakeNotesReader) EmbeddedCorpus(context.Context, uuid.UUID) ([]domain.NoteEmbedding, error) {
	return nil, nil
}

type fakeBriefSynthesizer struct{}

func (fakeBriefSynthesizer) Synthesise(context.Context, domain.BriefPromptInput) (domain.DailyBrief, error) {
	return domain.DailyBrief{
		Headline:  "Cache gap is actionable.",
		Narrative: "The repeated signal is cache-design.",
		Recommendations: []domain.Recommendation{{
			Kind:      domain.RecommendationTinyTask,
			Title:     "Write 3 cache tradeoffs.",
			Rationale: "cache-design is repeated.",
		}},
	}, nil
}

type fakeEpisodeRepo struct {
	appendErr     error
	appended      []domain.Episode
	getUserID     uuid.UUID
	getBriefID    uuid.UUID
	getRecs       []domain.Recommendation
	latestByKinds []domain.Episode
}

func (r *fakeEpisodeRepo) Append(_ context.Context, e domain.Episode) error {
	r.appended = append(r.appended, e)
	return r.appendErr
}

func (r *fakeEpisodeRepo) LatestByKind(context.Context, uuid.UUID, domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}

func (r *fakeEpisodeRepo) LatestByKinds(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return r.latestByKinds, nil
}

func (r *fakeEpisodeRepo) LatestPerKind(context.Context, uuid.UUID, []domain.EpisodeKind, int) ([]domain.Episode, error) {
	return nil, nil
}

func (r *fakeEpisodeRepo) SearchSimilar(context.Context, uuid.UUID, []float32, string, []domain.EpisodeKind, int) ([]domain.EpisodeWithScore, error) {
	return nil, nil
}

func (r *fakeEpisodeRepo) PendingEmbeddings(context.Context, int) ([]domain.Episode, error) {
	return nil, nil
}

func (r *fakeEpisodeRepo) SetEmbedding(context.Context, uuid.UUID, []float32, string) error {
	return nil
}

func (r *fakeEpisodeRepo) Stats30d(context.Context, uuid.UUID) (domain.MemoryStats, error) {
	return domain.MemoryStats{}, nil
}

func (r *fakeEpisodeRepo) GetBriefRecommendations(_ context.Context, userID, briefID uuid.UUID) ([]domain.Recommendation, error) {
	r.getUserID = userID
	r.getBriefID = briefID
	if r.getRecs != nil {
		return r.getRecs, nil
	}
	return nil, domain.ErrEpisodeNotFound
}

func (r *fakeEpisodeRepo) DeleteOlderThan(context.Context, time.Time) (int64, error) {
	return 0, nil
}

func (r *fakeEpisodeRepo) MarkStaleForReembed(context.Context, string) (int64, error) {
	return 0, nil
}

func cueEpisode(t *testing.T, occurredAt time.Time, outcome, summary string, topics []string) domain.Episode {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"outcome":         outcome,
		"rolling_summary": summary,
		"topics":          topics,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return domain.Episode{
		ID:         uuid.New(),
		UserID:     uuid.New(),
		Kind:       domain.EpisodeCueConversationMemory,
		Summary:    "Cue conversation memory",
		Payload:    payload,
		OccurredAt: occurredAt,
	}
}
