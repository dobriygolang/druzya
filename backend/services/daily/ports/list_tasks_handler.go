// list_tasks_handler.go — `GET /api/v1/daily/tasks?section=&difficulty=`
// returns the active task catalogue for solo-practice browsing on /practice.
//
// Why chi-direct (not Connect): same rationale as run_handler / streak —
// a tiny read-mostly polling endpoint with no proto value, fast iteration,
// no codegen overhead.
package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/daily/domain"
	"druz9/shared/enums"
)

// TaskCatalogueReader — narrow port the handler needs from TaskRepo.
type TaskCatalogueReader interface {
	ListActiveBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) ([]domain.TaskPublic, error)
}

// ListTasksHandler — http.Handler for GET /daily/tasks.
type ListTasksHandler struct {
	Tasks TaskCatalogueReader
	Log   *slog.Logger
}

// NewListTasksHandler wires the handler.
func NewListTasksHandler(tasks TaskCatalogueReader, log *slog.Logger) *ListTasksHandler {
	return &ListTasksHandler{Tasks: tasks, Log: log}
}

// taskCatalogueRow — wire shape. Matches the frontend `PracticeTask` type.
type taskCatalogueRow struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Section     string `json:"section"`
	Difficulty  string `json:"difficulty"`
}

type listTasksResponse struct {
	Items []taskCatalogueRow `json:"items"`
}

// ServeHTTP — auth required (parent chain enforces bearer). Defaults
// section=algorithms, difficulty=normal so an unfiltered call returns a
// sane "easy algos" list.
func (h *ListTasksHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	section := enums.Section(q.Get("section"))
	if !section.IsValid() {
		section = enums.SectionAlgorithms
	}
	diff := enums.Difficulty(q.Get("difficulty"))
	if !diff.IsValid() {
		diff = enums.DifficultyEasy
	}
	tasks, err := h.Tasks.ListActiveBySectionDifficulty(r.Context(), section, diff)
	if err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "daily.list_tasks: query failed",
				slog.String("section", string(section)),
				slog.String("difficulty", string(diff)),
				slog.Any("err", err))
		}
		writeJSONError(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]taskCatalogueRow, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, taskCatalogueRow{
			ID:          t.ID.String(),
			Slug:        t.Slug,
			Title:       t.Title,
			Description: t.Description,
			Section:     string(t.Section),
			Difficulty:  string(t.Difficulty),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=60")
	if err := json.NewEncoder(w).Encode(listTasksResponse{Items: out}); err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "daily.list_tasks: encode failed", slog.Any("err", err))
		}
	}
}
