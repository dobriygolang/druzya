// Package ports — REST surface for the vacancies bounded context.
//
// All endpoints emit JSON; payloads use snake_case keys to match the rest of
// the platform's REST contracts. Auth is enforced at the router level — the
// public endpoints (analyze, list, get) are listed in publicPaths; the
// per-user endpoints (saved/*) get the user_id from the bearer middleware.
package ports

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	sharedMw "druz9/shared/pkg/middleware"
	"druz9/vacancies/app"
	"druz9/vacancies/domain"

	"github.com/go-chi/chi/v5"
)

// Handler bundles the use-case pointers + logger.
type Handler struct {
	Analyze   *app.AnalyzeURL
	List      *app.ListVacancies
	Get       *app.GetVacancy
	Save      *app.SaveVacancy
	Update    *app.UpdateSavedStatus
	Remove    *app.RemoveSaved
	ListSaved *app.ListSaved
	Log       *slog.Logger
}

// Mount registers every route on the given chi router. Caller is responsible
// for the path prefix (we mount under /api/v1).
func (h *Handler) Mount(r chi.Router) {
	r.Post("/vacancies/analyze", h.handleAnalyze)
	r.Get("/vacancies", h.handleList)
	r.Get("/vacancies/saved", h.handleListSaved)
	r.Get("/vacancies/{id}", h.handleGet)
	r.Post("/vacancies/{id}/save", h.handleSave)
	r.Patch("/vacancies/saved/{id}", h.handleUpdate)
	r.Delete("/vacancies/saved/{id}", h.handleDelete)
}

// ─────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────

type vacancyDTO struct {
	ID               int64      `json:"id"`
	Source           string     `json:"source"`
	ExternalID       string     `json:"external_id"`
	URL              string     `json:"url"`
	Title            string     `json:"title"`
	Company          string     `json:"company,omitempty"`
	Location         string     `json:"location,omitempty"`
	EmploymentType   string     `json:"employment_type,omitempty"`
	ExperienceLevel  string     `json:"experience_level,omitempty"`
	SalaryMin        int        `json:"salary_min,omitempty"`
	SalaryMax        int        `json:"salary_max,omitempty"`
	Currency         string     `json:"currency,omitempty"`
	Description      string     `json:"description"`
	RawSkills        []string   `json:"raw_skills"`
	NormalizedSkills []string   `json:"normalized_skills"`
	PostedAt         *time.Time `json:"posted_at,omitempty"`
	FetchedAt        time.Time  `json:"fetched_at"`
}

func toVacancyDTO(v domain.Vacancy) vacancyDTO {
	if v.RawSkills == nil {
		v.RawSkills = []string{}
	}
	if v.NormalizedSkills == nil {
		v.NormalizedSkills = []string{}
	}
	return vacancyDTO{
		ID: v.ID, Source: string(v.Source), ExternalID: v.ExternalID,
		URL: v.URL, Title: v.Title, Company: v.Company, Location: v.Location,
		EmploymentType: v.EmploymentType, ExperienceLevel: v.ExperienceLevel,
		SalaryMin: v.SalaryMin, SalaryMax: v.SalaryMax, Currency: v.Currency,
		Description: v.Description, RawSkills: v.RawSkills, NormalizedSkills: v.NormalizedSkills,
		PostedAt: v.PostedAt, FetchedAt: v.FetchedAt,
	}
}

