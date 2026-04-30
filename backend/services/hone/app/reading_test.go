package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// fakeReadingRepo — hand-rolled fake (no mockgen for ReadingRepo,
// matches the rest of the Hone test suite). Each closure satisfies
// one method; nil = «test will fail loudly when this surface is hit».
type fakeReadingRepo struct {
	create            func(context.Context, domain.ReadingMaterial) (domain.ReadingMaterial, error)
	get               func(context.Context, uuid.UUID, uuid.UUID) (domain.ReadingMaterial, error)
	list              func(context.Context, uuid.UUID, int) ([]domain.ReadingMaterial, error)
	archive           func(context.Context, uuid.UUID, uuid.UUID, time.Time) error
	startSess         func(context.Context, uuid.UUID, uuid.UUID) (domain.ReadingSession, error)
	endSess           func(context.Context, uuid.UUID, uuid.UUID, int, string, time.Time) error
	getSess           func(context.Context, uuid.UUID, uuid.UUID) (domain.ReadingSession, error)
	setScore          func(context.Context, uuid.UUID, uuid.UUID, int) error
	listVocab         func(context.Context, uuid.UUID, time.Time, int) ([]domain.VocabEntry, error)
	upsertVoc         func(context.Context, domain.VocabEntry) (domain.VocabEntry, error)
	advanceVoc        func(context.Context, uuid.UUID, string, bool, time.Time) (domain.VocabEntry, error)
	listVocabBySource func(context.Context, uuid.UUID, uuid.UUID, int) ([]domain.VocabEntry, error)
}

func (f fakeReadingRepo) CreateMaterial(ctx context.Context, m domain.ReadingMaterial) (domain.ReadingMaterial, error) {
	return f.create(ctx, m)
}

func (f fakeReadingRepo) GetMaterial(ctx context.Context, u, m uuid.UUID) (domain.ReadingMaterial, error) {
	return f.get(ctx, u, m)
}

func (f fakeReadingRepo) ListMaterials(ctx context.Context, u uuid.UUID, l int) ([]domain.ReadingMaterial, error) {
	return f.list(ctx, u, l)
}

func (f fakeReadingRepo) ArchiveMaterial(ctx context.Context, u, m uuid.UUID, n time.Time) error {
	return f.archive(ctx, u, m, n)
}

func (f fakeReadingRepo) StartSession(ctx context.Context, u, m uuid.UUID) (domain.ReadingSession, error) {
	return f.startSess(ctx, u, m)
}

func (f fakeReadingRepo) EndSession(ctx context.Context, u, s uuid.UUID, c int, sm string, n time.Time) error {
	return f.endSess(ctx, u, s, c, sm, n)
}

func (f fakeReadingRepo) GetSession(ctx context.Context, u, s uuid.UUID) (domain.ReadingSession, error) {
	return f.getSess(ctx, u, s)
}

func (f fakeReadingRepo) SetAISummaryScore(ctx context.Context, u, s uuid.UUID, score int) error {
	return f.setScore(ctx, u, s, score)
}

func (f fakeReadingRepo) ListVocabDue(ctx context.Context, u uuid.UUID, n time.Time, l int) ([]domain.VocabEntry, error) {
	return f.listVocab(ctx, u, n, l)
}

func (f fakeReadingRepo) UpsertVocab(ctx context.Context, e domain.VocabEntry) (domain.VocabEntry, error) {
	return f.upsertVoc(ctx, e)
}

func (f fakeReadingRepo) AdvanceVocab(ctx context.Context, u uuid.UUID, w string, c bool, n time.Time) (domain.VocabEntry, error) {
	return f.advanceVoc(ctx, u, w, c, n)
}

func (f fakeReadingRepo) ListVocabBySourceMaterial(ctx context.Context, u, m uuid.UUID, l int) ([]domain.VocabEntry, error) {
	if f.listVocabBySource == nil {
		return nil, nil
	}
	return f.listVocabBySource(ctx, u, m, l)
}

// ─────────────────────────────────────────────────────────────────
// AddReadingMaterial — input validation
// ─────────────────────────────────────────────────────────────────

