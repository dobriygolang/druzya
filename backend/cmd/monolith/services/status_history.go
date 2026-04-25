// status_history.go — public GET /api/v1/status/history endpoint.
//
// Per-day status buckets for the spark bars on the public /status page.
// Derived from the `incidents` log (the same source that drives Uptime
// 90d on the main /status snapshot). When real Prometheus `up` series
// land this is the place to swap in `prometheus.Range` queries — the
// JSON shape stays stable.
//
// Public mount (no auth) — same gate level as the existing /status
// Connect-RPC endpoint.
package services

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	adminInfra "druz9/admin/infra"

	"github.com/go-chi/chi/v5"
)

type statusHistoryDay struct {
	Day    string `json:"day"`    // YYYY-MM-DD (UTC)
	Status string `json:"status"` // operational | degraded | down
}

type statusHistoryResp struct {
	Service string             `json:"service"`
	Days    int                `json:"days"`
	Buckets []statusHistoryDay `json:"buckets"`
}

// NewStatusHistory wires the public history endpoint.
func NewStatusHistory(d Deps) *Module {
	repo := adminInfra.NewIncidents(d.Pool)
	return &Module{
		MountPublicREST: func(r chi.Router) {
			r.Get("/status/history", func(w http.ResponseWriter, r *http.Request) {
				slug := r.URL.Query().Get("service")
				days := 30
				if v := r.URL.Query().Get("days"); v != "" {
					if n, err := strconv.Atoi(v); err == nil && n > 0 {
						days = n
					}
				}
				if days > 90 {
					days = 90
				}
				buckets, err := repo.DailyBuckets(r.Context(), slug, days, time.Now())
				if err != nil {
					http.Error(w, "history unavailable", http.StatusServiceUnavailable)
					return
				}
				out := statusHistoryResp{Service: slug, Days: days, Buckets: make([]statusHistoryDay, 0, len(buckets))}
				for _, b := range buckets {
					out.Buckets = append(out.Buckets, statusHistoryDay{
						Day:    b.Day.Format("2006-01-02"),
						Status: string(b.Status),
					})
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Cache-Control", "public, max-age=60")
				_ = json.NewEncoder(w).Encode(out)
			})
		},
	}
}
