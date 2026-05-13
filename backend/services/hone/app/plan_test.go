package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ─── GeneratePlan ──────────────────────────────────────────────────────────

func TestGeneratePlan_ReturnsCachedWhenExistsAndNotForced(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	cached := domain.Plan{UserID: uid, Date: fixedNow().UTC().Truncate(24 * time.Hour), Items: []domain.PlanItem{{ID: "a", Kind: domain.PlanItemSolve, Title: "cached"}}}

	plans := newPlanStore()
	plans.getForDateFn = func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
		return cached, nil
	}
	synth := &synthState{items: []domain.PlanItem{{ID: "new", Kind: domain.PlanItemSolve, Title: "fresh"}}}
	skills := &skillsStore{}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	got, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: false})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Title != "cached" {
		t.Fatalf("expected cached plan, got %+v", got)
	}
	if synth.calls != 0 {
		t.Fatalf("synthesiser called %d times; should be 0 when cache hits", synth.calls)
	}
}

func TestGeneratePlan_ForcedBypassesCache(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	cached := domain.Plan{UserID: uid, Items: []domain.PlanItem{{ID: "old", Title: "old"}}}
	synth := &synthState{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "fresh"}}}

	plans := newPlanStore()
	plans.getForDateFn = func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) { return cached, nil }
	skills := &skillsStore{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	got, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if synth.calls != 1 {
		t.Fatalf("synth.calls = %d, want 1", synth.calls)
	}
	if len(got.Items) != 1 || got.Items[0].Title != "fresh" {
		t.Fatalf("expected regenerated plan, got %+v", got)
	}
	if plans.lastUpsert().RegeneratedAt.IsZero() {
		t.Fatal("RegeneratedAt not stamped on upsert")
	}
}

func TestGeneratePlan_LLMUnavailableWhenSynthesiserNil(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	plans := newPlanStore()
	// default getForDateFn → ErrNotFound
	skills := &skillsStore{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: nil,
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid})
	if !errors.Is(err, domain.ErrLLMUnavailable) {
		t.Fatalf("expected ErrLLMUnavailable, got %v", err)
	}
}

func TestGeneratePlan_RequiresConcreteSignals(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	synth := &synthState{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "fresh"}}}
	plans := newPlanStore()
	skills := &skillsStore{}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}

	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: true})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if synth.calls != 0 {
		t.Fatalf("synthesiser called %d times without signals", synth.calls)
	}
}

func TestGeneratePlan_UsesTodayNoteContextAsSignal(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	noteID := uuid.New()
	body := `Intent: focus on Redis cache invalidation before interview.
Blocker: stuck explaining tradeoffs clearly.
Need to write 3 examples.`
	synth := &synthState{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "Redis tradeoff drill"}}}
	plans := newPlanStore()
	notes := newNoteStore()
	notes.listFn = func(_ context.Context, _ uuid.UUID, _ int, _ string, _ *uuid.UUID) ([]domain.NoteSummary, string, error) {
		return []domain.NoteSummary{{
			ID:        noteID,
			Title:     "Daily 2026-04-24",
			UpdatedAt: fixedNow(),
		}}, "", nil
	}
	notes.getFn = func(_ context.Context, _ uuid.UUID, id uuid.UUID) (domain.Note, error) {
		if id != noteID {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{ID: noteID, UserID: uid, Title: "Daily 2026-04-24", BodyMD: body}, nil
	}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, &skillsStore{}),
		Notes:       wireMockNoteRepo(ctrl, notes),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}

	got, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: true})
	if err != nil {
		t.Fatalf("GeneratePlan.Do: %v", err)
	}
	upserted := plans.lastUpsert()
	if len(got.Items) != 1 || upserted.Items[0].Title != "Redis tradeoff drill" {
		t.Fatalf("plan not upserted from today-context synthesis: got=%+v upserted=%+v", got, upserted)
	}
	if synth.calls != 1 {
		t.Fatalf("synth.calls=%d, want 1", synth.calls)
	}
	if synth.todaySeen.Intent != "focus on Redis cache invalidation before interview" {
		t.Fatalf("today intent=%q", synth.todaySeen.Intent)
	}
	if len(synth.todaySeen.Blockers) == 0 || len(synth.todaySeen.ActionHints) == 0 {
		t.Fatalf("today context missing blockers/actions: %+v", synth.todaySeen)
	}
	if !containsString(synth.todaySeen.Topics, "cache-design") || !containsString(synth.todaySeen.Topics, "interview") {
		t.Fatalf("topics=%v", synth.todaySeen.Topics)
	}
}

func TestGeneratePlan_IgnoresStaleDailyNoteContext(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	synth := &synthState{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "stale"}}}
	plans := newPlanStore()
	notes := newNoteStore()
	notes.listFn = func(_ context.Context, _ uuid.UUID, _ int, _ string, _ *uuid.UUID) ([]domain.NoteSummary, string, error) {
		return []domain.NoteSummary{{
			ID:        uuid.New(),
			Title:     "Daily 2026-04-25",
			UpdatedAt: time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC),
		}}, "", nil
	}
	notes.getFn = func(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error) {
		t.Fatal("stale daily note must not be loaded")
		return domain.Note{}, nil
	}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, &skillsStore{}),
		Notes:       wireMockNoteRepo(ctrl, notes),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         func() time.Time { return time.Date(2026, 4, 28, 10, 0, 0, 0, time.UTC) },
	}

	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: true})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if synth.calls != 0 {
		t.Fatalf("synthesiser called %d times with stale daily note", synth.calls)
	}
}

func TestGeneratePlan_TrimsToMaxItems(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	many := make([]domain.PlanItem, MaxPlanItems+3)
	for i := range many {
		many[i] = domain.PlanItem{ID: "", Kind: domain.PlanItemSolve, Title: "t"}
	}
	synth := &synthState{items: many}
	plans := newPlanStore()
	skills := &skillsStore{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	upserted := plans.lastUpsert()
	if len(upserted.Items) != MaxPlanItems {
		t.Fatalf("items capped to %d, got %d", MaxPlanItems, len(upserted.Items))
	}
}

func TestGeneratePlan_PropagatesSynthesiserError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	synth := &synthState{err: errors.New("provider timeout")}
	plans := newPlanStore()
	skills := &skillsStore{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}}
	uc := &GeneratePlan{
		Plans:       wireMockPlanRepo(ctrl, plans),
		Skills:      wireMockSkillAtlasReader(ctrl, skills),
		Synthesiser: wireMockPlanSynthesizer(ctrl, synth),
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	if _, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uuid.New()}); err == nil {
		t.Fatal("expected synthesiser error to propagate")
	}
}
