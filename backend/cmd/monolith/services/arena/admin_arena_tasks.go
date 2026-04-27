// admin_arena_tasks.go — chi-direct CRUD over the canonical `tasks`
// table (00003_content.sql) used by Arena 1v1/2v2 + Daily Kata. Lives
// here as a slim REST surface so the admin can seed match content
// without writing SQL migrations.
//
// `mock_tasks` (00043) has its own admin path — these are different
// pools and stay separate by design.
package arena

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	arenaApp "druz9/arena/app"
	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// arenaTaskDTO mirrors the wire shape used by /admin/arena/tasks.
type arenaTaskDTO struct {
	ID            string  `json:"id"`
	Slug          string  `json:"slug"`
	TitleRU       string  `json:"title_ru"`
	TitleEN       string  `json:"title_en"`
	DescriptionRU string  `json:"description_ru"`
	DescriptionEN string  `json:"description_en"`
	Difficulty    string  `json:"difficulty"`
	Section       string  `json:"section"`
	TimeLimitSec  int     `json:"time_limit_sec"`
	MemoryLimitMB int     `json:"memory_limit_mb"`
	SolutionHint  string  `json:"solution_hint"`
	Version       int     `json:"version"`
	IsActive      bool    `json:"is_active"`
	AvgRating     float64 `json:"avg_rating"`
}

func dtoFromAdminTask(t arenaDomain.AdminTask) arenaTaskDTO {
	return arenaTaskDTO{
		ID:            t.ID.String(),
		Slug:          t.Slug,
		TitleRU:       t.TitleRU,
		TitleEN:       t.TitleEN,
		DescriptionRU: t.DescriptionRU,
		DescriptionEN: t.DescriptionEN,
		Difficulty:    t.Difficulty,
		Section:       t.Section,
		TimeLimitSec:  t.TimeLimitSec,
		MemoryLimitMB: t.MemoryLimitMB,
		SolutionHint:  t.SolutionHint,
		Version:       t.Version,
		IsActive:      t.IsActive,
		AvgRating:     t.AvgRating,
	}
}

// NewAdminArenaTasks wires the admin tasks REST surface. Returns a
// Module so it slots into the standard bootstrap loop.
func NewAdminArenaTasks(d monolithServices.Deps) *monolithServices.Module {
	repo := arenaInfra.NewAdminTasks(d.Pool)
	h := &adminArenaTasksHandler{
		listUC:   &arenaApp.ListAdminTasks{Repo: repo},
		getUC:    &arenaApp.GetAdminTask{Repo: repo},
		createUC: &arenaApp.CreateAdminTask{Repo: repo},
		updateUC: &arenaApp.UpdateAdminTask{Repo: repo},
		toggleUC: &arenaApp.ToggleAdminTaskActive{Repo: repo},
		deleteUC: &arenaApp.DeleteAdminTask{Repo: repo},
		log:      d.Log,
	}
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Get("/admin/arena/tasks", h.list)
			r.Get("/admin/arena/tasks/{id}", h.get)
			r.Post("/admin/arena/tasks", h.create)
			r.Patch("/admin/arena/tasks/{id}", h.update)
			r.Post("/admin/arena/tasks/{id}/active", h.toggleActive)
			r.Delete("/admin/arena/tasks/{id}", h.delete)
		},
	}
}

type adminArenaTasksHandler struct {
	listUC   *arenaApp.ListAdminTasks
	getUC    *arenaApp.GetAdminTask
	createUC *arenaApp.CreateAdminTask
	updateUC *arenaApp.UpdateAdminTask
	toggleUC *arenaApp.ToggleAdminTaskActive
	deleteUC *arenaApp.DeleteAdminTask
	log      *slog.Logger
}

func (h *adminArenaTasksHandler) list(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	q := r.URL.Query()
	f := arenaDomain.AdminTaskListFilter{
		Section:    q.Get("section"),
		Difficulty: q.Get("difficulty"),
		OnlyActive: q.Get("active") == "true",
		Limit:      200,
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			f.Limit = n
		}
	}
	out, err := h.listUC.Run(r.Context(), f)
	if err != nil {
		if errors.Is(err, arenaDomain.ErrAdminTaskInvalid) {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.list", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	dtos := make([]arenaTaskDTO, 0, len(out))
	for _, t := range out {
		dtos = append(dtos, dtoFromAdminTask(t))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": dtos})
}

func (h *adminArenaTasksHandler) get(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	t, err := h.getUC.Run(r.Context(), id)
	if err != nil {
		if errors.Is(err, arenaDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.get", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromAdminTask(t))
}

type arenaTaskUpsertBody struct {
	Slug          string `json:"slug"`
	TitleRU       string `json:"title_ru"`
	TitleEN       string `json:"title_en"`
	DescriptionRU string `json:"description_ru"`
	DescriptionEN string `json:"description_en"`
	Difficulty    string `json:"difficulty"`
	Section       string `json:"section"`
	TimeLimitSec  int    `json:"time_limit_sec"`
	MemoryLimitMB int    `json:"memory_limit_mb"`
	SolutionHint  string `json:"solution_hint"`
	IsActive      *bool  `json:"is_active"`
}

func (b arenaTaskUpsertBody) toDomain() arenaDomain.AdminTaskUpsert {
	active := true
	if b.IsActive != nil {
		active = *b.IsActive
	}
	return arenaDomain.AdminTaskUpsert{
		Slug:          b.Slug,
		TitleRU:       b.TitleRU,
		TitleEN:       b.TitleEN,
		DescriptionRU: b.DescriptionRU,
		DescriptionEN: b.DescriptionEN,
		Difficulty:    b.Difficulty,
		Section:       b.Section,
		TimeLimitSec:  b.TimeLimitSec,
		MemoryLimitMB: b.MemoryLimitMB,
		SolutionHint:  b.SolutionHint,
		IsActive:      active,
	}
}

func (h *adminArenaTasksHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	var body arenaTaskUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	t, err := h.createUC.Run(r.Context(), body.toDomain())
	if err != nil {
		if errors.Is(err, arenaDomain.ErrAdminTaskInvalid) {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.create", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(dtoFromAdminTask(t))
}

func (h *adminArenaTasksHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var body arenaTaskUpsertBody
	if derr := json.NewDecoder(r.Body).Decode(&body); derr != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	t, err := h.updateUC.Run(r.Context(), id, body.toDomain())
	if err != nil {
		if errors.Is(err, arenaDomain.ErrAdminTaskInvalid) {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
			return
		}
		if errors.Is(err, arenaDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.update", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromAdminTask(t))
}

func (h *adminArenaTasksHandler) toggleActive(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Active bool `json:"active"`
	}
	if derr := json.NewDecoder(r.Body).Decode(&body); derr != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if err := h.toggleUC.Run(r.Context(), id, body.Active); err != nil {
		if errors.Is(err, arenaDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.active", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *adminArenaTasksHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	if err := h.deleteUC.Run(r.Context(), id); err != nil {
		if errors.Is(err, arenaDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		// FK violation when match_history references — surface as 409.
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.delete", slog.Any("err", err))
		http.Error(w, `{"error":"cannot delete (referenced by match history)"}`, http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
