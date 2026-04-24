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
	items []domain.PlanItem
	err   error
	calls int
}

func (f *fakeSynthesiser) Synthesise(_ context.Context, _ uuid.UUID, _ []domain.WeakNode, _ []domain.ChronicSkill, _ time.Time) ([]domain.PlanItem, error) {
	f.calls++
	return f.items, f.err
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }
func fixedNow() time.Time         { return time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC) }

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
		Skills:      fakeSkills{},
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
		Skills:      fakeSkills{},
		Synthesiser: nil,
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	_, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uid})
	if !errors.Is(err, domain.ErrLLMUnavailable) {
		t.Fatalf("expected ErrLLMUnavailable, got %v", err)
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
		Skills:      fakeSkills{},
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
		Skills:      fakeSkills{},
		Synthesiser: synth,
		Log:         discardLogger(),
		Now:         fixedNow,
	}
	if _, err := uc.Do(context.Background(), GeneratePlanInput{UserID: uuid.New()}); err == nil {
		t.Fatal("expected synthesiser error to propagate")
	}
}
