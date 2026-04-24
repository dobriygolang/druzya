// Package ports — REST surface for the documents bounded context.
//
// All endpoints emit JSON with snake_case keys. Auth is required for
// every endpoint; user_id is read from the bearer middleware. The service
// never returns 403 for "foreign doc id" — it returns 404 uniformly to
// avoid leaking existence of other users' data.
//
//	POST   /documents          upload bytes + metadata
//	GET    /documents          list (paginated)
//	GET    /documents/{id}     fetch one
//	DELETE /documents/{id}     remove (cascades chunks)
//	POST   /documents/search   similarity search across selected docs
package ports

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"druz9/documents/app"
	"druz9/documents/domain"
	"druz9/documents/infra"
	"druz9/shared/pkg/killswitch"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/pkg/ratelimit"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handler bundles use-case pointers plus the logger. Construction lives
// in the monolith wiring so all deps flow through one spot.
type Handler struct {
	Upload        *app.Upload
	UploadFromURL *app.UploadFromURL
	Get           *app.Get
	List          *app.List
	Delete        *app.Delete
	Search        *app.Search
	// Limiter guards write-path endpoints from burn-through on the
	// Groq free-tier embedder budget. nil = rate limiting disabled
	// (dev without Redis).
	Limiter *ratelimit.RedisFixedWindow
	// Kill switch — operator can flip `killswitch:documents_upload`
	// or `killswitch:documents_url` in Redis to instantly 503 those
	// endpoints without a deploy. Reads don't kill (GET/list stay up
	// so users don't lose visibility into what they already have).
	KillSwitch *killswitch.Switch
	Log        *slog.Logger
}

// killedIf returns true + writes 503 when the named feature is
// tripped; false otherwise. Caller early-returns on true.
func (h *Handler) killedIf(w http.ResponseWriter, r *http.Request, f killswitch.Feature) bool {
	if h.KillSwitch == nil {
		return false
	}
	if !h.KillSwitch.IsOn(r.Context(), f) {
		return false
	}
	w.Header().Set("Retry-After", "60")
	writeError(w, http.StatusServiceUnavailable, "feature temporarily disabled by operator")
	return true
}

// Per-op budgets — all user-scoped. Upload is the priciest (embedder
// cost per chunk); URL fetch is externally-bandwidth expensive; search
// embeds one query per call and hits pgvector-ish cosine, so cheaper.
const (
	uploadLimitPerMin    = 20
	uploadURLLimitPerMin = 10
	searchLimitPerMin    = 60
	deleteLimitPerMin    = 60
)

// checkLimit runs the limiter for (userID, op). Returns true when the
// request should proceed; on rate-limit it emits the proper 429 +
// Retry-After header and returns false. A nil Limiter degrades to
// "always allow" so dev-without-Redis stays usable.
func (h *Handler) checkLimit(ctx context.Context, w http.ResponseWriter, userID uuid.UUID, op string, limit int) bool {
	if h.Limiter == nil {
		return true
	}
	key := "rl:docs:" + op + ":" + userID.String()
	res, err := h.Limiter.Allow(ctx, key, limit, time.Minute)
	if err != nil {
		// Fail-open on Redis transport errors. A Redis outage
		// shouldn't lock users out of the whole feature.
		if h.Log != nil {
			h.Log.Warn("documents: rate-limit probe failed — allowing",
				slog.String("op", op), slog.Any("err", err))
		}
		return true
	}
	if !res.Allowed {
		w.Header().Set("Retry-After", strconv.Itoa(res.RetryAfterSec))
		writeError(w, http.StatusTooManyRequests, "rate limited, retry in "+strconv.Itoa(res.RetryAfterSec)+"s")
		return false
	}
	return true
}

func (h *Handler) Mount(r chi.Router) {
	r.Post("/documents", h.handleUpload)
	r.Post("/documents/from-url", h.handleUploadFromURL)
	r.Post("/documents/search", h.handleSearch)
	r.Get("/documents", h.handleList)
	r.Get("/documents/{id}", h.handleGet)
	r.Delete("/documents/{id}", h.handleDelete)
}

// ─────────────────────────────────────────────────────────────────────────
// Wire types
// ─────────────────────────────────────────────────────────────────────────

