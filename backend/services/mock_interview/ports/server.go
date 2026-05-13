// Package ports — HTTP layer for mock_interview.
//
// The surface is chi-REST-only; the proto / Connect layer is deferred
// until the orchestrator shapes stabilise.
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
	// AlgoGrader powers RunAlgoAttempt. Nil-safe — the handler returns
	// CodeUnavailable when missing (dev / sandbox-disabled environments).
	AlgoGrader *app.AlgoGrader
	// CodingGrader powers RunCodingAttempt — LLM rubric for open-ended code.
	CodingGrader *app.CodingGrader
	// SysDesignGrader powers RunSysDesignAttempt — 5-axis rubric for sysdesign.
	SysDesignGrader *app.SysDesignGrader
	// BehavioralGrader powers RunBehavioralAttempt — STAR rubric.
	BehavioralGrader *app.BehavioralGrader
	Log              *slog.Logger
}

// NewServer takes the use-case bundle plus the orchestrator. The
// orchestrator may be nil — admin/CRUD endpoints don't need it, and
// public routes simply 503 without one.
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
