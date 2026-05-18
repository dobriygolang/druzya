// llm_usage_stats.go — admin LLM cost / usage aggregator.
//
// Reads llm_invocations and groups rows by one of task / user / day /
// provider. Returns per-group totals + per-group summary (sum of cost
// cents, sum of calls, etc.).
//
// Why not reuse ObservabilityReader: that one buckets at day granularity
// only (dynamic_config_metrics) and never tracks user_id — too coarse for
// the «who spent $X» admin view. The new table keeps per-call rows so we
// can pivot.
package app

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LLMUsagePeriod — closed enum mirroring proto.
type LLMUsagePeriod string

const (
	LLMUsagePeriod1d  LLMUsagePeriod = "1d"
	LLMUsagePeriod7d  LLMUsagePeriod = "7d"
	LLMUsagePeriod30d LLMUsagePeriod = "30d"
)

// LLMUsageGroup — closed enum mirroring proto.
type LLMUsageGroup string

const (
	LLMUsageGroupTask     LLMUsageGroup = "task"
	LLMUsageGroupUser     LLMUsageGroup = "user"
	LLMUsageGroupDay      LLMUsageGroup = "day"
	LLMUsageGroupProvider LLMUsageGroup = "provider"
)

// LLMUsageRow — one row of the admin response.
type LLMUsageRow struct {
	DimensionKey      string // task_kind / user_id / YYYY-MM-DD / provider
	TotalCalls        int64
	TotalInputTokens  int64
	TotalOutputTokens int64
	TotalCostCents    int64
	AvgLatencyMs      int64
}

// LLMUsageReport — output of the UC.
type LLMUsageReport struct {
	Rows           []LLMUsageRow
	TotalCostCents int64
	TotalCalls     int64
}

// GetLLMUsageStats — UC.
type GetLLMUsageStats struct {
	Pool *pgxpool.Pool
}

// Do executes the aggregation. Period clamps to 1d / 7d / 30d; group_by
// clamps to one of the supported axes.
func (uc *GetLLMUsageStats) Do(ctx context.Context, period LLMUsagePeriod, group LLMUsageGroup) (LLMUsageReport, error) {
	if uc.Pool == nil {
		return LLMUsageReport{}, fmt.Errorf("admin.GetLLMUsageStats: pool not configured")
	}

	days := periodDays(period)
	groupCol := groupColumn(group)

	q := fmt.Sprintf(`
SELECT %s AS dim,
       COUNT(*)                                AS total_calls,
       COALESCE(SUM(input_tokens), 0)::bigint  AS tokens_in,
       COALESCE(SUM(output_tokens), 0)::bigint AS tokens_out,
       COALESCE(SUM(cost_estimate_cents), 0)::bigint AS cost_cents,
       COALESCE(AVG(latency_ms), 0)::bigint    AS avg_lat_ms
FROM llm_invocations
WHERE created_at >= NOW() - $1::interval
GROUP BY %s
ORDER BY cost_cents DESC, total_calls DESC
LIMIT 200`, groupCol, groupCol)

	rows, err := uc.Pool.Query(ctx, q, daysInterval(days))
	if err != nil {
		return LLMUsageReport{}, fmt.Errorf("admin.GetLLMUsageStats query: %w", err)
	}
	defer rows.Close()

	out := LLMUsageReport{}
	for rows.Next() {
		var r LLMUsageRow
		// dim is a TEXT or DATE depending on group; pgx will scan into *string
		// thanks to the explicit ::text cast below in groupColumn().
		if err := rows.Scan(&r.DimensionKey, &r.TotalCalls, &r.TotalInputTokens,
			&r.TotalOutputTokens, &r.TotalCostCents, &r.AvgLatencyMs); err != nil {
			return LLMUsageReport{}, fmt.Errorf("admin.GetLLMUsageStats scan: %w", err)
		}
		out.Rows = append(out.Rows, r)
		out.TotalCalls += r.TotalCalls
		out.TotalCostCents += r.TotalCostCents
	}
	if err := rows.Err(); err != nil {
		return LLMUsageReport{}, fmt.Errorf("admin.GetLLMUsageStats rows: %w", err)
	}
	return out, nil
}

// periodDays — period enum → days. Defaults to 7d on unknown.
func periodDays(p LLMUsagePeriod) int {
	switch p {
	case LLMUsagePeriod1d:
		return 1
	case LLMUsagePeriod30d:
		return 30
	}
	return 7
}

func daysInterval(days int) string {
	return fmt.Sprintf("%d days", days)
}

// groupColumn — group enum → SQL expression cast to text so the scan
// shape stays uniform. User-id UUID and day DATE both render to text.
// Empty / unknown → fall back to task.
func groupColumn(g LLMUsageGroup) string {
	switch g {
	case LLMUsageGroupUser:
		return "COALESCE(user_id::text, '<system>')"
	case LLMUsageGroupDay:
		return "to_char(date_trunc('day', created_at), 'YYYY-MM-DD')"
	case LLMUsageGroupProvider:
		return "provider"
	}
	return "task_kind"
}