type documentDTO struct {
	ID           string `json:"id"`
	Filename     string `json:"filename"`
	MIME         string `json:"mime"`
	SizeBytes    int64  `json:"size_bytes"`
	SourceURL    string `json:"source_url,omitempty"`
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message,omitempty"`
	ChunkCount   int    `json:"chunk_count"`
	TokenCount   int    `json:"token_count"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func toDTO(d domain.Document) documentDTO {
	return documentDTO{
		ID:           d.ID.String(),
		Filename:     d.Filename,
		MIME:         d.MIME,
		SizeBytes:    d.SizeBytes,
		SourceURL:    d.SourceURL,
		Status:       string(d.Status),
		ErrorMessage: d.ErrorMessage,
		ChunkCount:   d.ChunkCount,
		TokenCount:   d.TokenCount,
		CreatedAt:    d.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:    d.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

type uploadReq struct {
	Filename   string `json:"filename"`
	MIME       string `json:"mime"`
	ContentB64 string `json:"content_base64"`
	SourceURL  string `json:"source_url"`
}

type uploadFromURLReq struct {
	URL string `json:"url"`
}

type listResp struct {
	Documents  []documentDTO `json:"documents"`
	NextCursor string        `json:"next_cursor,omitempty"`
}

type searchReq struct {
	DocIDs   []string `json:"doc_ids"`
	Query    string   `json:"query"`
	TopK     int      `json:"top_k"`
	MinScore float32  `json:"min_score"`
}

type searchHitDTO struct {
	DocID   string  `json:"doc_id"`
	ChunkID string  `json:"chunk_id"`
	Ord     int     `json:"ord"`
	Score   float32 `json:"score"`
	Content string  `json:"content"`
}

type searchResp struct {
	Hits []searchHitDTO `json:"hits"`
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request) {
	if h.killedIf(w, r, killswitch.FeatureDocumentsUpload) {
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.checkLimit(r.Context(), w, uid, "upload", uploadLimitPerMin) {
		return
	}

	// JSON + base64 rather than multipart for the first iteration:
	// (a) desktop already speaks JSON everywhere, (b) multipart adds
	// a parse-budget we'd have to tune carefully, (c) MVP file sizes
	// are ≤ 10MB which base64 inflates to 14MB — still well under the
	// request-body budget. multipart goes in when we add PDF/DOCX in
	// the next iteration (large binaries benefit from streaming parse).
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20) // 16MB cap on raw request
	defer r.Body.Close()

	var req uploadReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.Filename == "" || req.MIME == "" || req.ContentB64 == "" {
		writeError(w, http.StatusBadRequest, "filename, mime, content_base64 are required")
		return
	}
	content, err := base64.StdEncoding.DecodeString(req.ContentB64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid base64 content")
		return
	}

	doc, err := h.Upload.Do(r.Context(), app.UploadInput{
		UserID:    uid,
		Filename:  req.Filename,
		MIME:      req.MIME,
		Content:   content,
		SourceURL: req.SourceURL,
	})
	if err != nil {
		h.logErr(r, "upload", err)
		switch {
		case errors.Is(err, domain.ErrTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, err.Error())
		case errors.Is(err, domain.ErrEmptyContent):
			writeError(w, http.StatusUnprocessableEntity, err.Error())
		case errors.Is(err, domain.ErrUnsupportedMIME):
			writeError(w, http.StatusUnsupportedMediaType, err.Error())
		default:
			writeError(w, http.StatusInternalServerError, "upload failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, toDTO(doc))
}

func (h *Handler) handleUploadFromURL(w http.ResponseWriter, r *http.Request) {
	if h.killedIf(w, r, killswitch.FeatureDocumentsURL) {
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if h.UploadFromURL == nil {
		writeError(w, http.StatusServiceUnavailable, "url ingestion not configured")
		return
	}
	if !h.checkLimit(r.Context(), w, uid, "upload-url", uploadURLLimitPerMin) {
		return
	}
	var req uploadFromURLReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	doc, err := h.UploadFromURL.Do(r.Context(), app.UploadFromURLInput{
		UserID: uid,
		URL:    req.URL,
	})
	if err != nil {
		h.logErr(r, "upload-from-url", err)
		switch {
		case errors.Is(err, domain.ErrTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, err.Error())
		case errors.Is(err, domain.ErrEmptyContent):
			// Readability couldn't find content — usually SPA/auth-wall.
			// 422 rather than 500 because the request was fine; the
			// target URL is just not parseable.
			writeError(w, http.StatusUnprocessableEntity, "could not extract content from url")
		case errors.Is(err, domain.ErrUnsupportedMIME):
			writeError(w, http.StatusUnsupportedMediaType, err.Error())
		default:
			// Surface the first error-line to the user — it contains
			// the HTTP status or parse reason which is more actionable
			// than "upload failed".
			writeError(w, http.StatusBadGateway, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, toDTO(doc))
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}
	out, err := h.List.Do(r.Context(), app.ListInput{
		UserID: uid,
		Cursor: r.URL.Query().Get("cursor"),
		Limit:  limit,
	})
	if err != nil {
		h.logErr(r, "list", err)
		writeError(w, http.StatusInternalServerError, "list failed")
		return
	}
	resp := listResp{Documents: make([]documentDTO, len(out.Documents)), NextCursor: out.NextCursor}
	for i, d := range out.Documents {
		resp.Documents[i] = toDTO(d)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	doc, err := h.Get.Do(r.Context(), uid, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		h.logErr(r, "get", err)
		writeError(w, http.StatusInternalServerError, "get failed")
		return
	}
	writeJSON(w, http.StatusOK, toDTO(doc))
}

func (h *Handler) handleDelete(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.checkLimit(r.Context(), w, uid, "delete", deleteLimitPerMin) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Delete.Do(r.Context(), uid, id); err != nil {
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

func (h *Handler) handleSearch(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !h.checkLimit(r.Context(), w, uid, "search", searchLimitPerMin) {
		return
	}
	var req searchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if req.Query == "" {
		writeError(w, http.StatusBadRequest, "query is required")
		return
	}
	ids := make([]uuid.UUID, 0, len(req.DocIDs))
	for _, s := range req.DocIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid doc id: "+s)
			return
		}
		ids = append(ids, id)
	}
	hits, err := h.Search.Do(r.Context(), app.SearchInput{
		UserID:   uid,
		DocIDs:   ids,
		Query:    req.Query,
		TopK:     req.TopK,
		MinScore: req.MinScore,
	}, infra.CosineTopK)
	if err != nil {
		h.logErr(r, "search", err)
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	resp := searchResp{Hits: make([]searchHitDTO, len(hits))}
	for i, h := range hits {
		resp.Hits[i] = searchHitDTO{
			DocID:   h.Chunk.DocID.String(),
			ChunkID: h.Chunk.ID.String(),
			Ord:     h.Chunk.Ord,
			Score:   h.Score,
			Content: h.Chunk.Content,
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

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
	h.Log.ErrorContext(r.Context(), "documents.handler",
		slog.String("op", op),
		slog.Any("err", err))
}
