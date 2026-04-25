// discover.go — `GET /api/v1/circles/discover` returns circles the caller
// is NOT yet in, newest first, with member counts. Used by the /circles
// "Discover" tab so users can browse and join.
//
// Why chi-direct REST (not Connect): same rationale as arena queue-stats —
// tiny shape, no proto regen needed, faster iteration. The existing
// Connect surface (`ListMyCircles`) stays untouched.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"druz9/circles/app"
	sharedMw "druz9/shared/pkg/middleware"
)

// DiscoverHandler — http.Handler for GET /circles/discover.
type DiscoverHandler struct {
	H   *app.Handlers
	Log *slog.Logger
}

// NewDiscoverHandler wires the handler.
func NewDiscoverHandler(h *app.Handlers, log *slog.Logger) *DiscoverHandler {
	return &DiscoverHandler{H: h, Log: log}
}

type discoverCircleDTO struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	OwnerID     string    `json:"owner_id"`
	MemberCount int       `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type discoverResponse struct {
	Items []discoverCircleDTO `json:"items"`
}

// ServeHTTP — auth required (parent chain enforces bearer).
func (h *DiscoverHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	circles, err := h.H.ListDiscover(r.Context(), uid, limit)
	if err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "circles.discover: list failed", slog.Any("err", err))
		}
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	out := make([]discoverCircleDTO, 0, len(circles))
	for _, c := range circles {
		out = append(out, discoverCircleDTO{
			ID:          c.ID.String(),
			Name:        c.Name,
			Description: c.Description,
			OwnerID:     c.OwnerID.String(),
			MemberCount: c.MemberCount,
			CreatedAt:   c.CreatedAt,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=15")
	if err := json.NewEncoder(w).Encode(discoverResponse{Items: out}); err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "circles.discover: encode failed", slog.Any("err", err))
		}
	}
}
