// Phase 4.3 — chi-direct REST endpoints for user goals (CRUD).
//
//	GET    /api/v1/goals                — list all goals (any status)
//	POST   /api/v1/goals                — create new goal
//	POST   /api/v1/goals/{id}/status    — set status (active/paused/done/abandoned)
//	DELETE /api/v1/goals/{id}           — delete goal
//
// Все routes user-scoped (auth required) — handler читает user_id из
// context'а через sharedMw.UserIDFromContext. Не proto: один SPA caller
// (web /goals page), не нужно регенерировать TS catalogue ради CRUD'а.
package intelligence

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	intelDomain "druz9/intelligence/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type goalDTO struct {
	ID             string   `json:"id"`
	Kind           string   `json:"kind"`
	Status         string   `json:"status"`
	Title          string   `json:"title"`
	NotesMd        string   `json:"notes_md"`
	Deadline       string   `json:"deadline,omitempty"` // YYYY-MM-DD
	DaysToDeadline int      `json:"days_to_deadline"`
	TrackID        string   `json:"track_id,omitempty"`
	SkillKeys      []string `json:"skill_keys"`
	CreatedAt      string   `json:"created_at"`
}

type goalsListResp struct {
	Items []goalDTO `json:"items"`
}

type createGoalBody struct {
	Kind      string   `json:"kind"`
	Title     string   `json:"title"`
	NotesMd   string   `json:"notes_md"`
	Deadline  string   `json:"deadline"` // YYYY-MM-DD or empty
	TrackID   string   `json:"track_id"`
	SkillKeys []string `json:"skill_keys"`
}

type setStatusBody struct {
	Status string `json:"status"`
}

func goalToDTO(g intelDomain.UserGoal) goalDTO {
	out := goalDTO{
		ID:             g.ID.String(),
		Kind:           string(g.Kind),
		Status:         g.Status,
		Title:          g.Title,
		NotesMd:        g.NotesMD,
		DaysToDeadline: g.DaysToDeadline,
		SkillKeys:      g.SkillKeys,
		CreatedAt:      g.CreatedAt.UTC().Format(time.RFC3339),
	}
	if g.Deadline != nil {
		out.Deadline = g.Deadline.UTC().Format("2006-01-02")
	}
	if g.TrackID != nil {
		out.TrackID = g.TrackID.String()
	}
	if out.SkillKeys == nil {
		out.SkillKeys = []string{}
	}
	return out
}

func newGoalsHandlers(repo intelDomain.GoalsRepo, log *slog.Logger) (
	list http.HandlerFunc,
	create http.HandlerFunc,
	setStatus http.HandlerFunc,
	del http.HandlerFunc,
) {
	list = func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		rows, err := repo.ListByUser(r.Context(), uid)
		if err != nil {
			goalsLog(log, r, "list", err)
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		out := goalsListResp{Items: make([]goalDTO, 0, len(rows))}
		for _, g := range rows {
			out.Items = append(out.Items, goalToDTO(g))
		}
		writeGoalsJSON(w, out)
	}

	create = func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		var body createGoalBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
			return
		}
		body.Title = strings.TrimSpace(body.Title)
		if body.Title == "" {
			http.Error(w, `{"error":"title required"}`, http.StatusBadRequest)
			return
		}
		kind := intelDomain.UserGoalKind(strings.TrimSpace(body.Kind))
		switch kind {
		case intelDomain.UserGoalKindJob, intelDomain.UserGoalKindSkill, intelDomain.UserGoalKindTrack:
			// ok
		default:
			http.Error(w, fmt.Sprintf(`{"error":"invalid kind %q"}`, body.Kind), http.StatusBadRequest)
			return
		}
		in := intelDomain.CreateGoalInput{
			UserID:    uid,
			Kind:      kind,
			Title:     body.Title,
			NotesMD:   strings.TrimSpace(body.NotesMd),
			SkillKeys: body.SkillKeys,
		}
		if body.Deadline != "" {
			t, err := time.Parse("2006-01-02", body.Deadline)
			if err != nil {
				http.Error(w, `{"error":"bad deadline; use YYYY-MM-DD"}`, http.StatusBadRequest)
				return
			}
			in.Deadline = &t
		}
		if body.TrackID != "" {
			tid, err := uuid.Parse(body.TrackID)
			if err != nil {
				http.Error(w, `{"error":"bad track_id"}`, http.StatusBadRequest)
				return
			}
			in.TrackID = &tid
		}
		g, err := repo.Create(r.Context(), in)
		if err != nil {
			goalsLog(log, r, "create", err)
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		writeGoalsJSON(w, goalToDTO(g))
	}

	setStatus = func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			http.Error(w, `{"error":"bad id"}`, http.StatusBadRequest)
			return
		}
		var body setStatusBody
		if decodeErr := json.NewDecoder(r.Body).Decode(&body); decodeErr != nil {
			http.Error(w, `{"error":"bad_json"}`, http.StatusBadRequest)
			return
		}
		body.Status = strings.TrimSpace(strings.ToLower(body.Status))
		switch body.Status {
		case "active", "paused", "done", "abandoned":
			// ok
		default:
			http.Error(w, fmt.Sprintf(`{"error":"invalid status %q"}`, body.Status), http.StatusBadRequest)
			return
		}
		g, err := repo.UpdateStatus(r.Context(), uid, id, body.Status)
		if err != nil {
			if errors.Is(err, intelDomain.ErrNotFound) {
				http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
				return
			}
			goalsLog(log, r, "set_status", err)
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		writeGoalsJSON(w, goalToDTO(g))
	}

	del = func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			http.Error(w, `{"error":"bad id"}`, http.StatusBadRequest)
			return
		}
		if err := repo.Delete(r.Context(), uid, id); err != nil {
			if errors.Is(err, intelDomain.ErrNotFound) {
				http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
				return
			}
			goalsLog(log, r, "delete", err)
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		writeGoalsJSON(w, map[string]any{"ok": true})
	}
	return
}

func writeGoalsJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func goalsLog(log *slog.Logger, r *http.Request, op string, err error) {
	if log == nil {
		return
	}
	log.WarnContext(r.Context(), "intelligence.goals", slog.String("op", op), slog.Any("err", err))
}
