package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ── fakes ────────────────────────────────────────────────────────────────

type fakeInterviewSessionRepo struct {
	rows []domain.InterviewSession
}

func (r *fakeInterviewSessionRepo) Insert(_ context.Context, in domain.InterviewSession) (domain.InterviewSession, error) {
	in.ID = uuid.New()
	r.rows = append(r.rows, in)
	return in, nil
}

func (r *fakeInterviewSessionRepo) ListByUser(_ context.Context, userID uuid.UUID, limit, offset int) ([]domain.InterviewSession, int, error) {
	all := make([]domain.InterviewSession, 0, len(r.rows))
	for _, row := range r.rows {
		if row.UserID == userID {
			all = append(all, row)
		}
	}
	total := len(all)
	// Naive paging — caller validates bounds.
	if offset >= total {
		return nil, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return all[offset:end], total, nil
}

type fakeMemoryWriter struct {
	calls []AppendInput
}

func (m *fakeMemoryWriter) AppendAsync(_ context.Context, in AppendInput) {
	m.calls = append(m.calls, in)
}

// ── IngestSessionTranscript ─────────────────────────────────────────────

func TestIngestSessionTranscript_HappyPath(t *testing.T) {
	uid := uuid.New()
	repo := &fakeInterviewSessionRepo{}
	mem := &fakeMemoryWriter{}
	uc := IngestSessionTranscript{
		Repo:   repo,
		Memory: mem,
		Now:    func() time.Time { return time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), IngestInterviewSessionInput{
		UserID:    uid,
		Company:   "Google",
		Persona:   "sysdesign guru",
		Stages:    []domain.InterviewStage{{Stage: "sysdesign", SelfRating: 3, Notes: "struggled with sharding"}},
		AISummary: "Sysdesign round at Google — sharding rough.",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.ID == uuid.Nil {
		t.Fatal("missing id on saved row")
	}
	if !out.CompletedAt.Equal(time.Date(2026, 5, 12, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("CompletedAt not stamped from Now: %v", out.CompletedAt)
	}
	if len(mem.calls) != 1 {
		t.Fatalf("expected 1 memory call, got %d", len(mem.calls))
	}
	got := mem.calls[0]
	if got.Kind != domain.EpisodeCueSession {
		t.Fatalf("wrong episode kind: %q", got.Kind)
	}
	if !strings.Contains(got.Summary, "sharding") {
		t.Fatalf("summary should reflect ai_summary, got %q", got.Summary)
	}
}

func TestIngestSessionTranscript_RespectsExplicitCompletedAt(t *testing.T) {
	uid := uuid.New()
	when := time.Date(2026, 5, 11, 18, 30, 0, 0, time.UTC)
	repo := &fakeInterviewSessionRepo{}
	uc := IngestSessionTranscript{Repo: repo}
	out, err := uc.Do(context.Background(), IngestInterviewSessionInput{
		UserID:      uid,
		Company:     "Yandex",
		CompletedAt: when,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !out.CompletedAt.Equal(when) {
		t.Fatalf("CompletedAt overridden: want %v got %v", when, out.CompletedAt)
	}
}

func TestIngestSessionTranscript_NilMemoryIsSafe(t *testing.T) {
	repo := &fakeInterviewSessionRepo{}
	uc := IngestSessionTranscript{Repo: repo} // Memory nil
	_, err := uc.Do(context.Background(), IngestInterviewSessionInput{
		UserID:  uuid.New(),
		Company: "Meta",
	})
	if err != nil {
		t.Fatalf("nil memory must not block ingest: %v", err)
	}
	if len(repo.rows) != 1 {
		t.Fatal("row must still be persisted")
	}
}

func TestIngestSessionTranscript_ValidationErrors(t *testing.T) {
	uc := IngestSessionTranscript{Repo: &fakeInterviewSessionRepo{}}
	cases := []struct {
		name string
		in   IngestInterviewSessionInput
	}{
		{"zero user_id", IngestInterviewSessionInput{Company: "X"}},
		{"empty everything", IngestInterviewSessionInput{UserID: uuid.New()}},
		{
			"stage with empty name",
			IngestInterviewSessionInput{
				UserID: uuid.New(),
				Stages: []domain.InterviewStage{{Stage: "", SelfRating: 2}},
			},
		},
		{
			"self_rating out of range",
			IngestInterviewSessionInput{
				UserID: uuid.New(),
				Stages: []domain.InterviewStage{{Stage: "algo", SelfRating: 9}},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := uc.Do(context.Background(), tc.in)
			if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestInterviewSessionSummaryFallback(t *testing.T) {
	s := domain.InterviewSession{Company: "Tinkoff", Persona: "algo coach"}
	if !strings.Contains(cueSessionSummary(s), "Tinkoff") {
		t.Fatal("expected fallback summary to mention company")
	}
}

// ── ListInterviewSessions ─────────────────────────────────────────────────────

func TestListInterviewSessions_HappyPath(t *testing.T) {
	uid := uuid.New()
	other := uuid.New()
	repo := &fakeInterviewSessionRepo{
		rows: []domain.InterviewSession{
			{UserID: uid, Company: "A"},
			{UserID: uid, Company: "B"},
			{UserID: other, Company: "C"},
		},
	}
	uc := ListInterviewSessions{Repo: repo}
	out, err := uc.Do(context.Background(), ListInterviewSessionsInput{UserID: uid})
	if err != nil {
		t.Fatal(err)
	}
	if out.Total != 2 || len(out.Items) != 2 {
		t.Fatalf("expected 2 rows for user, got total=%d items=%d", out.Total, len(out.Items))
	}
}

func TestListInterviewSessions_NormalisesLimits(t *testing.T) {
	uid := uuid.New()
	repo := &fakeInterviewSessionRepo{}
	for i := 0; i < 5; i++ {
		repo.rows = append(repo.rows, domain.InterviewSession{UserID: uid})
	}
	uc := ListInterviewSessions{Repo: repo}
	// limit=0 → default 20 (gets all 5)
	out, err := uc.Do(context.Background(), ListInterviewSessionsInput{UserID: uid, Limit: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 5 {
		t.Fatalf("expected 5 items with default limit, got %d", len(out.Items))
	}
	// limit > 100 capped, won't panic with our fake's small dataset
	out, err = uc.Do(context.Background(), ListInterviewSessionsInput{UserID: uid, Limit: 500})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 5 {
		t.Fatalf("cap should still allow returning all 5, got %d", len(out.Items))
	}
}

func TestListInterviewSessions_ZeroUserID(t *testing.T) {
	uc := ListInterviewSessions{Repo: &fakeInterviewSessionRepo{}}
	if _, err := uc.Do(context.Background(), ListInterviewSessionsInput{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
