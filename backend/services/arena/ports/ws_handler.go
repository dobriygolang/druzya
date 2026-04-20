package ports

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// WSHandler is the chi-compatible HandlerFunc registered at /ws/arena/{matchId}.
// oapi-codegen doesn't generate WS routes, so the caller (cmd/monolith) mounts
// this one route manually next to the generated API router.
func (h *Hub) WSHandler(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "matchId")
	matchID, err := uuid.Parse(raw)
	if err != nil {
		http.Error(w, "bad match id", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	if h.Verifier == nil {
		http.Error(w, "no token verifier wired", http.StatusInternalServerError)
		return
	}
	uid, err := h.Verifier.VerifyAccess(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	h.ServeWS(w, r, matchID, uid)
}
