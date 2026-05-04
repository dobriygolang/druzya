// rooms_handler.go — Phase 12.5 /admin/rooms moderation REST endpoints.
//
// Chi-direct (не Connect-RPC) — admin UI читает JSON напрямую. Role-gate
// должен происходить uppstream router'ом (как для других /admin/* routes).
package ports

import (
	"log/slog"
	"net/http"
	"strconv"

	"druz9/admin/app"

	"github.com/google/uuid"
)

type AdminRoomsHandler struct {
	Reader *app.AdminRoomsReader
	Log    *slog.Logger
}

func NewAdminRoomsHandler(reader *app.AdminRoomsReader, log *slog.Logger) *AdminRoomsHandler {
	return &AdminRoomsHandler{Reader: reader, Log: log}
}

// GET /admin/rooms?user_id=&kind=&status=&limit=
func (h *AdminRoomsHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	f := app.AdminRoomsFilter{
		Kind:   r.URL.Query().Get("kind"),
		Status: r.URL.Query().Get("status"),
	}
	if uid := r.URL.Query().Get("user_id"); uid != "" {
		if id, err := uuid.Parse(uid); err == nil {
			f.UserID = &id
		}
	}
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			f.Limit = n
		}
	}
	out, err := h.Reader.List(r.Context(), f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

// GET /admin/rooms/top-creators?limit=
func (h *AdminRoomsHandler) HandleTopCreators(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}
	out, err := h.Reader.TopCreators(r.Context(), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

// POST /admin/rooms/bulk-archive — admin override TTL daemon. Archives
// all expired non-archived rooms across editor + whiteboard tables.
func (h *AdminRoomsHandler) HandleBulkArchive(w http.ResponseWriter, r *http.Request) {
	count, err := h.Reader.BulkArchiveExpired(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]int{"archived": count})
}