func TestAddReadingMaterial_HappyPath(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	repo := fakeReadingRepo{
		create: func(_ context.Context, m domain.ReadingMaterial) (domain.ReadingMaterial, error) {
			if m.UserID != uid {
				t.Errorf("user_id: got %v want %v", m.UserID, uid)
			}
			if m.Title != "Atomic Habits ch.4" {
				t.Errorf("title not propagated: %q", m.Title)
			}
			m.ID = uuid.New()
			return m, nil
		},
	}
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
	uc := &AddReadingMaterial{Repo: fakeReadingRepo{}}
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
	repo := fakeReadingRepo{
		create: func(_ context.Context, _ domain.ReadingMaterial) (domain.ReadingMaterial, error) {
			t.Fatal("repo must not be called when body exceeds cap")
			return domain.ReadingMaterial{}, nil
		},
	}
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
	uid := uuid.New()
	repo := fakeReadingRepo{
		advanceVoc: func(_ context.Context, u uuid.UUID, w string, correct bool, _ time.Time) (domain.VocabEntry, error) {
			if u != uid || w != "compound" || !correct {
				t.Errorf("args mismatch: %v %q %v", u, w, correct)
			}
			return domain.VocabEntry{Word: w, Box: 2}, nil
		},
	}
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
	repo := fakeReadingRepo{
		advanceVoc: func(_ context.Context, _ uuid.UUID, _ string, _ bool, _ time.Time) (domain.VocabEntry, error) {
			return domain.VocabEntry{}, domain.ErrNotFound
		},
	}
	uc := &ReviewVocab{Repo: repo}
	_, err := uc.Do(context.Background(), ReviewVocabInput{UserID: uuid.New(), Word: "ghost", Correct: false})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestReviewVocab_RejectsZeroIDsAndEmptyWord(t *testing.T) {
	t.Parallel()
	uc := &ReviewVocab{Repo: fakeReadingRepo{}}
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

type fakeGrader struct {
	score int
	err   error
	calls int
}

func (g *fakeGrader) GradeSummary(_ context.Context, _ domain.GradeSummaryInput) (int, error) {
	g.calls++
	return g.score, g.err
}

// no-grader path: end the session, reload it, return as-is.
func TestEndReadingSession_NoGrader_ReturnsSession(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	sid := uuid.New()
	repo := fakeReadingRepo{
		endSess: func(_ context.Context, _, _ uuid.UUID, _ int, _ string, _ time.Time) error { return nil },
		getSess: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingSession, error) {
			return domain.ReadingSession{ID: sid, UserID: uid, SummaryMD: "ok"}, nil
		},
	}
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
	uid := uuid.New()
	sid := uuid.New()
	mid := uuid.New()
	persisted := 0
	repo := fakeReadingRepo{
		endSess: func(_ context.Context, _, _ uuid.UUID, _ int, _ string, _ time.Time) error { return nil },
		getSess: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingSession, error) {
			s := domain.ReadingSession{ID: sid, UserID: uid, MaterialID: mid, SummaryMD: "ok"}
			if persisted > 0 {
				v := persisted
				s.AISummaryScore = &v
			}
			return s, nil
		},
		get: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingMaterial, error) {
			return domain.ReadingMaterial{ID: mid, UserID: uid, Title: "T", BodyMD: "B"}, nil
		},
		setScore: func(_ context.Context, _, _ uuid.UUID, score int) error {
			persisted = score
			return nil
		},
	}
	g := &fakeGrader{score: 78}
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
	if g.calls != 1 {
		t.Errorf("grader expected 1 call, got %d", g.calls)
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
	uid := uuid.New()
	sid := uuid.New()
	repo := fakeReadingRepo{
		endSess: func(_ context.Context, _, _ uuid.UUID, _ int, _ string, _ time.Time) error { return nil },
		getSess: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingSession, error) {
			return domain.ReadingSession{ID: sid, UserID: uid, SummaryMD: "ok"}, nil
		},
		get: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingMaterial, error) {
			return domain.ReadingMaterial{ID: uuid.New(), UserID: uid, BodyMD: "B"}, nil
		},
		setScore: func(_ context.Context, _, _ uuid.UUID, _ int) error {
			t.Fatal("setScore must not be called when grader errors")
			return nil
		},
	}
	g := &fakeGrader{err: errors.New("provider down")}
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
	uid := uuid.New()
	sid := uuid.New()
	repo := fakeReadingRepo{
		endSess: func(_ context.Context, _, _ uuid.UUID, _ int, _ string, _ time.Time) error { return nil },
		getSess: func(_ context.Context, _, _ uuid.UUID) (domain.ReadingSession, error) {
			return domain.ReadingSession{ID: sid, UserID: uid}, nil
		},
	}
	g := &fakeGrader{score: 50}
	uc := &EndReadingSession{Repo: repo, Grader: g}
	if _, err := uc.Do(context.Background(), EndReadingSessionInput{
		UserID:    uid,
		SessionID: sid,
		SummaryMD: "   ",
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if g.calls != 0 {
		t.Errorf("grader must be skipped for empty summary; calls=%d", g.calls)
	}
}

// ─────────────────────────────────────────────────────────────────
// AddVocab idempotency — caller relies on UpsertVocab not resetting
// the box on re-click. Use case mirrors that contract.
// ─────────────────────────────────────────────────────────────────

func TestAddVocab_PassesThroughToUpsert(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	repo := fakeReadingRepo{
		upsertVoc: func(_ context.Context, e domain.VocabEntry) (domain.VocabEntry, error) {
			if e.UserID != uid || e.Word != "compound" {
				t.Errorf("not propagated: %+v", e)
			}
			return e, nil
		},
	}
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
