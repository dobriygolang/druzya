package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── fakes ─────────────────────────────────────────────────────────────────

type fakeNotes struct {
	mu       sync.Mutex
	created  []domain.Note
	createFn func(domain.Note) (domain.Note, error)
}

func (f *fakeNotes) Create(_ context.Context, n domain.Note) (domain.Note, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createFn != nil {
		n, err := f.createFn(n)
		if err != nil {
			return domain.Note{}, err
		}
		f.created = append(f.created, n)
		return n, nil
	}
	n.ID = uuid.New()
	n.CreatedAt = time.Now()
	n.UpdatedAt = time.Now()
	f.created = append(f.created, n)
	return n, nil
}
func (f *fakeNotes) Update(context.Context, domain.Note) (domain.Note, error) {
	return domain.Note{}, errors.New("unused")
}
func (f *fakeNotes) Get(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error) {
	return domain.Note{}, errors.New("unused")
}
func (f *fakeNotes) List(context.Context, uuid.UUID, int, string) ([]domain.NoteSummary, string, error) {
	return nil, "", nil
}
func (f *fakeNotes) Delete(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (f *fakeNotes) SetEmbedding(context.Context, uuid.UUID, uuid.UUID, []float32, string, time.Time) error {
	return nil
}
func (f *fakeNotes) WithEmbeddingsForUser(context.Context, uuid.UUID) ([]domain.NoteEmbedding, error) {
	return nil, nil
}

type standupFakePlans struct {
	plan     domain.Plan
	getErr   error
	upserted domain.Plan
}

func (f *standupFakePlans) GetForDate(context.Context, uuid.UUID, time.Time) (domain.Plan, error) {
	if f.getErr != nil {
		return domain.Plan{}, f.getErr
	}
	return f.plan, nil
}
func (f *standupFakePlans) Upsert(_ context.Context, p domain.Plan) (domain.Plan, error) {
	f.upserted = p
	return p, nil
}
func (f *standupFakePlans) PatchItem(context.Context, uuid.UUID, time.Time, string, bool, bool) (domain.Plan, error) {
	return domain.Plan{}, nil
}

// ─── tests ─────────────────────────────────────────────────────────────────

func TestRecordStandup_CreatesNoteAndPatchesPlan(t *testing.T) {
	t.Parallel()
	notes := &fakeNotes{}
	plans := &standupFakePlans{
		plan: domain.Plan{
			Date:  time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC),
			Items: []domain.PlanItem{{ID: "existing", Title: "foo"}},
		},
	}
	uc := &RecordStandup{
		Notes: notes,
		Plans: plans,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:   func() time.Time { return time.Date(2026, 4, 25, 9, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), RecordStandupInput{
		UserID:    uuid.New(),
		Yesterday: "Finished streak reconciler",
		Today:     "Ship resistance tracker",
		Blockers:  "none",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.Note.Title != "Standup 2026-04-25" {
		t.Errorf("title = %q", out.Note.Title)
	}
	if !strings.Contains(out.Note.BodyMD, "## Yesterday") || !strings.Contains(out.Note.BodyMD, "Ship resistance tracker") {
		t.Errorf("body missing sections: %q", out.Note.BodyMD)
	}
	if len(plans.upserted.Items) != 2 {
		t.Errorf("expected plan to have 2 items after patch, got %d", len(plans.upserted.Items))
	}
	if plans.upserted.Items[1].Kind != domain.PlanItemCustom {
		t.Errorf("new item kind = %v, want custom", plans.upserted.Items[1].Kind)
	}
}

func TestRecordStandup_EmptyInputRejected(t *testing.T) {
	t.Parallel()
	uc := &RecordStandup{
		Notes: &fakeNotes{},
		Plans: &standupFakePlans{},
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:   time.Now,
	}
	_, err := uc.Do(context.Background(), RecordStandupInput{UserID: uuid.New()})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("want ErrInvalidInput, got %v", err)
	}
}

func TestRecordStandup_NoPlanYet_ReturnsNoteOnly(t *testing.T) {
	t.Parallel()
	notes := &fakeNotes{}
	plans := &standupFakePlans{getErr: domain.ErrNotFound}
	uc := &RecordStandup{
		Notes: notes,
		Plans: plans,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:   time.Now,
	}
	out, err := uc.Do(context.Background(), RecordStandupInput{
		UserID:    uuid.New(),
		Yesterday: "x",
		Today:     "y",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.Note.Title == "" {
		t.Errorf("expected a note even without plan")
	}
	if !out.Plan.Date.IsZero() {
		t.Errorf("expected zero-value plan, got %+v", out.Plan.Date)
	}
}
