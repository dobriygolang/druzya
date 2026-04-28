package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// Hand-rolled fakes for the domain interfaces exercised by GeneratePlan.
// A mockgen-backed set lives at domain/mocks (see the go:generate directive
// in domain/repo.go) but spinning it up for this single use case adds more
// churn than value — the fakes here stay focused on the invariants we want
// to lock down: cache-respecting, LLM-dependency, ErrLLMUnavailable surface.

// fakePlanRepo — minimal PlanRepo implementation.
type fakePlanRepo struct {
	getForDate func(context.Context, uuid.UUID, time.Time) (domain.Plan, error)
	upsert     func(context.Context, domain.Plan) (domain.Plan, error)
	patchItem  func(context.Context, uuid.UUID, time.Time, string, bool, bool) (domain.Plan, error)
}

func (f fakePlanRepo) GetForDate(ctx context.Context, u uuid.UUID, d time.Time) (domain.Plan, error) {
	return f.getForDate(ctx, u, d)
}
func (f fakePlanRepo) Upsert(ctx context.Context, p domain.Plan) (domain.Plan, error) {
	return f.upsert(ctx, p)
}
func (f fakePlanRepo) PatchItem(ctx context.Context, u uuid.UUID, d time.Time, id string, dismissed, completed bool) (domain.Plan, error) {
	return f.patchItem(ctx, u, d, id, dismissed, completed)
}

// fakeSkills — returns a fixed weak-node set regardless of user.
type fakeSkills struct{ nodes []domain.WeakNode }

func (f fakeSkills) WeakestNodes(_ context.Context, _ uuid.UUID, _ int) ([]domain.WeakNode, error) {
	return f.nodes, nil
}

// fakeSynthesiser — deterministic output; counts calls so tests can assert
// "did we actually invoke the LLM?".
type fakeSynthesiser struct {
	items       []domain.PlanItem
	err         error
	calls       int
	todaySeen   domain.TodayContext
	weakSeen    []domain.WeakNode
	chronicSeen []domain.ChronicSkill
}

func (f *fakeSynthesiser) Synthesise(_ context.Context, _ uuid.UUID, weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, _ time.Time) ([]domain.PlanItem, error) {
	f.calls++
	f.weakSeen = weak
	f.chronicSeen = chronic
	f.todaySeen = today
	return f.items, f.err
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }
func fixedNow() time.Time         { return time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC) }

func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

// ─── GeneratePlan ──────────────────────────────────────────────────────────

func TestGeneratePlan_ReturnsCachedWhenExistsAndNotForced(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	cached := domain.Plan{UserID: uid, Date: fixedNow().UTC().Truncate(24 * time.Hour), Items: []domain.PlanItem{{ID: "a", Kind: domain.PlanItemSolve, Title: "cached"}}}

	synth := &fakeSynthesiser{items: []domain.PlanItem{{ID: "new", Kind: domain.PlanItemSolve, Title: "fresh"}}}
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return cached, nil
			},
		},
		Skills:      fakeSkills{},
		Synthesiser: synth,
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
	uid := uuid.New()
	cached := domain.Plan{UserID: uid, Items: []domain.PlanItem{{ID: "old", Title: "old"}}}
	synth := &fakeSynthesiser{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "fresh"}}}

	var upserted domain.Plan
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) { return cached, nil },
			upsert: func(_ context.Context, p domain.Plan) (domain.Plan, error) {
				upserted = p
				return p, nil
			},
		},
		Skills:      fakeSkills{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}},
		Synthesiser: synth,
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
	if upserted.RegeneratedAt.IsZero() {
		t.Fatal("RegeneratedAt not stamped on upsert")
	}
}

