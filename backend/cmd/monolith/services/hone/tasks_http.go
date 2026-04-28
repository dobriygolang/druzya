// tasks_http.go — REST handlers for the Hone TaskBoard (kanban + comments).
//
// Wired separately from the proto/connect surface because Phase D adds a
// brand-new feature; the proto can be regenerated later. For now hone is
// a chi.Router with these routes:
//
//	GET    /hone/tasks                — list user's tasks (status grouped)
//	POST   /hone/tasks                — create custom task
//	POST   /hone/tasks/{id}/status    — move between columns
//	DELETE /hone/tasks/{id}           — delete card
//	GET    /hone/tasks/{id}/comments  — comment thread
//	POST   /hone/tasks/{id}/comments  — add user comment
package hone

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type taskHTTPHandler struct {
	create *honeApp.CreateTask
	list   *honeApp.ListTasks
	move   *honeApp.MoveTaskStatus
	del    *honeApp.DeleteTask
	addCom *honeApp.AddTaskComment
	listCm *honeApp.ListTaskComments
	log    *slog.Logger
}

// Mount attaches the task routes to the given router.
func (h *taskHTTPHandler) Mount(r chi.Router) {
	r.Get("/hone/tasks", h.handleList)
	r.Post("/hone/tasks", h.handleCreate)
	r.Post("/hone/tasks/{id}/status", h.handleMoveStatus)
	r.Delete("/hone/tasks/{id}", h.handleDelete)
	r.Get("/hone/tasks/{id}/comments", h.handleListComments)
	r.Post("/hone/tasks/{id}/comments", h.handleAddComment)
}

// ── Wire DTOs ────────────────────────────────────────────────────────────

type taskWire struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	Kind               string     `json:"kind"`
	Source             string     `json:"source"`
	Title              string     `json:"title"`
	BriefMD            string     `json:"briefMd"`
	SkillKey           string     `json:"skillKey,omitempty"`
	DeepLink           string     `json:"deepLink,omitempty"`
	RecommendedReading []string   `json:"recommendedReading,omitempty"`
	Priority           int16      `json:"priority"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
	CompletedAt        *time.Time `json:"completedAt,omitempty"`
}

type commentWire struct {
	ID         string    `json:"id"`
	AuthorKind string    `json:"authorKind"`
	BodyMD     string    `json:"bodyMd"`
	CreatedAt  time.Time `json:"createdAt"`
}

func taskToWire(t honeDomain.Task) taskWire {
	w := taskWire{
		ID: t.ID.String(), Status: string(t.Status), Kind: string(t.Kind),
		Source: string(t.Source), Title: t.Title, BriefMD: t.BriefMD,
		SkillKey: t.SkillKey, DeepLink: t.DeepLink,
		RecommendedReading: t.RecommendedReading, Priority: t.Priority,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
	if t.CompletedAt != nil {
		w.CompletedAt = t.CompletedAt
	}
	return w
}

// ── Handlers ─────────────────────────────────────────────────────────────

func (h *taskHTTPHandler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	tasks, err := h.list.Do(r.Context(), uid)
	if err != nil {
		h.serverError(w, r, "list", err, uid)
		return
	}
	out := make([]taskWire, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, taskToWire(t))
	}
	monolithServices.WritePubJSON(w, http.StatusOK, map[string]any{"tasks": out})
}

type createTaskReq struct {
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	BriefMD  string `json:"briefMd"`
	SkillKey string `json:"skillKey"`
	DeepLink string `json:"deepLink"`
}

func (h *taskHTTPHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	var body createTaskReq
	if err := readJSON(r, &body); err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", err.Error())
		return
	}
	if strings.TrimSpace(body.Title) == "" {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "empty_title", "")
		return
	}
	created, err := h.create.Do(r.Context(), honeApp.CreateTaskInput{
		UserID:   uid,
		Kind:     honeDomain.TaskKind(body.Kind),
		Title:    body.Title,
		BriefMD:  body.BriefMD,
		SkillKey: body.SkillKey,
		DeepLink: body.DeepLink,
	})
	if err != nil {
		h.serverError(w, r, "create", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, taskToWire(created))
}

type moveStatusReq struct {
	Status string `json:"status"`
}

func (h *taskHTTPHandler) handleMoveStatus(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var body moveStatusReq
	if jerr := readJSON(r, &body); jerr != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", jerr.Error())
		return
	}
	updated, err := h.move.Do(r.Context(), honeApp.MoveTaskStatusInput{
		UserID: uid, TaskID: id, Status: honeDomain.TaskStatus(body.Status),
	})
	if err != nil {
		if errors.Is(err, honeDomain.ErrNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "move", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, taskToWire(updated))
}

func (h *taskHTTPHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	if err := h.del.Do(r.Context(), uid, id); err != nil {
		if errors.Is(err, honeDomain.ErrNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "delete", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *taskHTTPHandler) handleListComments(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	rows, err := h.listCm.Do(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, honeDomain.ErrNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "list_comments", err, uid)
		return
	}
	out := make([]commentWire, 0, len(rows))
	for _, c := range rows {
		out = append(out, commentWire{
			ID: c.ID.String(), AuthorKind: string(c.AuthorKind),
			BodyMD: c.BodyMD, CreatedAt: c.CreatedAt,
		})
	}
	monolithServices.WritePubJSON(w, http.StatusOK, map[string]any{"comments": out})
}

type addCommentReq struct {
	BodyMD string `json:"bodyMd"`
}

func (h *taskHTTPHandler) handleAddComment(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var body addCommentReq
	if jerr := readJSON(r, &body); jerr != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", jerr.Error())
		return
	}
	c, err := h.addCom.Do(r.Context(), honeApp.AddTaskCommentInput{
		UserID: uid, TaskID: id, BodyMD: body.BodyMD,
	})
	if err != nil {
		if errors.Is(err, honeDomain.ErrNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "add_comment", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, commentWire{
		ID: c.ID.String(), AuthorKind: string(c.AuthorKind),
		BodyMD: c.BodyMD, CreatedAt: c.CreatedAt,
	})
}

// ── helpers ──────────────────────────────────────────────────────────────

func (h *taskHTTPHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "hone.tasks.http",
			slog.String("where", where),
			slog.String("user_id", uid.String()),
			slog.Any("err", err))
	}
	monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "internal", "")
}

// readJSON is shared with vault.go (same package).
