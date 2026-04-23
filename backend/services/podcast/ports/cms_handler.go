// cms_handler.go — chi-direct REST endpoints for the podcast CMS.
//
// We mount these as plain http.Handler functions (not Connect RPCs)
// because:
//
//   - Multipart upload (POST /admin/podcast) does not fit the Connect
//     wire format — Connect codec is JSON/protobuf, not multipart.
//   - The category management surface is tiny, JSON-only, and isolated.
//   - The shape mirrors backend/services/daily/ports/run_handler.go which
//     uses the same chi-direct pattern for the same reasons.
//
// Auth: bearer is enforced at router.go (restAuthGate). Admin role is
// enforced inside each admin handler via UserRoleFromContext, mirroring
// AdminServer.requireAdmin in services/admin/ports/server.go.
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

	"druz9/podcast/app"
	"druz9/podcast/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// MaxUploadBytes caps the audio file size for POST /admin/podcast at 200
// MB. The HTTP layer reads at most this many bytes from the multipart
// section; anything larger is 413.
const MaxUploadBytes int64 = 200 * 1024 * 1024

// CMSHandler bundles the chi handlers for the podcast CMS surface.
//
// One struct, many methods — symmetric with daily.ports.RunHandler.
type CMSHandler struct {
	Svc *app.CMSService
	Log *slog.Logger
	Now func() time.Time
}

// NewCMSHandler wires the handler. log is required (anti-fallback).
func NewCMSHandler(svc *app.CMSService, log *slog.Logger, now func() time.Time) *CMSHandler {
	if svc == nil {
		panic("podcast.ports.NewCMSHandler: svc is required")
	}
	if log == nil {
		panic("podcast.ports.NewCMSHandler: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if now == nil {
		now = time.Now
	}
	return &CMSHandler{Svc: svc, Log: log, Now: now}
}

// ─── DTOs (mirror frontend types/podcasts.ts) ────────────────────────────

type cmsPodcastDTO struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	TitleEN     string          `json:"title_en,omitempty"`
	Description string          `json:"description"`
	Host        string          `json:"host,omitempty"`
	CategoryID  string          `json:"category_id,omitempty"`
	Category    *cmsCategoryDTO `json:"category,omitempty"`
	EpisodeNum  *int            `json:"episode_num,omitempty"`
	DurationSec int             `json:"duration_sec"`
	AudioURL    string          `json:"audio_url"`
	CoverURL    string          `json:"cover_url,omitempty"`
	IsPublished bool            `json:"is_published"`
	PublishedAt *string         `json:"published_at,omitempty"`
	CreatedAt   string          `json:"created_at"`
	UpdatedAt   string          `json:"updated_at"`
}

type cmsCategoryDTO struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	SortOrder int    `json:"sort_order"`
}

type cmsListResponse struct {
	Items []cmsPodcastDTO `json:"items"`
}

type cmsCategoriesResponse struct {
	Items []cmsCategoryDTO `json:"items"`
}

func toCMSDTO(p domain.CMSPodcast) cmsPodcastDTO {
	out := cmsPodcastDTO{
		ID:          p.ID.String(),
		Title:       p.Title,
		TitleEN:     p.TitleEN,
		Description: p.Description,
		Host:        p.Host,
		EpisodeNum:  p.EpisodeNum,
		DurationSec: p.DurationSec,
		AudioURL:    p.AudioURL,
		CoverURL:    p.CoverURL,
		IsPublished: p.IsPublished,
		CreatedAt:   p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if p.CategoryID != nil {
		out.CategoryID = p.CategoryID.String()
	}
	if p.Category != nil {
		c := toCategoryDTO(*p.Category)
		out.Category = &c
	}
	if p.PublishedAt != nil {
		s := p.PublishedAt.UTC().Format(time.RFC3339)
		out.PublishedAt = &s
	}
	return out
}

func toCategoryDTO(c domain.PodcastCategory) cmsCategoryDTO {
	return cmsCategoryDTO{
		ID:        c.ID.String(),
		Slug:      c.Slug,
		Name:      c.Name,
		Color:     c.Color,
		SortOrder: c.SortOrder,
	}
}

// ─── public endpoints ────────────────────────────────────────────────────

// HandleListCMS — GET /podcast (CMS variant). When the legacy ListCatalog
// connect handler is mounted on the same path, the wirer arbitrates which
// gets the request (we mount THIS one, leaving the legacy connect path at
// the root of the rpc namespace).
func (h *CMSHandler) HandleListCMS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	f := domain.CMSListFilter{OnlyPublished: true}
	if raw := r.URL.Query().Get("category_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			writeJSONErr(w, http.StatusBadRequest, "invalid category_id")
			return
		}
		f.CategoryID = &id
	}
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			f.Limit = n
		}
	}
	rows, err := h.Svc.ListCMSPodcasts(r.Context(), f)
	if err != nil {
		h.respondErr(w, err)
		return
	}
	out := cmsListResponse{Items: make([]cmsPodcastDTO, 0, len(rows))}
	for _, p := range rows {
		out.Items = append(out.Items, toCMSDTO(p))
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleGetCMS — GET /podcast/:id.
func (h *CMSHandler) HandleGetCMS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	row, err := h.Svc.GetCMSPodcast(r.Context(), id)
	if err != nil {
		h.respondErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toCMSDTO(row))
}