func TestGeneratePlan_LLMUnavailableWhenSynthesiserNil(t *testing.T) {
	t.Parallel()
	// Anti-fallback: no LLM → 503. Never a stub plan.
	uid := uuid.New()
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
		},
		Skills:      fakeSkills{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}},
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
	uid := uuid.New()
	synth := &fakeSynthesiser{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "fresh"}}}
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
		},
		Skills:      fakeSkills{},
		Synthesiser: synth,
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
	uid := uuid.New()
	noteID := uuid.New()
	body := `Intent: focus on Redis cache invalidation before interview.
Blocker: stuck explaining tradeoffs clearly.
Need to write 3 examples.`
	synth := &fakeSynthesiser{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "Redis tradeoff drill"}}}
	var upserted domain.Plan
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
			upsert: func(_ context.Context, p domain.Plan) (domain.Plan, error) {
				upserted = p
				return p, nil
			},
		},
		Skills: fakeSkills{},
		Notes: fakeNoteRepo{
			list: func(_ context.Context, _ uuid.UUID, _ int, _ string, _ *uuid.UUID) ([]domain.NoteSummary, string, error) {
				return []domain.NoteSummary{{
					ID:        noteID,
					Title:     "Daily 2026-04-24",
					UpdatedAt: fixedNow(),
				}}, "", nil
			},
			get: func(_ context.Context, _ uuid.UUID, id uuid.UUID) (domain.Note, error) {
				if id != noteID {
					return domain.Note{}, domain.ErrNotFound
				}
				return domain.Note{ID: noteID, UserID: uid, Title: "Daily 2026-04-24", BodyMD: body}, nil
			},
		},
		Synthesiser: synth,
		Log:         discardLogger(),
		Now:         fixedNow,
	}

	got, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid, Force: true})
	if err != nil {
		t.Fatalf("GeneratePlan.Do: %v", err)
	}
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
	uid := uuid.New()
	synth := &fakeSynthesiser{items: []domain.PlanItem{{ID: "x", Kind: domain.PlanItemSolve, Title: "stale"}}}
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
		},
		Skills: fakeSkills{},
		Notes: fakeNoteRepo{
			list: func(_ context.Context, _ uuid.UUID, _ int, _ string, _ *uuid.UUID) ([]domain.NoteSummary, string, error) {
				return []domain.NoteSummary{{
					ID:        uuid.New(),
					Title:     "Daily 2026-04-25",
					UpdatedAt: time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC),
				}}, "", nil
			},
			get: func(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error) {
				t.Fatal("stale daily note must not be loaded")
				return domain.Note{}, nil
			},
		},
		Synthesiser: synth,
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
	// Synthesiser overproduces — we cap at MaxPlanItems so the UI doesn't
	// render a 12-row novel when the user wants a focus cockpit.
	many := make([]domain.PlanItem, MaxPlanItems+3)
	for i := range many {
		many[i] = domain.PlanItem{ID: "", Kind: domain.PlanItemSolve, Title: "t"}
	}
	synth := &fakeSynthesiser{items: many}
	var upserted domain.Plan
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
			upsert: func(_ context.Context, p domain.Plan) (domain.Plan, error) { upserted = p; return p, nil },
		},
		Skills:      fakeSkills{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}},
		Synthesiser: synth,
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(upserted.Items) != MaxPlanItems {
		t.Fatalf("items capped to %d, got %d", MaxPlanItems, len(upserted.Items))
	}
}

func TestGeneratePlan_PropagatesSynthesiserError(t *testing.T) {
	t.Parallel()
	synth := &fakeSynthesiser{err: errors.New("provider timeout")}
	uc := &GeneratePlan{
		Plans: fakePlanRepo{
			getForDate: func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.Plan, error) {
				return domain.Plan{}, domain.ErrNotFound
			},
		},
		Skills:      fakeSkills{nodes: []domain.WeakNode{{NodeKey: "cache", DisplayName: "Cache", Progress: 20}}},
		Synthesiser: synth,
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	if _, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uuid.New()}); err == nil {
		t.Fatal("expected synthesiser error to propagate")
	}
}