type savedDTO struct {
	ID        int64      `json:"id"`
	VacancyID int64      `json:"vacancy_id"`
	Status    string     `json:"status"`
	Notes     string     `json:"notes,omitempty"`
	SavedAt   time.Time  `json:"saved_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	Vacancy   vacancyDTO `json:"vacancy"`
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

type analyzeReq struct {
	URL        string   `json:"url"`
	UserSkills []string `json:"user_skills,omitempty"`
}

type analyzeResp struct {
	Vacancy vacancyDTO      `json:"vacancy"`
	Gap     domain.SkillGap `json:"gap"`
}

func (h *Handler) handleAnalyze(w http.ResponseWriter, r *http.Request) {
	var req analyzeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	res, err := h.Analyze.Do(r.Context(), req.URL, req.UserSkills)
	if err != nil {
		h.logErr(r, "analyze", err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, analyzeResp{
		Vacancy: toVacancyDTO(res.Vacancy),
		Gap:     res.Gap,
	})
}

type listResp struct {
	Items  []vacancyDTO `json:"items"`
	Total  int          `json:"total"`
	Limit  int          `json:"limit"`
	Offset int          `json:"offset"`
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := domain.ListFilter{
		SalaryMin: parseIntDefault(q.Get("salary_min"), 0),
		Location:  q.Get("location"),
		Limit:     parseIntDefault(q.Get("limit"), 30),
		Offset:    parseIntDefault(q.Get("offset"), 0),
	}
	if pageStr := q.Get("page"); pageStr != "" && q.Get("offset") == "" {
		// Convenience: ?page=2 → offset = (page-1)*limit
		page := parseIntDefault(pageStr, 1)
		if page < 1 {
			page = 1
		}
		f.Offset = (page - 1) * f.Limit
	}
	if s := q.Get("source"); s != "" {
		for _, x := range strings.Split(s, ",") {
			x = strings.TrimSpace(x)
			if x == "" {
				continue
			}
			src := domain.Source(x)
			if !domain.IsValidSource(src) {
				writeError(w, http.StatusBadRequest, "invalid source: "+x)
				return
			}
			f.Sources = append(f.Sources, src)
		}
	}
	if s := q.Get("skills"); s != "" {
		for _, x := range strings.Split(s, ",") {
			x = strings.ToLower(strings.TrimSpace(x))
			if x != "" {
				f.Skills = append(f.Skills, x)
			}
		}
	}
	page, err := h.List.Do(r.Context(), f)
	if err != nil {
		h.logErr(r, "list", err)
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := listResp{Items: make([]vacancyDTO, 0, len(page.Items)), Total: page.Total, Limit: page.Limit, Offset: page.Offset}
	for _, v := range page.Items {
		out.Items = append(out.Items, toVacancyDTO(v))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	v, err := h.Get.Do(r.Context(), id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		h.logErr(r, "get", err)
		writeError(w, http.StatusInternalServerError, "get failed")
		return
	}
	writeJSON(w, http.StatusOK, toVacancyDTO(v))
}

type saveReq struct {
	Notes string `json:"notes,omitempty"`
}

func (h *Handler) handleSave(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req saveReq
	if r.ContentLength > 0 {
		if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
			writeError(w, http.StatusBadRequest, "invalid json: "+decErr.Error())
			return
		}
	}
	saved, err := h.Save.Do(r.Context(), uid, id, strings.TrimSpace(req.Notes))
	if err != nil {
		h.logErr(r, "save", err)
		writeError(w, http.StatusInternalServerError, "save failed")
		return
	}
	writeJSON(w, http.StatusOK, savedToDTO(saved, domain.Vacancy{ID: id}))
}

type updateReq struct {
	Status string `json:"status"`
	Notes  string `json:"notes"`
}

func (h *Handler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req updateReq
	if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+decErr.Error())
		return
	}
	saved, err := h.Update.Do(r.Context(), uid, id, domain.SavedStatus(req.Status), strings.TrimSpace(req.Notes))
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidStatus):
			writeError(w, http.StatusBadRequest, "invalid status")
		case errors.Is(err, domain.ErrNotFound):
			writeError(w, http.StatusNotFound, "not found")
		default:
			h.logErr(r, "update", err)
			writeError(w, http.StatusInternalServerError, "update failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, savedToDTO(saved, domain.Vacancy{ID: saved.VacancyID}))
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := parseID(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.Remove.Do(r.Context(), uid, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		h.logErr(r, "delete", err)
		writeError(w, http.StatusInternalServerError, "delete failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleListSaved(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	rows, err := h.ListSaved.Do(r.Context(), uid)
	if err != nil {
		h.logErr(r, "list_saved", err)
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	out := make([]savedDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, savedToDTO(row.Saved, row.Vacancy))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func savedToDTO(s domain.SavedVacancy, v domain.Vacancy) savedDTO {
	return savedDTO{
		ID: s.ID, VacancyID: s.VacancyID, Status: string(s.Status), Notes: s.Notes,
		SavedAt: s.SavedAt, UpdatedAt: s.UpdatedAt,
		Vacancy: toVacancyDTO(v),
	}
}

func parseID(s string) (int64, error) {
	if strings.TrimSpace(s) == "" {
		return 0, fmt.Errorf("id is required")
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("invalid id")
	}
	return n, nil
}

func parseIntDefault(s string, d int) int {
	if s == "" {
		return d
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return d
	}
	return n
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}

func (h *Handler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "vacancies.handler",
		slog.String("op", op),
		slog.Any("err", err))
}