// HandleListCategories — GET /podcast/categories.
func (h *CMSHandler) HandleListCategories(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	rows, err := h.Svc.ListCategories(r.Context())
	if err != nil {
		h.respondErr(w, err)
		return
	}
	out := cmsCategoriesResponse{Items: make([]cmsCategoryDTO, 0, len(rows))}
	for _, c := range rows {
		out.Items = append(out.Items, toCategoryDTO(c))
	}
	writeJSON(w, http.StatusOK, out)
}

// ─── admin endpoints ─────────────────────────────────────────────────────

// HandleCreate — POST /admin/podcast (multipart/form-data).
//
// Form fields:
//   - title (required)
//   - title_en, description, host, category_id, episode_num,
//     duration_sec, cover_url, is_published, published_at (optional)
//   - audio: file part (required)
func (h *CMSHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	// Cap upload size — anything bigger short-circuits before we read.
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes+1<<20) // +1 MiB headroom
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSONErr(w, http.StatusBadRequest, fmt.Sprintf("invalid multipart: %v", err))
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	in, err := parseCreateForm(r)
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	defer func() {
		if c, ok := in.AudioBody.(closer); ok {
			_ = c.Close()
		}
	}()

	row, err := h.Svc.CreatePodcast(r.Context(), in)
	if err != nil {
		h.respondErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toCMSDTO(row))
}

