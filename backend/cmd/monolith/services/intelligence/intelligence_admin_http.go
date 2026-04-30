// Phase 5 — admin /intelligence dashboard chi-direct handler.
//
// Returns aggregated metrics for the coach surface:
//   - severity_distribution (cruise/nudge/warn/critical counts за окно)
//   - follow_rate / dismiss_rate (по EpisodeBriefFollowed / Dismissed)
//   - persona / prompt_variant / reflective flag (current dynamic_config)
//   - abandoned_mock_count (за окно — Phase 4.7 sanity check)
//   - total_briefs / total_recommendations (для context)
//
// Admin-only: role check внутри handler'а (role=admin enforced via
// sharedMw.UserRoleFromContext).
//
// Зачем chi-direct: read-only dashboard, единственный consumer — admin
// SPA. Через proto/transcoder было бы 3+ дополнительных RPC name'а в
// generated TS catalogue без выгоды. Mirror'им паттерн admin/observability_handler.
package intelligence

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	intelInfra "druz9/intelligence/infra"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultStatsWindowDays = 30
	maxStatsWindowDays     = 90
)

// adminStatsResponse — wire-shape для frontend admin/intelligence page.
type adminStatsResponse struct {
	WindowDays           int            `json:"window_days"`
	TotalBriefs          int            `json:"total_briefs"`
	TotalRecommendations int            `json:"total_recommendations"`
	SeverityDistribution map[string]int `json:"severity_distribution"` // cruise/nudge/warn/critical → count
	FollowCount          int            `json:"follow_count"`
	DismissCount         int            `json:"dismiss_count"`
	FollowRatePct        int            `json:"follow_rate_pct"` // 0..100; -1 если нет ack-эпизодов
	AbandonedMockCount   int            `json:"abandoned_mock_count"`
	Persona              string         `json:"persona"`        // current value, "" = default
	PromptVariant        string         `json:"prompt_variant"` // current value, "default" если empty
	ReflectiveEnabled    bool           `json:"reflective_enabled"`
}

