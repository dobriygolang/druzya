// Tests for the GET /api/v1/arena/matches/my chi handler. The handler is
// thin — it parses query string + auth, defers everything else to the use
// case — so coverage focuses on parsing edge cases and the JSON envelope
// shape that the frontend depends on.
package ports

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// newHistoryHandler wires a handler against a fresh MatchRepo mock.
func newHistoryHandler(t *testing.T) (http.HandlerFunc, *mocks.MockMatchRepo) {
	t.Helper()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uc := &app.GetMyMatches{Matches: repo}
	return MyMatchesHandler(uc), repo
}

func TestArenaServer_GetMyMatches_Unauthenticated(t *testing.T) {
	t.Parallel()
	h, _ := newHistoryHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/arena/matches/my", nil)
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", rr.Code)
	}
}

func TestArenaServer_GetMyMatches_Happy(t *testing.T) {
	t.Parallel()
	h, repo := newHistoryHandler(t)
	uid := uuid.New()
	mid := uuid.New()
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaMode(""), enums.Section("")).
		Return([]domain.MatchHistoryEntry{
			{
				MatchID:          mid,
				Mode:             enums.ArenaModeSolo1v1,
				Section:          enums.SectionAlgorithms,
				OpponentUserID:   uuid.New(),
				OpponentUsername: "opp",
				Result:           domain.MatchResultWin,
				LPChange:         15,
				DurationSeconds:  240,
			},
		}, 1, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/arena/matches/my", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	h(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var got GetMyMatchesResponseDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Total != 1 || len(got.Items) != 1 {
		t.Fatalf("got %+v", got)
	}
	it := got.Items[0]
	if it.MatchID != mid.String() || it.Result != "win" || it.LPChange != 15 {
		t.Fatalf("entry=%+v", it)
	}
	if it.Mode != string(enums.ArenaModeSolo1v1) {
		t.Fatalf("mode=%q", it.Mode)
	}
}

func TestArenaServer_GetMyMatches_WithFilters(t *testing.T) {
	t.Parallel()
	h, repo := newHistoryHandler(t)
	uid := uuid.New()
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 50, 100, enums.ArenaModeRanked, enums.SectionGo).
		Return([]domain.MatchHistoryEntry{}, 0, nil)

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/arena/matches/my?limit=50&offset=100&mode=ranked&section=go", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestArenaServer_GetMyMatches_LimitClamp(t *testing.T) {
	t.Parallel()
	h, repo := newHistoryHandler(t)
	uid := uuid.New()
	// limit=9999 → server clamps to HistoryMaxLimit before hitting the repo.
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, domain.HistoryMaxLimit, 0, enums.ArenaMode(""), enums.Section("")).
		Return([]domain.MatchHistoryEntry{}, 0, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/arena/matches/my?limit=9999", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d", rr.Code)
	}
}

func TestArenaServer_GetMyMatches_InvalidMode(t *testing.T) {
	t.Parallel()
	h, _ := newHistoryHandler(t)
	uid := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/arena/matches/my?mode=bogus", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

func TestArenaServer_GetMyMatches_InvalidLimitNonNumeric(t *testing.T) {
	t.Parallel()
	h, _ := newHistoryHandler(t)
	uid := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/arena/matches/my?limit=abc", nil)
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	h(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
}

// ── domain.ResultFor edge cases (cross-checked here so the handler test
// suite catches drift between the wire payload and the projection logic).

func TestResultFor_StatusCancelledIsAbandoned(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	if got := domain.ResultFor(uid, &uid, enums.MatchStatusCancelled); got != "abandoned" {
		t.Fatalf("got %q", got)
	}
}

func TestResultFor_NoWinnerOnFinishedIsDraw(t *testing.T) {
	t.Parallel()
	if got := domain.ResultFor(uuid.New(), nil, enums.MatchStatusFinished); got != "draw" {
		t.Fatalf("got %q", got)
	}
}

func TestResultFor_WinnerMatchesUserIsWin(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	if got := domain.ResultFor(uid, &uid, enums.MatchStatusFinished); got != "win" {
		t.Fatalf("got %q", got)
	}
}

func TestResultFor_WinnerOtherIsLoss(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	other := uuid.New()
	if got := domain.ResultFor(uid, &other, enums.MatchStatusFinished); got != "loss" {
		t.Fatalf("got %q", got)
	}
}
