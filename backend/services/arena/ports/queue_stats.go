// queue_stats.go — `GET /api/v1/arena/queue-stats` returns the number of
// players currently waiting in each (mode, section) queue. The /arena
// landing page shows this so users see live queue activity instead of
// hardcoded fake numbers.
//
// Why chi-direct REST (not Connect): same reason as current_match.go — a
// tiny polling endpoint with no proto value, fast iteration, no codegen.
//
// Anti-fallback: if Redis errors, we return 500 — never invent zeros.
package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"
)

// QueueWaitingReader — narrow port the handler needs from QueueRepo. Lets
// the handler test against a stub without dragging the whole repo.
type QueueWaitingReader interface {
	Waiting(ctx context.Context, section enums.Section, mode enums.ArenaMode) (int, error)
}

// QueueStatsHandler — http.Handler for GET /arena/queue-stats.
type QueueStatsHandler struct {
	Repo QueueWaitingReader
	Log  *slog.Logger
}

// NewQueueStatsHandler wires the handler.
func NewQueueStatsHandler(repo QueueWaitingReader, log *slog.Logger) *QueueStatsHandler {
	return &QueueStatsHandler{Repo: repo, Log: log}
}

// queueStatRow — single (mode, section) wait-count row in the response.
type queueStatRow struct {
	Mode    string `json:"mode"`
	Section string `json:"section"`
	Waiting int    `json:"waiting"`
}

// queueStatsResponse envelopes the rows + a per-mode aggregate that the
// frontend uses directly without re-summing on the client.
type queueStatsResponse struct {
	Items       []queueStatRow `json:"items"`
	ByMode      map[string]int `json:"by_mode"`      // mode → sum across sections
	GeneratedAt int64          `json:"generated_at"` // unix-ms — caller can decide staleness
}

// modesForLanding — modes shown on the /arena landing-page cards. Cursed
// is excluded (not on the landing). One ZCard per (mode × section) is
// cheap — Redis ZCard is O(1), and 4 modes × 5 sections = 20 calls per
// request, well within a single round-trip on a hot connection.
var modesForLanding = []enums.ArenaMode{
	enums.ArenaModeRanked,
	enums.ArenaModeSolo1v1,
	enums.ArenaModeDuo2v2,
	enums.ArenaModeHardcore,
}

// sectionsForLanding — every Section that the matchmaker accepts.
var sectionsForLanding = []enums.Section{
	enums.SectionAlgorithms,
	enums.SectionSQL,
	enums.SectionGo,
	enums.SectionSystemDesign,
	enums.SectionBehavioral,
}

// ServeHTTP handles GET. Auth is enforced by the parent chi chain (we don't
// need user_id here, the response is the same for everyone).
func (h *QueueStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	rows := make([]queueStatRow, 0, len(modesForLanding)*len(sectionsForLanding))
	byMode := make(map[string]int, len(modesForLanding))
	for _, m := range modesForLanding {
		byMode[string(m)] = 0
		for _, s := range sectionsForLanding {
			n, err := h.Repo.Waiting(r.Context(), s, m)
			if err != nil {
				if h.Log != nil {
					h.Log.WarnContext(r.Context(), "arena.queue_stats: waiting failed",
						slog.String("mode", string(m)),
						slog.String("section", string(s)),
						slog.Any("err", err))
				}
				writeJSONError(w, http.StatusInternalServerError, "queue stats unavailable")
				return
			}
			rows = append(rows, queueStatRow{
				Mode:    string(m),
				Section: string(s),
				Waiting: n,
			})
			byMode[string(m)] += n
		}
	}
	resp := queueStatsResponse{
		Items:       rows,
		ByMode:      byMode,
		GeneratedAt: time.Now().UnixMilli(),
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=10")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "arena.queue_stats: encode failed", slog.Any("err", err))
		}
	}
}

// Compile-time assertion the canonical arena domain repo satisfies the
// reader port — wiring breakage shows up at build time.
var _ QueueWaitingReader = (domain.QueueRepo)(nil)
