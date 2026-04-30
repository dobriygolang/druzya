// observability_handler.go — chi-direct admin endpoints for the three
// observability panels (Wave 3.5.x of docs/feature/plan.md):
//
//	GET  /admin/observability/tracks        → track-kind distribution
//	GET  /admin/observability/english-hr    → English HR mock stats
//	GET  /admin/observability/mock-block    → strict / ai_assist split
//
// We deliberately bypass Connect/transcoder for this surface — it's
// read-only and admin-only, three RPC names worth nothing in the
// generated TS catalogue (the only consumer is the admin SPA, which
// already mounts a dozen chi-direct admin endpoints via fetch).
//
// Mirrors the pattern of profile/ports/atlas_admin_handler.go.
package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"druz9/admin/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"
)

const (
	observabilityWindowDays  = 30
	observabilityRecentLimit = 10
)

// ObservabilityRepo is the narrow read surface this handler needs.
// Defined here (not in domain/) so the handler can be tested with
// hand-rolled fakes without leaking unrelated repo methods.
type ObservabilityRepo interface {
	TrackDistribution(ctx context.Context) ([]domain.TrackDistributionRow, error)
	EnglishHRStats(ctx context.Context, windowDays, recentLimit int) (domain.EnglishHRStats, error)
	MockBlockMetrics(ctx context.Context, windowDays int) (domain.MockBlockMetrics, error)
}

type ObservabilityHandler struct {
	Repo ObservabilityRepo
	Log  *slog.Logger
}

func NewObservabilityHandler(repo ObservabilityRepo, log *slog.Logger) *ObservabilityHandler {
	if repo == nil {
		panic("admin.NewObservabilityHandler: repo is required")
	}
	if log == nil {
		panic("admin.NewObservabilityHandler: logger is required (anti-fallback policy)")
	}
	return &ObservabilityHandler{Repo: repo, Log: log}
}

// ── DTOs ──────────────────────────────────────────────────────────────────

type tracksDistResp struct {
	Items []trackRowDTO `json:"items"`
}

type trackRowDTO struct {
	Track        string `json:"track"`
	Total        int    `json:"total"`
	PrimaryCount int    `json:"primary_count"`
	Active30d    int    `json:"active_30d"`
}

type englishHRResp struct {
	WindowDays    int                  `json:"window_days"`
	TotalSessions int                  `json:"total_sessions"`
	WithReport    int                  `json:"with_report"`
	AvgScore      int                  `json:"avg_score"`
	ErrorRate     int                  `json:"error_rate"` // 0..100
	Recent        []englishHRRecentDTO `json:"recent"`
}

type englishHRRecentDTO struct {
	SessionID  string `json:"session_id"`
	UserHash   string `json:"user_hash"`
	FinishedAt string `json:"finished_at"` // RFC3339 UTC, empty when zero
	Score      int    `json:"score"`
	Errored    bool   `json:"errored"`
}

type mockBlockResp struct {
	WindowDays       int `json:"window_days"`
	TotalSessions    int `json:"total_sessions"`
	AIAssistSessions int `json:"ai_assist_sessions"`
	StrictSessions   int `json:"strict_sessions"`
	StrictPct        int `json:"strict_pct"`
}

// ── Routes ────────────────────────────────────────────────────────────────

// HandleTracks — GET /admin/observability/tracks
func (h *ObservabilityHandler) HandleTracks(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	rows, err := h.Repo.TrackDistribution(r.Context())
	if err != nil {
		h.Log.ErrorContext(r.Context(), "admin.observability.tracks", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := tracksDistResp{Items: make([]trackRowDTO, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, trackRowDTO{
			Track:        r.Track,
			Total:        r.Total,
			PrimaryCount: r.PrimaryCount,
			Active30d:    r.Active30d,
		})
	}
	writeJSON(w, out)
}

// HandleEnglishHR — GET /admin/observability/english-hr
func (h *ObservabilityHandler) HandleEnglishHR(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	stats, err := h.Repo.EnglishHRStats(r.Context(), observabilityWindowDays, observabilityRecentLimit)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "admin.observability.english_hr", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := englishHRResp{
		WindowDays:    observabilityWindowDays,
		TotalSessions: stats.TotalSessions,
		WithReport:    stats.WithReport,
		AvgScore:      stats.AvgScore,
		ErrorRate:     stats.ErrorRate,
		Recent:        make([]englishHRRecentDTO, 0, len(stats.Recent)),
	}
	for _, rec := range stats.Recent {
		ts := ""
		if !rec.FinishedAt.IsZero() {
			ts = rec.FinishedAt.UTC().Format(time.RFC3339)
		}
		out.Recent = append(out.Recent, englishHRRecentDTO{
			SessionID:  rec.SessionID,
			UserHash:   rec.UserHash,
			FinishedAt: ts,
			Score:      rec.Score,
			Errored:    rec.Errored,
		})
	}
	writeJSON(w, out)
}

// HandleMockBlock — GET /admin/observability/mock-block
func (h *ObservabilityHandler) HandleMockBlock(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	m, err := h.Repo.MockBlockMetrics(r.Context(), observabilityWindowDays)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "admin.observability.mock_block", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, mockBlockResp{
		WindowDays:       observabilityWindowDays,
		TotalSessions:    m.TotalSessions,
		AIAssistSessions: m.AIAssistSessions,
		StrictSessions:   m.StrictSessions,
		StrictPct:        m.StrictPct,
	})
}

// ── helpers ──────────────────────────────────────────────────────────────

func (h *ObservabilityHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Already streamed status=200; nothing to recover at this point.
		_ = err
	}
}

func writeJSONErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
