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
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

const adminRoleClaim = "admin"

// Server is the chi-mountable wrapper.
type Server struct {
	H    *app.Handlers
	Orch *app.Orchestrator
	Log  *slog.Logger
}

// NewServer takes the use-case bundle plus the orchestrator (Phase B). The
// orchestrator may be nil — Phase A admin/CRUD endpoints don't need it,
// they will simply 503 on the new public routes.
func NewServer(h *app.Handlers, orch *app.Orchestrator, log *slog.Logger) *Server {
	return &Server{H: h, Orch: orch, Log: log}
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
