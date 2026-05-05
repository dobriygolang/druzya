package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ─────────────────────────────────────────────────────────────────
// AddReadingMaterial — input validation
// ─────────────────────────────────────────────────────────────────

func TestAddReadingMaterial_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().CreateMaterial(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.ReadingMaterial) (domain.ReadingMaterial, error) {
			if m.UserID != uid {
				t.Errorf("user_id: got %v want %v", m.UserID, uid)
			}
			if m.Title != "Atomic Habits ch.4" {
				t.Errorf("title not propagated: %q", m.Title)
			}
			m.ID = uuid.New()
			return m, nil
		},
	)
	uc := &AddReadingMaterial{Repo: repo}
	out, err := uc.Do(context.Background(), AddReadingMaterialInput{
		UserID:     uid,
		SourceKind: domain.ReadingSourcePaste,
		Title:      "Atomic Habits ch.4",
		BodyMD:     "# Compound effects\nA habit is a compound...",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.ID == uuid.Nil {
		t.Error("ID should be stamped by repo")
	}
}

func TestAddReadingMaterial_RejectsInvalidInput(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &AddReadingMaterial{Repo: mocks.NewMockReadingRepo(ctrl)}
	cases := []struct {
		name string
		in   AddReadingMaterialInput
	}{
		{"zero user_id", AddReadingMaterialInput{SourceKind: domain.ReadingSourcePaste, Title: "x", BodyMD: "x"}},
		{"invalid source_kind", AddReadingMaterialInput{UserID: uuid.New(), SourceKind: "video", Title: "x", BodyMD: "x"}},
		{"empty title", AddReadingMaterialInput{UserID: uuid.New(), SourceKind: domain.ReadingSourcePaste, Title: "  ", BodyMD: "x"}},
		{"empty body", AddReadingMaterialInput{UserID: uuid.New(), SourceKind: domain.ReadingSourcePaste, Title: "x", BodyMD: ""}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if _, err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestAddReadingMaterial_BodyTooLargeIsRejected(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockReadingRepo(ctrl)
	// gomock will fail on unexpected calls — this validates that CreateMaterial
	// is NOT called when body exceeds the size cap.
	uc := &AddReadingMaterial{Repo: repo}
	huge := make([]byte, 2_000_001) // 2MB + 1
	for i := range huge {
		huge[i] = 'a'
	}
	_, err := uc.Do(context.Background(), AddReadingMaterialInput{
		UserID:     uuid.New(),
		SourceKind: domain.ReadingSourcePaste,
		Title:      "huge",
		BodyMD:     string(huge),
	})
	if err == nil {
		t.Fatal("expected size-cap rejection")
	}
}

// ─────────────────────────────────────────────────────────────────
// Vocab review (SRS) — most complex use case, deserves real coverage
// ─────────────────────────────────────────────────────────────────

func TestReviewVocab_CorrectAdvancesBox(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().AdvanceVocab(gomock.Any(), uid, "compound", true, gomock.Any()).Return(
		domain.VocabEntry{Word: "compound", Box: 2}, nil,
	)
	uc := &ReviewVocab{Repo: repo}
	out, err := uc.Do(context.Background(), ReviewVocabInput{UserID: uid, Word: "compound", Correct: true})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Box != 2 {
		t.Errorf("box round-trip broken: %d", out.Box)
	}
}

func TestReviewVocab_NotFoundPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().AdvanceVocab(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.VocabEntry{}, domain.ErrNotFound,
	)
	uc := &ReviewVocab{Repo: repo}
	_, err := uc.Do(context.Background(), ReviewVocabInput{UserID: uuid.New(), Word: "ghost", Correct: false})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestReviewVocab_RejectsZeroIDsAndEmptyWord(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &ReviewVocab{Repo: mocks.NewMockReadingRepo(ctrl)}
	if _, err := uc.Do(context.Background(), ReviewVocabInput{UserID: uuid.Nil, Word: "x"}); err == nil {
		t.Error("zero user_id must fail")
	}
	if _, err := uc.Do(context.Background(), ReviewVocabInput{UserID: uuid.New(), Word: ""}); err == nil {
		t.Error("empty word must fail")
	}
}

// ─────────────────────────────────────────────────────────────────
// EndReadingSession — grader integration
// ─────────────────────────────────────────────────────────────────

// no-grader path: end the session, reload it, return as-is.
func TestEndReadingSession_NoGrader_ReturnsSession(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().EndSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().GetSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.ReadingSession{ID: sid, UserID: uid, SummaryMD: "ok"}, nil,
	)
	uc := &EndReadingSession{Repo: repo}
	out, err := uc.Do(context.Background(), EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		CharsRead: 10,
		SummaryMD: "ok",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.ID != sid {
		t.Errorf("session id mismatch: %v", out.ID)
	}
	if out.AISummaryScore != nil {
		t.Errorf("score must be nil when no grader: %v", *out.AISummaryScore)
	}
}

// happy grader path: persists score, GetSession reflects it.
func TestEndReadingSession_GraderHappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	mid := uuid.New()
	persisted := 0
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().EndSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	// First GetSession call (just after EndSession) returns w/o score; second
	// after SetAISummaryScore returns with persisted score.
	repo.EXPECT().GetSession(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID) (domain.ReadingSession, error) {
			s := domain.ReadingSession{ID: sid, UserID: uid, MaterialID: mid, SummaryMD: "ok"}
			if persisted > 0 {
				v := persisted
				s.AISummaryScore = &v
			}
			return s, nil
		},
	).AnyTimes()
	repo.EXPECT().GetMaterial(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.ReadingMaterial{ID: mid, UserID: uid, Title: "T", BodyMD: "B"}, nil,
	)
	repo.EXPECT().SetAISummaryScore(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID, score int) error {
			persisted = score
			return nil
		},
	)
	g := mocks.NewMockSummaryGrader(ctrl)
	g.EXPECT().GradeSummary(gomock.Any(), gomock.Any()).Return(78, nil)
	uc := &EndReadingSession{Repo: repo, Grader: g}
	out, err := uc.Do(context.Background(), EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		CharsRead: 10,
		SummaryMD: "user-summary",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if persisted != 78 {
		t.Errorf("persisted score %d != 78", persisted)
	}
	if out.AISummaryScore == nil || *out.AISummaryScore != 78 {
		t.Errorf("returned session.AISummaryScore != 78: %v", out.AISummaryScore)
	}
}

// grader error must NOT fail the use case — session is already persisted.
func TestEndReadingSession_GraderErrorIsSwallowed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().EndSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	// GetSession is called twice: once inside gradeAndPersist, once at the end.
	repo.EXPECT().GetSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.ReadingSession{ID: sid, UserID: uid, SummaryMD: "ok"}, nil,
	).AnyTimes()
	repo.EXPECT().GetMaterial(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.ReadingMaterial{ID: uuid.New(), UserID: uid, BodyMD: "B"}, nil,
	)
	// SetAISummaryScore must NOT be called — gomock auto-fails on unexpected calls.
	g := mocks.NewMockSummaryGrader(ctrl)
	g.EXPECT().GradeSummary(gomock.Any(), gomock.Any()).Return(0, errors.New("provider down"))
	uc := &EndReadingSession{Repo: repo, Grader: g}
	if _, err := uc.Do(context.Background(), EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		SummaryMD: "user-summary",
	}); err != nil {
		t.Fatalf("must not propagate grader error: %v", err)
	}
}

