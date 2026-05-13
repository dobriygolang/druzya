package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/intelligence/domain"
	mocks "druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── interview session store + wire ───────────────────────────────────────

type interviewSessStore struct {
	mu   sync.Mutex
	rows []domain.InterviewSession
}

func wireMockInterviewSessionRepo(ctrl *gomock.Controller, s *interviewSessStore) *mocks.MockInterviewSessionRepo {
	m := mocks.NewMockInterviewSessionRepo(ctrl)
	m.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.InterviewSession) (domain.InterviewSession, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			in.ID = uuid.New()
			s.rows = append(s.rows, in)
			return in, nil
		},
	).AnyTimes()
	m.EXPECT().ListByUser(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID, limit, offset int) ([]domain.InterviewSession, int, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			all := make([]domain.InterviewSession, 0, len(s.rows))
			for _, row := range s.rows {
				if row.UserID == userID {
					all = append(all, row)
				}
			}
			total := len(all)
			if offset >= total {
				return nil, total, nil
			}
			end := offset + limit
			if end > total {
				end = total
			}
			return all[offset:end], total, nil
		},
	).AnyTimes()
	return m
}

// ── memoryWriter mock with capture ──────────────────────────────────────

type memoryWriterTap struct {
	mu    sync.Mutex
	calls []AppendInput
}

func wireMockMemoryWriter(ctrl *gomock.Controller, tap *memoryWriterTap) *MockMemoryWriter {
	m := NewMockMemoryWriter(ctrl)
	m.EXPECT().AppendAsync(gomock.Any(), gomock.Any()).Do(
		func(_ context.Context, in AppendInput) {
			tap.mu.Lock()
			defer tap.mu.Unlock()
			tap.calls = append(tap.calls, in)
		},
	).AnyTimes()
	return m
}

// ── IngestSessionTranscript ─────────────────────────────────────────────

func TestIngestSessionTranscript_HappyPath(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	repo := &interviewSessStore{}
	memTap := &memoryWriterTap{}
	uc := IngestSessionTranscript{
		Repo:   wireMockInterviewSessionRepo(ctrl, repo),
		Memory: wireMockMemoryWriter(ctrl, memTap),
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
	memTap.mu.Lock()
	defer memTap.mu.Unlock()
	if len(memTap.calls) != 1 {
		t.Fatalf("expected 1 memory call, got %d", len(memTap.calls))
	}
	got := memTap.calls[0]
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
	ctrl := gomock.NewController(t)
	repo := &interviewSessStore{}
	uc := IngestSessionTranscript{Repo: wireMockInterviewSessionRepo(ctrl, repo)}
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
	ctrl := gomock.NewController(t)
	repo := &interviewSessStore{}
	uc := IngestSessionTranscript{Repo: wireMockInterviewSessionRepo(ctrl, repo)} // Memory nil
	_, err := uc.Do(context.Background(), IngestInterviewSessionInput{
		UserID:  uuid.New(),
		Company: "Meta",
	})
	if err != nil {
		t.Fatalf("nil memory must not block ingest: %v", err)
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.rows) != 1 {
		t.Fatal("row must still be persisted")
	}
}

func TestIngestSessionTranscript_ValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := IngestSessionTranscript{Repo: wireMockInterviewSessionRepo(ctrl, &interviewSessStore{})}
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
	ctrl := gomock.NewController(t)
	repo := &interviewSessStore{
		rows: []domain.InterviewSession{
			{UserID: uid, Company: "A"},
			{UserID: uid, Company: "B"},
			{UserID: other, Company: "C"},
		},
	}
	uc := ListInterviewSessions{Repo: wireMockInterviewSessionRepo(ctrl, repo)}
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
	ctrl := gomock.NewController(t)
	repo := &interviewSessStore{}
	for i := 0; i < 5; i++ {
		repo.rows = append(repo.rows, domain.InterviewSession{UserID: uid})
	}
	uc := ListInterviewSessions{Repo: wireMockInterviewSessionRepo(ctrl, repo)}
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
	ctrl := gomock.NewController(t)
	uc := ListInterviewSessions{Repo: wireMockInterviewSessionRepo(ctrl, &interviewSessStore{})}
	if _, err := uc.Do(context.Background(), ListInterviewSessionsInput{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
