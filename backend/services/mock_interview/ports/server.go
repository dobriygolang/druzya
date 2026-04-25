// Package ports — HTTP layer for mock_interview.
//
// Phase A keeps the surface chi-REST-only: the proto / Connect layer is
// deferred to Phase B (where the orchestrator will stabilise the shapes).
//
// Auth model:
//   - admin endpoints use requireAdmin (role=admin claim from auth middleware)
//   - public endpoints (companies list, pipelines create / get / list) use
//     requireAuth (any authenticated user). The router-level middleware
//     already forces bearer-auth on /api/v1; we additionally pull the
//     userID from context and 401 if absent.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

const adminRoleClaim = "admin"

// Server is the chi-mountable wrapper.
type Server struct {
	H      *app.Handlers
	Orch   *app.Orchestrator
	Canvas domain.CanvasStore
	Log    *slog.Logger
}

// NewServer takes the use-case bundle plus the orchestrator (Phase B). The
// orchestrator may be nil — Phase A admin/CRUD endpoints don't need it,
// they will simply 503 on the new public routes. canvas may be nil — when so
// (or when .Available() is false) attempt DTOs pass image URLs through as-is
// (legacy inline-data-url shape).
func NewServer(h *app.Handlers, orch *app.Orchestrator, canvas domain.CanvasStore, log *slog.Logger) *Server {
	return &Server{H: h, Orch: orch, Canvas: canvas, Log: log}
}

// requireUser pulls the caller's user-id. Returns false + writes 401.
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return uuid.Nil, false
	}
	return uid, true
}

// requireAdmin = requireUser + role=admin claim.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return uuid.Nil, false
	}
	role, rok := sharedMw.UserRoleFromContext(r.Context())
	if !rok || role != adminRoleClaim {
		writeErr(w, http.StatusForbidden, "admin role required")
		return uuid.Nil, false
	}
	return uid, true
}

// writeJSON / writeErr — minimal helpers, intentionally local (the monolith
// has its own writeJSON in services/, but the service package shouldn't
// depend on monolith internals).
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": msg}})
}

// canvasS3Prefix marks an out-of-band-stored canvas image (see app.canvasS3Prefix).
const canvasS3Prefix = "s3://"

// canvasPresignTTL — signed URL validity. Long enough to view feedback after
// reload; short enough that a leaked URL ages out fast.
const canvasPresignTTL = time.Hour

// rewriteCanvasURL mutates dto.UserExcalidrawImageURL: when it has the
// "s3://bucket/key" sentinel, presign and return a signed GET URL via the
// canvas store. On any failure or when the store is unavailable we leave the
// raw value (the frontend will simply fail to render the image — clearer
// than a stale cached URL).
func (s *Server) rewriteCanvasURL(ctx context.Context, raw string) string {
	if !strings.HasPrefix(raw, canvasS3Prefix) {
		return raw
	}
	if s == nil || s.Canvas == nil || !s.Canvas.Available() {
		return raw
	}
	// "s3://<key>" → "<key>". Bucket is owned by the canvas store; we don't
	// duplicate it in the DB sentinel so a rename only touches the store config.
	key := raw[len(canvasS3Prefix):]
	signed, err := s.Canvas.PresignGet(ctx, key, canvasPresignTTL)
	if err != nil {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "mock_interview.ports: canvas presign failed", "key", key, "err", err)
		}
		return raw
	}
	return signed
}

// presignStageWithAttempts walks every attempt in a stage DTO and rewrites
// canvas image URLs in place.
func (s *Server) presignStageWithAttempts(ctx context.Context, st *pipelineStageWithAttemptsDTO) {
	if st == nil {
		return
	}
	for i := range st.Attempts {
		st.Attempts[i].UserExcalidrawImageURL = s.rewriteCanvasURL(ctx, st.Attempts[i].UserExcalidrawImageURL)
	}
}

// presignPipelineFull walks every attempt across every stage in a full
// pipeline DTO and rewrites canvas image URLs in place.
func (s *Server) presignPipelineFull(ctx context.Context, p *pipelineFullDTO) {
	if p == nil {
		return
	}
	for i := range p.Stages {
		s.presignStageWithAttempts(ctx, &p.Stages[i])
	}
}

// errToHTTP maps domain errors to HTTP status codes. Unknown errors become
// 500 with a generic message — full detail is logged.
func (s *Server) errToHTTP(w http.ResponseWriter, r *http.Request, err error, op string) {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, domain.ErrConflict):
		writeErr(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrValidation):
		writeErr(w, http.StatusBadRequest, err.Error())
	default:
		if s.Log != nil {
			s.Log.ErrorContext(r.Context(), "mock_interview: internal", slog.String("op", op), slog.Any("err", err))
		}
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}