// newAdminStatsHandler — GET /admin/intelligence/stats?days=N
func newAdminStatsHandler(pool *pgxpool.Pool, log *slog.Logger) http.HandlerFunc {
	cfg := intelInfra.NewDBCoachConfigReader(pool)
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAdmin(w, r) {
			return
		}
		days := defaultStatsWindowDays
		if d := r.URL.Query().Get("days"); d != "" {
			if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= maxStatsWindowDays {
				days = v
			}
		}
		out := adminStatsResponse{
			WindowDays:           days,
			SeverityDistribution: map[string]int{"cruise": 0, "nudge": 0, "warn": 0, "critical": 0},
			FollowRatePct:        -1,
		}

		// Severity distribution + total briefs — single GROUP BY scan.
		if err := scanSeverityDistribution(r.Context(), pool, days, &out); err != nil {
			adminWriteErr(w, log, r, "severity", err)
			return
		}
		// Total recommendations — sum jsonb_array_length(payload->recommendations).
		if err := scanTotalRecs(r.Context(), pool, days, &out); err != nil {
			adminWriteErr(w, log, r, "recs", err)
			return
		}
		// Follow / dismiss counts.
		if err := scanAckCounts(r.Context(), pool, days, &out); err != nil {
			adminWriteErr(w, log, r, "ack", err)
			return
		}
		// Abandoned mocks — Phase 4.7 sanity check on the fleet.
		if err := scanAbandonedMocks(r.Context(), pool, days, &out); err != nil {
			adminWriteErr(w, log, r, "abandoned_mocks", err)
			return
		}
		// Current dynamic_config flags.
		out.Persona = string(cfg.Persona(r.Context()))
		out.PromptVariant = string(cfg.PromptVariant(r.Context()))
		out.ReflectiveEnabled = cfg.ReflectiveEnabled(r.Context())

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func scanSeverityDistribution(ctx context.Context, pool *pgxpool.Pool, days int, out *adminStatsResponse) error {
	rows, err := pool.Query(ctx,
		`SELECT COALESCE(payload->>'severity', 'cruise') AS sev, COUNT(*)::int4
		   FROM hone_daily_briefs
		  WHERE brief_date >= CURRENT_DATE - ($1 || ' days')::interval
		  GROUP BY sev`,
		fmt.Sprintf("%d", days),
	)
	if err != nil {
		return fmt.Errorf("intelligence.admin.scanSeverityDistribution: query: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			sev string
			n   int32
		)
		if err := rows.Scan(&sev, &n); err != nil {
			return fmt.Errorf("intelligence.admin.scanSeverityDistribution: scan: %w", err)
		}
		switch sev {
		case "critical", "warn", "nudge", "cruise":
			out.SeverityDistribution[sev] = int(n)
		default:
			// Empty payload severity = cruise (legacy rows pre-Phase 4.4).
			out.SeverityDistribution["cruise"] += int(n)
		}
		out.TotalBriefs += int(n)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("intelligence.admin.scanSeverityDistribution: rows: %w", err)
	}
	return nil
}

func scanTotalRecs(ctx context.Context, pool *pgxpool.Pool, days int, out *adminStatsResponse) error {
	var total int32
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(jsonb_array_length(COALESCE(payload->'recommendations', '[]'::jsonb)))::int4, 0)
		   FROM hone_daily_briefs
		  WHERE brief_date >= CURRENT_DATE - ($1 || ' days')::interval`,
		fmt.Sprintf("%d", days),
	).Scan(&total)
	if err != nil {
		return fmt.Errorf("intelligence.admin.scanTotalRecs: %w", err)
	}
	out.TotalRecommendations = int(total)
	return nil
}

func scanAckCounts(ctx context.Context, pool *pgxpool.Pool, days int, out *adminStatsResponse) error {
	rows, err := pool.Query(ctx,
		`SELECT kind, COUNT(*)::int4
		   FROM coach_episodes
		  WHERE kind IN ('brief_followed', 'brief_dismissed')
		    AND occurred_at >= now() - ($1 || ' days')::interval
		  GROUP BY kind`,
		fmt.Sprintf("%d", days),
	)
	if err != nil {
		return fmt.Errorf("intelligence.admin.scanAckCounts: query: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			kind string
			n    int32
		)
		if err := rows.Scan(&kind, &n); err != nil {
			return fmt.Errorf("intelligence.admin.scanAckCounts: scan: %w", err)
		}
		switch kind {
		case "brief_followed":
			out.FollowCount = int(n)
		case "brief_dismissed":
			out.DismissCount = int(n)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("intelligence.admin.scanAckCounts: rows: %w", err)
	}
	totalAck := out.FollowCount + out.DismissCount
	if totalAck > 0 {
		out.FollowRatePct = (out.FollowCount * 100) / totalAck
	}
	return nil
}

func scanAbandonedMocks(ctx context.Context, pool *pgxpool.Pool, days int, out *adminStatsResponse) error {
	var n int32
	err := pool.QueryRow(ctx,
		`SELECT COUNT(*)::int4
		   FROM mock_sessions
		  WHERE status = 'abandoned'
		    AND created_at >= now() - ($1 || ' days')::interval`,
		fmt.Sprintf("%d", days),
	).Scan(&n)
	if err != nil {
		return fmt.Errorf("intelligence.admin.scanAbandonedMocks: %w", err)
	}
	out.AbandonedMockCount = int(n)
	return nil
}

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return false
	}
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != string(enums.UserRoleAdmin) {
		http.Error(w, `{"error":"admin role required"}`, http.StatusForbidden)
		return false
	}
	return true
}

func adminWriteErr(w http.ResponseWriter, log *slog.Logger, r *http.Request, op string, err error) {
	if log != nil {
		log.WarnContext(r.Context(), "intelligence.admin.stats", slog.String("op", op), slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}
