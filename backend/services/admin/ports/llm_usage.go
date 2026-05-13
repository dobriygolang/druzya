// llm_usage.go — Wave 15 admin LLM usage / cost panel RPC handler.
//
// GET /api/v1/admin/llm-usage  (POST body in proto for groupBy/period filter)
//
// Role-gated through AdminServer.requireAdmin. Returns top 200 rows by
// cost DESC; UI sorts client-side for other axes.
package ports

import (
	"context"
	"fmt"

	"druz9/admin/app"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
)

// GetLLMUsageStats implements druz9.v1.AdminService/GetLLMUsageStats.
func (s *AdminServer) GetLLMUsageStats(
	ctx context.Context,
	req *connect.Request[pb.GetLLMUsageStatsRequest],
) (*connect.Response[pb.GetLLMUsageStatsResponse], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	if s.GetLLMUsageStatsUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("admin.GetLLMUsageStats: not wired"))
	}
	period := llmUsagePeriodFromProto(req.Msg.GetPeriod())
	group := llmUsageGroupFromProto(req.Msg.GetGroupBy())
	report, err := s.GetLLMUsageStatsUC.Do(ctx, period, group)
	if err != nil {
		return nil, fmt.Errorf("admin.GetLLMUsageStats: %w", err)
	}
	resp := &pb.GetLLMUsageStatsResponse{
		Rows:           make([]*pb.LLMUsageRow, 0, len(report.Rows)),
		TotalCostCents: report.TotalCostCents,
		TotalCalls:     report.TotalCalls,
	}
	for _, r := range report.Rows {
		resp.Rows = append(resp.Rows, &pb.LLMUsageRow{
			DimensionKey:      r.DimensionKey,
			TotalCalls:        r.TotalCalls,
			TotalInputTokens:  r.TotalInputTokens,
			TotalOutputTokens: r.TotalOutputTokens,
			TotalCostCents:    r.TotalCostCents,
			AvgLatencyMs:      r.AvgLatencyMs,
		})
	}
	return connect.NewResponse(resp), nil
}

func llmUsagePeriodFromProto(p pb.LLMUsagePeriod) app.LLMUsagePeriod {
	switch p {
	case pb.LLMUsagePeriod_LLM_USAGE_PERIOD_1D:
		return app.LLMUsagePeriod1d
	case pb.LLMUsagePeriod_LLM_USAGE_PERIOD_30D:
		return app.LLMUsagePeriod30d
	}
	return app.LLMUsagePeriod7d
}

func llmUsageGroupFromProto(g pb.LLMUsageGroup) app.LLMUsageGroup {
	switch g {
	case pb.LLMUsageGroup_LLM_USAGE_GROUP_USER:
		return app.LLMUsageGroupUser
	case pb.LLMUsageGroup_LLM_USAGE_GROUP_DAY:
		return app.LLMUsageGroupDay
	case pb.LLMUsageGroup_LLM_USAGE_GROUP_PROVIDER:
		return app.LLMUsageGroupProvider
	}
	return app.LLMUsageGroupTask
}
