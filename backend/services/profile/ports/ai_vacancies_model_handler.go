// ai_vacancies_model_handler.go — chi-direct handlers for
// GET + PUT /api/v1/profile/me/ai-vacancies-model.
//
// This setting is intentionally outside the Connect/transcoder mux
// (same pattern as atlas_allocate_handler.go): forcing a proto regen
// across every service binary for a single string toggle is not worth
// it. The paired GET endpoint is also what lets the Vacancies page show
// the user's currently chosen model without the fragile "seed from
// empty, hope the PUT response roundtrips" shortcut ai_insight_model
// uses on the frontend.
//
// Wire format:
//
//	GET  →  { "model_id": "qwen/qwen3-coder:free" }
//	PUT  ←  { "model_id": "qwen/qwen3-coder:free" }   (empty = "use server default")
//	PUT  →  { "model_id": "qwen/qwen3-coder:free" }
//
// Premium-tier validation is deliberately NOT done here: the extractor
// workload (short strict-JSON) is cheap enough that we don't gate by
// tier today. If we add a paid-model gate later it goes in UpdateSettings
// alongside the insight-model one.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"druz9/profile/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// AIVacanciesModelHandler exposes GET + PUT /profile/me/ai-vacancies-model.
// Repo is the narrow read/write surface we need; we intentionally don't
// reuse the full profile.ProfileRepo because half its methods are
// unrelated (reports, atlas, etc.) and the vacancies-settings wirer
// shouldn't have to depend on them.
type AIVacanciesModelHandler struct {
	Repo AIVacanciesModelRepo
	Log  *slog.Logger
}

// AIVacanciesModelRepo is the narrow persistence contract for the
// per-user ai_vacancies_model setting. Implementations must treat empty
// string as "no preference set" — both on read (return "") and on write
// (store SQL NULL via NULLIF). The vacancies module consumes this via
// a thin adapter in cmd/monolith/services/vacancies.go.
type AIVacanciesModelRepo interface {
	GetVacanciesModel(ctx context.Context, userID uuid.UUID) (string, error)
	SetVacanciesModel(ctx context.Context, userID uuid.UUID, modelID string) error
}

// NewAIVacanciesModelHandler validates deps. Anti-fallback: nil panics.
func NewAIVacanciesModelHandler(repo AIVacanciesModelRepo, log *slog.Logger) *AIVacanciesModelHandler {
	if repo == nil {
		panic("profile.NewAIVacanciesModelHandler: repo is required")
	}
	if log == nil {
		panic("profile.NewAIVacanciesModelHandler: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &AIVacanciesModelHandler{Repo: repo, Log: log}
}

type aiVacanciesModelBody struct {
	ModelID string `json:"model_id"`
}

// HandleGet implements GET /profile/me/ai-vacancies-model.
func (h *AIVacanciesModelHandler) HandleGet(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeVacModelErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := h.Repo.GetVacanciesModel(r.Context(), uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			// User row missing is a real data bug, not "no preference".
			writeVacModelErr(w, http.StatusNotFound, "user not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "profile.AIVacanciesModel.Get: repo failed", slog.Any("err", err))
		writeVacModelErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeVacModelJSON(w, aiVacanciesModelBody{ModelID: id})
}

// HandlePut implements PUT /profile/me/ai-vacancies-model.
// Empty model_id clears the preference (server-default kicks in).
func (h *AIVacanciesModelHandler) HandlePut(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeVacModelErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var body aiVacanciesModelBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeVacModelErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if err := h.Repo.SetVacanciesModel(r.Context(), uid, body.ModelID); err != nil {
		h.Log.ErrorContext(r.Context(), "profile.AIVacanciesModel.Put: repo failed", slog.Any("err", err))
		writeVacModelErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeVacModelJSON(w, body)
}

func writeVacModelJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeVacModelErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
