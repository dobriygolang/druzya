package app

import (
	"context"
	"math"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── cosine ────────────────────────────────────────────────────────────────
//
// cosine is the hot-loop of GetNoteConnections. It runs once per note in the
// user's corpus every time the user opens connections (~0.1-1ms total at
// realistic scale — 100-1000 notes). The tests lock down the invariants
// callers rely on: identical vectors give 1.0, orthogonal give 0, length
// mismatch degrades silently rather than panicking.

func TestCosine_IdenticalVectorsReturnOne(t *testing.T) {
	t.Parallel()
	v := []float32{0.3, -0.1, 0.8, 0.2}
	got := cosine(v, v)
	if math.Abs(float64(got-1)) > 1e-4 {
		t.Fatalf("cosine(v, v) = %f, want ~1.0", got)
	}
}

func TestCosine_OrthogonalVectorsReturnZero(t *testing.T) {
	t.Parallel()
	a := []float32{1, 0, 0, 0}
	b := []float32{0, 1, 0, 0}
	got := cosine(a, b)
	if math.Abs(float64(got)) > 1e-6 {
		t.Fatalf("cosine(a⊥b) = %f, want ~0", got)
	}
}

func TestCosine_OppositeVectorsReturnMinusOne(t *testing.T) {
	t.Parallel()
	a := []float32{0.5, 0.5}
	b := []float32{-0.5, -0.5}
	got := cosine(a, b)
	if math.Abs(float64(got+1)) > 1e-3 {
		t.Fatalf("cosine(a, -a) = %f, want ~-1.0", got)
	}
}

func TestCosine_LengthMismatchReturnsZero(t *testing.T) {
	t.Parallel()
	// Defensive: bge-small always emits fixed-dim vectors, but a corrupted
	// DB row shouldn't crash GetNoteConnections. Zero sim = filtered below
	// the 0.6 threshold → correctly excluded from results.
	if got := cosine([]float32{1, 0, 0}, []float32{1, 0}); got != 0 {
		t.Fatalf("cosine on length-mismatch = %f, want 0", got)
	}
	if got := cosine(nil, []float32{1}); got != 0 {
		t.Fatalf("cosine on nil = %f, want 0", got)
	}
	if got := cosine(nil, nil); got != 0 {
		t.Fatalf("cosine on empty = %f, want 0", got)
	}
}

func TestCosine_ZeroVectorReturnsZero(t *testing.T) {
	t.Parallel()
	// Zero-norm sentinel — bge-small never outputs all-zero vectors in
	// practice (non-empty input → some signal) but defending against it is
	// cheap and prevents NaN propagation downstream.
	if got := cosine([]float32{0, 0, 0}, []float32{1, 1, 1}); got != 0 {
		t.Fatalf("cosine(0, v) = %f, want 0", got)
	}
}

// ─── sqrt32 ────────────────────────────────────────────────────────────────

func TestSqrt32_RoughAccuracy(t *testing.T) {
	t.Parallel()
	// Newton iteration used for ranking — not bit-exact but should be
	// within 0.1% of the true root for the value range we see (sums of
	// squares of unit-norm vectors ≤ dim ≤ 384).
	for _, x := range []float32{0.25, 1, 4, 100, 384} {
		got := sqrt32(x)
		want := float32(math.Sqrt(float64(x)))
		if math.Abs(float64(got-want)/float64(want)) > 1e-3 {
			t.Errorf("sqrt32(%f) = %f, want ~%f", x, got, want)
		}
	}
	if got := sqrt32(0); got != 0 {
		t.Errorf("sqrt32(0) = %f, want 0", got)
	}
	if got := sqrt32(-1); got != 0 {
		t.Errorf("sqrt32(-1) = %f, want 0", got)
	}
}

type fakeNoteRepo struct {
	create func(context.Context, domain.Note) (domain.Note, error)
	update func(context.Context, domain.Note) (domain.Note, error)
	get    func(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error)
	list   func(context.Context, uuid.UUID, int, string, *uuid.UUID) ([]domain.NoteSummary, string, error)
}

func (f fakeNoteRepo) Create(ctx context.Context, n domain.Note) (domain.Note, error) {
	return f.create(ctx, n)
}

func (f fakeNoteRepo) Update(ctx context.Context, n domain.Note) (domain.Note, error) {
	return f.update(ctx, n)
}

func (f fakeNoteRepo) Get(ctx context.Context, userID uuid.UUID, noteID uuid.UUID) (domain.Note, error) {
	if f.get != nil {
		return f.get(ctx, userID, noteID)
	}
	return domain.Note{}, domain.ErrNotFound
}

func (f fakeNoteRepo) List(ctx context.Context, userID uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]domain.NoteSummary, string, error) {
	if f.list != nil {
		return f.list(ctx, userID, limit, cursor, folderID)
	}
	return nil, "", nil
}

