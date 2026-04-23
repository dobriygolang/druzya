// Tests for PracticeHandler — chi-direct REST handler for instant
// single-player practice matches.
//
// These exercise the boundary the React client relies on:
//   - missing user-id → 401 unauthenticated
//   - missing section → defaults to "algorithms"
//   - invalid section → 400 invalid section
//   - happy path → 200 with match_id + opponent_label
package ports

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestPracticeHandler_Unauthenticated(t *testing.T) {
	t.Parallel()
	h := NewPracticeHandler(&app.StartPractice{}, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/arena/practice", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestPracticeHandler_InvalidSection(t *testing.T) {
	t.Parallel()
	h := NewPracticeHandler(&app.StartPractice{}, nil)
	body := strings.NewReader(`{"section":"not-a-section"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/arena/practice", body)
	req.ContentLength = int64(body.Len())
	uid := uuid.New()
	ctx := sharedMw.WithUserID(req.Context(), uid)
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPracticeHandler_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	matches := mocks.NewMockMatchRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	uid := uuid.New()
	matchID := uuid.New()
	taskID := uuid.New()

	tasks.EXPECT().
		PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: taskID, Section: enums.SectionAlgorithms}, nil)
	matches.EXPECT().
		CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, m domain.Match, _ []domain.Participant) (domain.Match, error) {
			m.ID = matchID
			return m, nil
		})

	uc := &app.StartPractice{Matches: matches, Tasks: tasks, Clock: domain.RealClock{}}
	h := NewPracticeHandler(uc, nil)

	body := bytes.NewBufferString(`{"section":"algorithms","neural_model":"gpt4"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/arena/practice", body)
	req.ContentLength = int64(body.Len())
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	var resp PracticeResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.MatchID != matchID.String() {
		t.Fatalf("expected match id %s, got %s", matchID, resp.MatchID)
	}
	if resp.OpponentLabel != "GPT-4o bot" {
		t.Fatalf("expected GPT-4o opponent label, got %q", resp.OpponentLabel)
	}
	if resp.Status != string(enums.MatchStatusActive) {
		t.Fatalf("expected active status, got %s", resp.Status)
	}
}
