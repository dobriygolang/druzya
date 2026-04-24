// Package ports — REST surface for the vacancies bounded context.
//
// All endpoints emit JSON; payloads use snake_case keys. Auth is enforced
// at the router level — public reads (analyze, list, get, facets) work
// without bearer; per-user endpoints (saved/*) get the user id from the
// bearer middleware.
//
// Identity model (Phase 3): the parsed-postings catalogue lives in an
// in-memory cache keyed on (source, external_id). There is no integer id
// anymore. Routes use the composite key:
//
//	GET    /vacancies                                  list (cache)
//	GET    /vacancies/facets                           live histograms
//	GET    /vacancies/{source}/{external_id}           cache lookup
//	POST   /vacancies/{source}/{external_id}/save      snapshot + upsert
//	POST   /vacancies/analyze                          paste-the-link
//	GET    /vacancies/saved                            kanban list
//	GET    /vacancies/saved/{source}/{external_id}     snapshot + live diff
//	PATCH  /vacancies/saved/{id}                       status / notes
//	DELETE /vacancies/saved/{id}                       remove
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
	Facets    *app.GetFacets
	Save      *app.SaveVacancy
	Update    *app.UpdateSavedStatus
	Remove    *app.RemoveSaved
	ListSaved *app.ListSaved
	GetSaved  *app.GetSaved
	Log       *slog.Logger
}

// Mount registers every route on the given chi router. Caller is
// responsible for the path prefix (we mount under /api/v1).
func (h *Handler) Mount(r chi.Router) {
	r.Post("/vacancies/analyze", h.handleAnalyze)
	r.Get("/vacancies", h.handleList)
	r.Get("/vacancies/facets", h.handleFacets)
	r.Get("/vacancies/saved", h.handleListSaved)
	r.Get("/vacancies/saved/{source}/{external_id}", h.handleGetSaved)
	r.Patch("/vacancies/saved/{id}", h.handleUpdate)
	r.Delete("/vacancies/saved/{id}", h.handleDelete)
	r.Get("/vacancies/{source}/{external_id}", h.handleGet)
	r.Post("/vacancies/{source}/{external_id}/save", h.handleSave)
}

// ─────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────

type vacancyDTO struct {
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
	Category         string     `json:"category"`
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
		Source: string(v.Source), ExternalID: v.ExternalID,
		URL: v.URL, Title: v.Title, Company: v.Company, Location: v.Location,
		EmploymentType: v.EmploymentType, ExperienceLevel: v.ExperienceLevel,
		SalaryMin: v.SalaryMin, SalaryMax: v.SalaryMax, Currency: v.Currency,
		Description: v.Description, RawSkills: v.RawSkills, NormalizedSkills: v.NormalizedSkills,
		Category: string(v.Category),
		PostedAt: v.PostedAt, FetchedAt: v.FetchedAt,
	}
}

type savedDTO struct {
	ID         int64      `json:"id"`
	Source     string     `json:"source"`
	ExternalID string     `json:"external_id"`
	Status     string     `json:"status"`
	Notes      string     `json:"notes,omitempty"`
	SavedAt    time.Time  `json:"saved_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	Vacancy    vacancyDTO `json:"vacancy"`
}

func toSavedDTO(s domain.SavedVacancy) savedDTO {
	return savedDTO{
		ID: s.ID, Source: string(s.Source), ExternalID: s.ExternalID,
		Status: string(s.Status), Notes: s.Notes,
		SavedAt: s.SavedAt, UpdatedAt: s.UpdatedAt,
		Vacancy: toVacancyDTO(s.Snapshot),
	}
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
	if s := q.Get("category"); s != "" {
		for _, x := range strings.Split(s, ",") {
			x = strings.TrimSpace(x)
			if x == "" {
				continue
			}
			c := domain.Category(x)
			if !domain.IsValidCategory(c) {
				writeError(w, http.StatusBadRequest, "invalid category: "+x)
				return
			}
			f.Categories = append(f.Categories, c)
		}
	}
	if s := q.Get("company"); s != "" {
		for _, x := range strings.Split(s, ",") {
			x = strings.TrimSpace(x)
			if x != "" {
				f.Companies = append(f.Companies, x)
			}
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

func (h *Handler) handleFacets(w http.ResponseWriter, r *http.Request) {
	f, err := h.Facets.Do(r.Context())
	if err != nil {
		h.logErr(r, "facets", err)
		writeError(w, http.StatusInternalServerError, "facets failed")
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	src, extID, ok := parseSourceExternal(w, r)
	if !ok {
		return
	}
	v, err := h.Get.Do(r.Context(), src, extID)
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
	src, extID, ok := parseSourceExternal(w, r)
	if !ok {
		return
	}
	var req saveReq
	if r.ContentLength > 0 {
		if decErr := json.NewDecoder(r.Body).Decode(&req); decErr != nil {
			writeError(w, http.StatusBadRequest, "invalid json: "+decErr.Error())
			return
		}
	}
	saved, err := h.Save.Do(r.Context(), uid, src, extID, strings.TrimSpace(req.Notes))
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "vacancy not in cache")
			return
		}
		h.logErr(r, "save", err)
		writeError(w, http.StatusInternalServerError, "save failed")
		return
	}
	writeJSON(w, http.StatusOK, toSavedDTO(saved))
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
	writeJSON(w, http.StatusOK, toSavedDTO(saved))
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
		out = append(out, toSavedDTO(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

type savedDetailResp struct {
	Saved savedDTO    `json:"saved"`
	Live  *vacancyDTO `json:"live,omitempty"`
}

func (h *Handler) handleGetSaved(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	src, extID, ok := parseSourceExternal(w, r)
	if !ok {
		return
	}
	d, err := h.GetSaved.Do(r.Context(), uid, src, extID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		h.logErr(r, "get_saved", err)
		writeError(w, http.StatusInternalServerError, "get_saved failed")
		return
	}
	resp := savedDetailResp{Saved: toSavedDTO(d.Saved)}
	if d.Live != nil {
		dto := toVacancyDTO(*d.Live)
		resp.Live = &dto
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

func parseSourceExternal(w http.ResponseWriter, r *http.Request) (domain.Source, string, bool) {
	srcStr := chi.URLParam(r, "source")
	extID := chi.URLParam(r, "external_id")
	if strings.TrimSpace(extID) == "" {
		writeError(w, http.StatusBadRequest, "external_id required")
		return "", "", false
	}
	src := domain.Source(srcStr)
	if !domain.IsValidSource(src) {
		writeError(w, http.StatusBadRequest, "invalid source: "+srcStr)
		return "", "", false
	}
	return src, extID, true
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
