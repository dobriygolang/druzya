// admin_arena_tasks.go — chi-direct CRUD over the canonical `tasks`
// table (00003_content.sql) used by Arena 1v1/2v2 + Daily Kata. Lives
// here as a slim REST surface so the admin can seed match content
// without writing SQL migrations.
//
// `mock_tasks` (00043) has its own admin path — these are different
// pools and stay separate by design.

package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

func validateArenaSection(s string) bool {
	switch s {
	case "algorithms", "sql", "go", "system_design", "behavioral":
		return true
	}
	return false
}

func validateArenaDifficulty(d string) bool {
	return d == "easy" || d == "medium" || d == "hard"
}

func requireAdminInline(r *http.Request) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		return uuid.Nil, errors.New("unauthenticated")
	}
	role, _ := sharedMw.UserRoleFromContext(r.Context())
	if role != "admin" {
		return uuid.Nil, errors.New("forbidden")
	}
	return uid, nil
}

// NewAdminArenaTasks wires the admin tasks REST surface. Returns a
// Module so it slots into the standard bootstrap loop.
func NewAdminArenaTasks(d Deps) *Module {
	h := &adminArenaTasksHandler{pool: d.Pool, log: d.Log}
	return &Module{
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
	pool *pgxpool.Pool
	log  *slog.Logger
}

const arenaTaskCols = `id, slug, title_ru, title_en, description_ru, description_en,
	difficulty, section, time_limit_sec, memory_limit_mb,
	COALESCE(solution_hint,''), version, is_active, COALESCE(avg_rating,0)`

func (h *adminArenaTasksHandler) scan(row pgx.Row) (arenaTaskDTO, error) {
	var d arenaTaskDTO
	var idUUID uuid.UUID
	err := row.Scan(&idUUID, &d.Slug, &d.TitleRU, &d.TitleEN,
		&d.DescriptionRU, &d.DescriptionEN, &d.Difficulty, &d.Section,
		&d.TimeLimitSec, &d.MemoryLimitMB, &d.SolutionHint,
		&d.Version, &d.IsActive, &d.AvgRating)
	if err != nil {
		return arenaTaskDTO{}, fmt.Errorf("scan arena task: %w", err)
	}
	d.ID = idUUID.String()
	return d, nil
}

func (h *adminArenaTasksHandler) list(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	q := r.URL.Query()
	section := q.Get("section")
	difficulty := q.Get("difficulty")
	onlyActive := q.Get("active") == "true"
	limit := 200
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	args := []any{}
	idx := 1
	sql := `SELECT ` + arenaTaskCols + ` FROM tasks WHERE 1=1`
	if section != "" {
		if !validateArenaSection(section) {
			http.Error(w, `{"error":"invalid section"}`, http.StatusBadRequest)
			return
		}
		sql += fmt.Sprintf(" AND section = $%d", idx)
		args = append(args, section)
		idx++
	}
	if difficulty != "" {
		if !validateArenaDifficulty(difficulty) {
			http.Error(w, `{"error":"invalid difficulty"}`, http.StatusBadRequest)
			return
		}
		sql += fmt.Sprintf(" AND difficulty = $%d", idx)
		args = append(args, difficulty)
		idx++
	}
	if onlyActive {
		sql += " AND is_active = TRUE"
	}
	sql += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", idx)
	args = append(args, limit)
	rows, err := h.pool.Query(r.Context(), sql, args...)
	if err != nil {
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.list", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := make([]arenaTaskDTO, 0)
	for rows.Next() {
		t, err := h.scan(rows)
		if err != nil {
			h.log.ErrorContext(r.Context(), "admin.arena_tasks.scan", slog.Any("err", err))
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		out = append(out, t)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *adminArenaTasksHandler) get(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	row := h.pool.QueryRow(r.Context(),
		`SELECT `+arenaTaskCols+` FROM tasks WHERE id = $1`, sharedpg.UUID(id))
	t, err := h.scan(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.get", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(t)
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

func (b *arenaTaskUpsertBody) validate() error {
	if b.Slug == "" {
		return errors.New("slug is required")
	}
	if b.TitleRU == "" || b.TitleEN == "" {
		return errors.New("title_ru and title_en are required")
	}
	if !validateArenaDifficulty(b.Difficulty) {
		return errors.New("difficulty must be easy|medium|hard")
	}
	if !validateArenaSection(b.Section) {
		return errors.New("section invalid")
	}
	return nil
}

func (h *adminArenaTasksHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	var body arenaTaskUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if err := body.validate(); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	if body.TimeLimitSec <= 0 {
		body.TimeLimitSec = 60
	}
	if body.MemoryLimitMB <= 0 {
		body.MemoryLimitMB = 256
	}
	active := true
	if body.IsActive != nil {
		active = *body.IsActive
	}
	row := h.pool.QueryRow(r.Context(), `
		INSERT INTO tasks (slug, title_ru, title_en, description_ru, description_en,
			difficulty, section, time_limit_sec, memory_limit_mb, solution_hint, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),$11)
		RETURNING `+arenaTaskCols,
		body.Slug, body.TitleRU, body.TitleEN, body.DescriptionRU, body.DescriptionEN,
		body.Difficulty, body.Section, body.TimeLimitSec, body.MemoryLimitMB,
		body.SolutionHint, active)
	t, err := h.scan(row)
	if err != nil {
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.create", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(t)
}

func (h *adminArenaTasksHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
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
	if verr := body.validate(); verr != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, verr.Error()), http.StatusBadRequest)
		return
	}
	active := true
	if body.IsActive != nil {
		active = *body.IsActive
	}
	row := h.pool.QueryRow(r.Context(), `
		UPDATE tasks SET
			slug=$2, title_ru=$3, title_en=$4, description_ru=$5, description_en=$6,
			difficulty=$7, section=$8, time_limit_sec=$9, memory_limit_mb=$10,
			solution_hint=NULLIF($11,''), is_active=$12, updated_at=now()
		WHERE id = $1
		RETURNING `+arenaTaskCols,
		sharedpg.UUID(id), body.Slug, body.TitleRU, body.TitleEN,
		body.DescriptionRU, body.DescriptionEN, body.Difficulty, body.Section,
		body.TimeLimitSec, body.MemoryLimitMB, body.SolutionHint, active)
	t, err := h.scan(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.update", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(t)
}

func (h *adminArenaTasksHandler) toggleActive(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
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
	tag, err := h.pool.Exec(r.Context(),
		`UPDATE tasks SET is_active = $2, updated_at = now() WHERE id = $1`,
		sharedpg.UUID(id), body.Active)
	if err != nil {
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.active", slog.Any("err", err))
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *adminArenaTasksHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM tasks WHERE id = $1`, sharedpg.UUID(id))
	if err != nil {
		// FK violation when match_history references — surface as 409.
		h.log.ErrorContext(r.Context(), "admin.arena_tasks.delete", slog.Any("err", err))
		http.Error(w, `{"error":"cannot delete (referenced by match history)"}`, http.StatusConflict)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// _ keeps context import used. statusForAuthErr is shared with other admin
// REST surfaces that grow inline auth checks.
func statusForAuthErr(err error) int {
	if err == nil {
		return http.StatusOK
	}
	switch err.Error() {
	case "unauthenticated":
		return http.StatusUnauthorized
	case "forbidden":
		return http.StatusForbidden
	}
	return http.StatusInternalServerError
}

var _ = context.Background
