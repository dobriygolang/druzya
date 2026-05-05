package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestRecordStandup_CreatesNoteAndPatchesPlan(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	planDate := time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC)

	notes := mocks.NewMockNoteRepo(ctrl)
	createdNote := domain.Note{}
	notes.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, n domain.Note) (domain.Note, error) {
			n.ID = uuid.New()
			n.CreatedAt = time.Now()
			n.UpdatedAt = time.Now()
			createdNote = n
			return n, nil
		},
	)

	plans := mocks.NewMockPlanRepo(ctrl)
	plans.EXPECT().GetForDate(gomock.Any(), uid, gomock.Any()).Return(domain.Plan{
		Date:  planDate,
		Items: []domain.PlanItem{{ID: "existing", Title: "foo"}},
	}, nil)
	var upserted domain.Plan
	plans.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.Plan) (domain.Plan, error) {
			upserted = p
			return p, nil
		},
	)

	uc := &RecordStandup{
		Notes: notes,
		Plans: plans,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:   func() time.Time { return time.Date(2026, 4, 25, 9, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), RecordStandupInput{
		UserID:    uid,
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
	if !strings.Contains(createdNote.BodyMD, "## Yesterday") || !strings.Contains(createdNote.BodyMD, "Ship resistance tracker") {
		t.Errorf("body missing sections: %q", createdNote.BodyMD)
	}
	if len(upserted.Items) != 2 {
		t.Errorf("expected plan to have 2 items after patch, got %d", len(upserted.Items))
	}
	if upserted.Items[1].Kind != domain.PlanItemCustom {
		t.Errorf("new item kind = %v, want custom", upserted.Items[1].Kind)
	}
}

func TestRecordStandup_EmptyInputRejected(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &RecordStandup{
		Notes: mocks.NewMockNoteRepo(ctrl),
		Plans: mocks.NewMockPlanRepo(ctrl),
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
	ctrl := gomock.NewController(t)
	notes := mocks.NewMockNoteRepo(ctrl)
	notes.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, n domain.Note) (domain.Note, error) {
			n.ID = uuid.New()
			return n, nil
		},
	)
	plans := mocks.NewMockPlanRepo(ctrl)
	plans.EXPECT().GetForDate(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.Plan{}, domain.ErrNotFound)
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