// empty summary: grader is skipped (no point grading nothing).
func TestEndReadingSession_EmptySummarySkipsGrader(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	sid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().EndSession(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().GetSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.ReadingSession{ID: sid, UserID: uid}, nil,
	)
	g := mocks.NewMockSummaryGrader(ctrl)
	// grader.EXPECT().GradeSummary is intentionally NOT set — gomock will fail
	// if grader is called for an empty summary, validating the skip behavior.
	uc := &EndReadingSession{Repo: repo, Grader: g}
	if _, err := uc.Do(context.Background(), EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		SummaryMD: "   ",
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────
// AddVocab idempotency — caller relies on UpsertVocab not resetting
// the box on re-click. Use case mirrors that contract.
// ─────────────────────────────────────────────────────────────────

func TestAddVocab_PassesThroughToUpsert(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockReadingRepo(ctrl)
	repo.EXPECT().UpsertVocab(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e domain.VocabEntry) (domain.VocabEntry, error) {
			if e.UserID != uid || e.Word != "compound" {
				t.Errorf("not propagated: %+v", e)
			}
			return e, nil
		},
	)
	uc := &AddVocab{Repo: repo}
	out, err := uc.Do(context.Background(), domain.VocabEntry{
		UserID: uid,
		Word:   "compound",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Word != "compound" {
		t.Error("round-trip broken")
	}
}

// _ silences unused import in non-vocab tests
var _ = time.Second