func (fakeNoteRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}

func (fakeNoteRepo) Move(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (domain.Note, error) {
	return domain.Note{}, domain.ErrNotFound
}

func (fakeNoteRepo) SetEmbedding(context.Context, uuid.UUID, uuid.UUID, []float32, string, time.Time) error {
	return nil
}

func (fakeNoteRepo) WithEmbeddingsForUser(context.Context, uuid.UUID, string) ([]domain.NoteEmbedding, error) {
	return nil, nil
}

func (fakeNoteRepo) ExistsByTitleForUser(context.Context, uuid.UUID, string) (bool, error) {
	return false, nil
}

func (fakeNoteRepo) MarkStaleForReembed(context.Context, string) (int64, error) {
	return 0, nil
}

func (fakeNoteRepo) SearchSimilarNotes(context.Context, uuid.UUID, []float32, string, uuid.UUID, float32, int) ([]domain.NoteSimilarityHit, error) {
	return nil, nil
}

type noteMemoryHook struct {
	dailySaved int
	noteSaved  int
	body       string
	title      string
}

func (h *noteMemoryHook) OnReflectionAdded(context.Context, uuid.UUID, string, string, int, time.Time) {
}

func (h *noteMemoryHook) OnStandupRecorded(context.Context, uuid.UUID, string, string, string, time.Time) {
}

func (h *noteMemoryHook) OnPlanSkipped(context.Context, uuid.UUID, string, string, time.Time) {}

func (h *noteMemoryHook) OnPlanCompleted(context.Context, uuid.UUID, string, string, time.Time) {
}

func (h *noteMemoryHook) OnNoteCreated(_ context.Context, _ uuid.UUID, _ uuid.UUID, title, body200 string, _ time.Time) {
	h.noteSaved++
	h.title = title
	h.body = body200
}

func (h *noteMemoryHook) OnDailyNoteSaved(_ context.Context, _ uuid.UUID, _ uuid.UUID, title, body600 string, _ time.Time) {
	h.dailySaved++
	h.title = title
	h.body = body600
}

func (h *noteMemoryHook) OnFocusSessionDone(context.Context, uuid.UUID, string, int, string, int, time.Time) {
}

func TestUpdateNoteWritesDailySnapshotToCoachMemory(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	noteID := uuid.New()
	mem := &noteMemoryHook{}
	body := "Today I need to focus on Redis cache invalidation and explain the tradeoffs clearly."
	uc := &UpdateNote{
		Notes: fakeNoteRepo{
			update: func(_ context.Context, n domain.Note) (domain.Note, error) {
				n.ID = noteID
				n.UserID = uid
				return n, nil
			},
		},
		Memory: mem,
		Now:    fixedNow,
	}

	_, err := uc.Do(context.Background(), UpdateNoteInput{
		UserID: uid,
		NoteID: noteID,
		Title:  "Daily 2026-04-28",
		BodyMD: body,
	})
	if err != nil {
		t.Fatalf("UpdateNote.Do: %v", err)
	}
	if mem.dailySaved != 1 {
		t.Fatalf("dailySaved=%d, want 1", mem.dailySaved)
	}
	if mem.noteSaved != 0 {
		t.Fatalf("noteSaved=%d, want 0", mem.noteSaved)
	}
	if mem.body != body {
		t.Fatalf("body=%q, want compact body", mem.body)
	}
}

func TestUpdateNoteDoesNotWriteRegularEditsToCoachMemory(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	mem := &noteMemoryHook{}
	uc := &UpdateNote{
		Notes: fakeNoteRepo{
			update: func(_ context.Context, n domain.Note) (domain.Note, error) {
				return n, nil
			},
		},
		Memory: mem,
		Now:    fixedNow,
	}

	_, err := uc.Do(context.Background(), UpdateNoteInput{
		UserID: uid,
		NoteID: uuid.New(),
		Title:  "Redis notes",
		BodyMD: "cache invalidation",
	})
	if err != nil {
		t.Fatalf("UpdateNote.Do: %v", err)
	}
	if mem.dailySaved != 0 || mem.noteSaved != 0 {
		t.Fatalf("memory writes=%d/%d, want none", mem.dailySaved, mem.noteSaved)
	}
}
