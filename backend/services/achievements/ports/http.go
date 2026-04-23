// Package ports — chi-handler'ы для achievements REST.
//
// Контракт нарочно chi (а не Connect) — описание ачивок, прогресс и
// recompute-trigger укладываются в три тонких REST-endpoint'а; добавлять
// proto под это — overkill (та же логика как для streak_calendar_handler.go).
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	achApp "druz9/achievements/app"
	achDomain "druz9/achievements/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

// Handler группирует use cases. Конструктор NewHandler заполняет дефолты.
type Handler struct {
	List      *achApp.ListAchievements
	Get       *achApp.GetSingle
	Evaluator *achApp.Evaluator
	Log       *slog.Logger
}

// NewHandler возвращает копию. Log обязателен (anti-fallback policy).
func NewHandler(in Handler) *Handler {
	h := in
	if h.Log == nil {
		panic("achievements.ports.NewHandler: Log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &h
}

// Mount регистрирует REST routes на gated /api/v1.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/achievements", h.handleList)
	r.Post("/achievements/recompute", h.handleRecompute)
	r.Get("/achievements/{code}", h.handleGet)
}

// achievementResponse — JSON-форма для одного ачивмента.
type achievementResponse struct {
	Code         string     `json:"code"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Category     string     `json:"category"`
	Tier         string     `json:"tier"`
	IconURL      string     `json:"icon_url"`
	Requirements string     `json:"requirements"`
	Reward       string     `json:"reward"`
	Hidden       bool       `json:"hidden"`
	UnlockedAt   *time.Time `json:"unlocked_at"`
	Progress     int        `json:"progress"`
	Target       int        `json:"target"`
}

func toAchievementResponse(it achApp.ListItem) achievementResponse {
	return achievementResponse{
		Code:         it.Code,
		Title:        it.Title,
		Description:  it.Description,
		Category:     string(it.Category),
		Tier:         string(it.Tier),
		IconURL:      it.IconURL,
		Requirements: it.RequirementsText,
		Reward:       it.RewardText,
		Hidden:       it.Hidden,
		UnlockedAt:   it.UnlockedAt,
		Progress:     it.Progress,
		Target:       it.Target,
	}
}

// handleList — GET /achievements.
//
// Возвращает массив achievementResponse (без обёртки), плюс агрегаты в
// заголовках X-Total-Unlocked / X-Total — frontend вычисляет на стороне
// клиента. Без обёртки, чтобы клиент не плодил уровни вложенности.
func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	items, err := h.List.Do(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "achievements.List failed",
			slog.Any("err", err), slog.Any("user_id", uid))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := make([]achievementResponse, 0, len(items))
	for _, it := range items {
		out = append(out, toAchievementResponse(it))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=30")
	_ = json.NewEncoder(w).Encode(out)
}

// handleGet — GET /achievements/{code}.
func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	code := chi.URLParam(r, "code")
	if code == "" {
		writeJSONError(w, http.StatusBadRequest, "missing code")
		return
	}
	it, err := h.Get.Do(r.Context(), uid, code)
	if err != nil {
		if errors.Is(err, achDomain.ErrUnknownCode) {
			writeJSONError(w, http.StatusNotFound, "not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "achievements.Get failed",
			slog.Any("err", err), slog.String("code", code))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toAchievementResponse(it))
}

// handleRecompute — POST /achievements/recompute. Дёргает evaluator
// (debug/admin endpoint, auth-only). Возвращает список новых разблокировок.
func (h *Handler) handleRecompute(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if h.Evaluator == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "evaluator not wired")
		return
	}
	unlocked, err := h.Evaluator.EvaluateUserProgress(r.Context(), uid)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "achievements.Evaluate failed",
			slog.Any("err", err), slog.Any("user_id", uid))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"unlocked": unlocked,
	})
}

// writeJSONError — общий error-helper.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}