// HandleUpdate — PATCH /admin/podcast/:id (JSON body, metadata only).
func (h *CMSHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPut {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body updateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	in, derr := body.toAppInput()
	if derr != nil {
		writeJSONErr(w, http.StatusBadRequest, derr.Error())
		return
	}
	row, uerr := h.Svc.UpdatePodcast(r.Context(), id, in)
	if uerr != nil {
		h.respondErr(w, uerr)
		return
	}
	writeJSON(w, http.StatusOK, toCMSDTO(row))
}

// HandleDelete — DELETE /admin/podcast/:id.
func (h *CMSHandler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.DeletePodcast(r.Context(), id); err != nil {
		h.respondErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleCreateCategory — POST /admin/podcast/categories.
func (h *CMSHandler) HandleCreateCategory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !h.requireAdmin(w, r) {
		return
	}
	var body struct {
		Slug      string `json:"slug"`
		Name      string `json:"name"`
		Color     string `json:"color"`
		SortOrder int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if strings.TrimSpace(body.Slug) == "" || strings.TrimSpace(body.Name) == "" {
		writeJSONErr(w, http.StatusBadRequest, "slug and name are required")
		return
	}
	row, err := h.Svc.CreateCategory(r.Context(), domain.PodcastCategory{
		Slug:      strings.TrimSpace(body.Slug),
		Name:      strings.TrimSpace(body.Name),
		Color:     strings.TrimSpace(body.Color),
		SortOrder: body.SortOrder,
	})
	if err != nil {
		h.respondErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, toCategoryDTO(row))
}

// ─── helpers ─────────────────────────────────────────────────────────────

// requireAdmin enforces the role gate. Returns true on success; on
// failure it has already written the response.
func (h *CMSHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return false
	}
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != string(enums.UserRoleAdmin) {
		writeJSONErr(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

// respondErr maps domain errors to HTTP statuses.
func (h *CMSHandler) respondErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrNotFound), errors.Is(err, domain.ErrCategoryNotFound):
		writeJSONErr(w, http.StatusNotFound, err.Error())
	case errors.Is(err, domain.ErrCategoryConflict):
		writeJSONErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrInvalidPodcast):
		writeJSONErr(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, domain.ErrObjectStoreUnavailable):
		writeJSONErr(w, http.StatusServiceUnavailable, "object storage not configured (missing MINIO_*)")
	default:
		h.Log.Error("podcast.cms: unexpected error", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "podcast cms failure")
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// closer is the io.Closer half of the multipart File interface — we use
// the interface name locally to keep the deferred close terse.
type closer interface{ Close() error }

// updateBody mirrors the JSON shape the frontend sends to PATCH.
type updateBody struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Host        string  `json:"host"`
	CategoryID  string  `json:"category_id"`
	EpisodeNum  *int    `json:"episode_num"`
	DurationSec int     `json:"duration_sec"`
	CoverURL    string  `json:"cover_url"`
	IsPublished bool    `json:"is_published"`
	PublishedAt *string `json:"published_at"`
}

func (b updateBody) toAppInput() (app.UpdatePodcastInput, error) {
	out := app.UpdatePodcastInput{
		Title:       b.Title,
		Description: b.Description,
		Host:        b.Host,
		EpisodeNum:  b.EpisodeNum,
		DurationSec: b.DurationSec,
		CoverURL:    b.CoverURL,
		IsPublished: b.IsPublished,
	}
	if b.CategoryID != "" {
		id, err := uuid.Parse(b.CategoryID)
		if err != nil {
			return app.UpdatePodcastInput{}, fmt.Errorf("invalid category_id: %w", err)
		}
		out.CategoryID = &id
	}
	if b.PublishedAt != nil && *b.PublishedAt != "" {
		t, err := time.Parse(time.RFC3339, *b.PublishedAt)
		if err != nil {
			return app.UpdatePodcastInput{}, fmt.Errorf("invalid published_at: %w", err)
		}
		out.PublishedAt = &t
	}
	return out, nil
}

// parseCreateForm extracts every field of POST /admin/podcast from the
// multipart form. Returns an app.CreatePodcastInput whose AudioBody must
// be Closed by the caller.
func parseCreateForm(r *http.Request) (app.CreatePodcastInput, error) {
	in := app.CreatePodcastInput{
		Title:       strings.TrimSpace(r.FormValue("title")),
		TitleEN:     strings.TrimSpace(r.FormValue("title_en")),
		Description: r.FormValue("description"),
		Host:        strings.TrimSpace(r.FormValue("host")),
		CoverURL:    strings.TrimSpace(r.FormValue("cover_url")),
	}
	if in.Title == "" {
		return in, errors.New("title is required")
	}
	if v := strings.TrimSpace(r.FormValue("category_id")); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return in, fmt.Errorf("invalid category_id: %w", err)
		}
		in.CategoryID = &id
	}
	if v := strings.TrimSpace(r.FormValue("episode_num")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return in, fmt.Errorf("invalid episode_num: %w", err)
		}
		in.EpisodeNum = &n
	}
	if v := strings.TrimSpace(r.FormValue("duration_sec")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return in, fmt.Errorf("invalid duration_sec: %w", err)
		}
		in.DurationSec = n
	}
	if v := strings.TrimSpace(r.FormValue("is_published")); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return in, fmt.Errorf("invalid is_published: %w", err)
		}
		in.IsPublished = b
	}
	if v := strings.TrimSpace(r.FormValue("published_at")); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return in, fmt.Errorf("invalid published_at: %w", err)
		}
		in.PublishedAt = &t
	}

	file, header, err := r.FormFile("audio")
	if err != nil {
		return in, fmt.Errorf("audio file required: %w", err)
	}
	if header.Size <= 0 {
		_ = file.Close()
		return in, errors.New("audio file is empty")
	}
	if header.Size > MaxUploadBytes {
		_ = file.Close()
		return in, fmt.Errorf("audio too large: %d > %d", header.Size, MaxUploadBytes)
	}
	in.AudioBody = file
	in.AudioLength = header.Size
	in.AudioFilename = header.Filename
	in.AudioContentType = header.Header.Get("Content-Type")
	if in.AudioContentType == "" {
		in.AudioContentType = "application/octet-stream"
	}
	return in, nil
}
