package ports

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	achApp "druz9/achievements/app"
	achDomain "druz9/achievements/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type stubRepo struct{}

func (stubRepo) Get(_ context.Context, _ uuid.UUID, code string) (achDomain.UserAchievement, error) {
	return achDomain.UserAchievement{}, achDomain.ErrNotFound
}
func (stubRepo) List(_ context.Context, _ uuid.UUID) ([]achDomain.UserAchievement, error) {
	return nil, nil
}
func (stubRepo) UpsertProgress(_ context.Context, uid uuid.UUID, code string, p, t int) (achDomain.UserAchievement, bool, error) {
	return achDomain.UserAchievement{UserID: uid, Code: code, Progress: p, Target: t}, false, nil
}
func (stubRepo) Unlock(_ context.Context, uid uuid.UUID, code string, t int) (achDomain.UserAchievement, bool, error) {
	return achDomain.UserAchievement{UserID: uid, Code: code, Progress: t, Target: t}, true, nil
}

func TestHandlerListReturnsCatalogue(t *testing.T) {
	h := NewHandler(Handler{Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		List: &achApp.ListAchievements{Repo: stubRepo{}},
		Get:  &achApp.GetSingle{Repo: stubRepo{}},
	})
	r := chi.NewRouter()
	h.Mount(r)

	req := httptest.NewRequest(http.MethodGet, "/achievements", nil)
	uid := uuid.New()
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var out []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v body=%s", err, rr.Body.String())
	}
	if len(out) == 0 {
		t.Fatalf("expected non-empty list")
	}
}

func TestHandlerListUnauth(t *testing.T) {
	h := NewHandler(Handler{Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		List: &achApp.ListAchievements{Repo: stubRepo{}},
		Get:  &achApp.GetSingle{Repo: stubRepo{}},
	})
	r := chi.NewRouter()
	h.Mount(r)
	req := httptest.NewRequest(http.MethodGet, "/achievements", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestHandlerGet404(t *testing.T) {
	h := NewHandler(Handler{Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		List: &achApp.ListAchievements{Repo: stubRepo{}},
		Get:  &achApp.GetSingle{Repo: stubRepo{}},
	})
	r := chi.NewRouter()
	h.Mount(r)
	req := httptest.NewRequest(http.MethodGet, "/achievements/no-such-code", nil)
	uid := uuid.New()
	req = req.WithContext(sharedMw.WithUserID(req.Context(), uid))
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}
