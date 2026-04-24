package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/copilot/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// SessionDocumentsHandler owns the REST surface that mutates the
// session ↔ documents attachment list. Kept separate from the Connect-RPC
// CopilotServer because:
//   - these endpoints are plain REST (no streaming, no batching);
//   - adding them to the proto would require codegen churn for two
//     idempotent mutations that aren't called on any hot path;
//   - the desktop will call them directly (single URL, single id).
//
// Auth is read from context (bearer middleware). All paths are
// user-scoped via Sessions.AttachDocument/DetachDocument, which return
// ErrNotFound (→ 404) when the session doesn't belong to the caller —
// we never leak foreign-session existence.
type SessionDocumentsHandler struct {
	Sessions domain.SessionRepo
	Log      *slog.Logger
}

func (h *SessionDocumentsHandler) Mount(r chi.Router) {
	r.Post("/copilot/sessions/{sessionId}/documents/{docId}", h.handleAttach)
	r.Delete("/copilot/sessions/{sessionId}/documents/{docId}", h.handleDetach)
}

func (h *SessionDocumentsHandler) handleAttach(w http.ResponseWriter, r *http.Request) {
	uid, sessID, docID, ok := h.parseIDs(w, r)
	if !ok {
		return
	}
	if err := h.Sessions.AttachDocument(r.Context(), sessID, uid, docID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSONErr(w, http.StatusNotFound, "session not found")
			return
		}
		h.logErr(r, "attach", err)
		writeJSONErr(w, http.StatusInternalServerError, "attach failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SessionDocumentsHandler) handleDetach(w http.ResponseWriter, r *http.Request) {
	uid, sessID, docID, ok := h.parseIDs(w, r)
	if !ok {
		return
	}
	if err := h.Sessions.DetachDocument(r.Context(), sessID, uid, docID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSONErr(w, http.StatusNotFound, "session not found")
			return
		}
		h.logErr(r, "detach", err)
		writeJSONErr(w, http.StatusInternalServerError, "detach failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SessionDocumentsHandler) parseIDs(w http.ResponseWriter, r *http.Request) (uid, sessID, docID uuid.UUID, ok bool) {
	var okAuth bool
	uid, okAuth = sharedMw.UserIDFromContext(r.Context())
	if !okAuth {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var err error
	sessID, err = uuid.Parse(chi.URLParam(r, "sessionId"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid session id")
		return
	}
	docID, err = uuid.Parse(chi.URLParam(r, "docId"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid document id")
		return
	}
	ok = true
	return
}

func (h *SessionDocumentsHandler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "copilot.session_docs",
		slog.String("op", op),
		slog.Any("err", err))
}

// writeJSONErr mirrors the documents handler shape. Kept local instead
// of shared utils — ports-level helpers belong with the handlers that
// use them.
func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}
