// insights.go — Connect-RPC adapter for /mock/insights/overview.
//
// Use case + DB queries live in app.InsightsOverview. The LLM-narrative
// summary is resolved by an opt-in callback (InsightsSummaryFn) so the
// Redis cache + LLMChain dependencies stay in cmd/monolith and don't
// leak into this package's go.mod.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	"druz9/ai_mock/app"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

const (
	insightsWindowDays = 30
	insightsScoreLimit = 10
	insightsTopMissing = 8
)

// InsightsSummaryInput is what the wirer's summary callback receives. Keeps
// the wirer free of pb-types while still seeing every field it might want
// to fold into a prompt.
type InsightsSummaryInput struct {
	WindowDays         int
	TotalSessions30d   int
	PipelinePassRate30 int
	StagePerformance   []StagePerformanceRow
	RecurringPatterns  []RecurringPatternRow
	ScoreTrajectory    []ScoreTrajectoryRow
}

type StagePerformanceRow struct {
	StageKind string
	Total     int
	Passed    int
	PassRate  int
}

type RecurringPatternRow struct {
	Point string
	Count int
}

type ScoreTrajectoryRow struct {
	PipelineID string
	FinishedAt time.Time
	Score      float64
	Verdict    string
}

func (s *MockServer) GetInsightsOverview(
	ctx context.Context,
	_ *connect.Request[pb.GetInsightsOverviewRequest],
) (*connect.Response[pb.InsightsOverview], error) {
	if s.Insights == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, runErr := s.Insights.Run(ctx, app.InsightsOverviewInput{
		UserID:     uid,
		WindowDays: insightsWindowDays,
		ScoreLimit: insightsScoreLimit,
		TopMissing: insightsTopMissing,
	})
	if runErr != nil && s.Log != nil {
		// Soft-fail like the chi handler — empty rows are valid.
		s.Log.WarnContext(ctx, "ai_mock.GetInsightsOverview", slog.Any("err", runErr))
	}
	out := &pb.InsightsOverview{
		WindowDays:           insightsWindowDays,
		TotalSessions_30D:    int32(res.Headline.TotalSessions),
		PipelinePassRate_30D: int32(res.Headline.PassRatePct),
		StagePerformance:     make([]*pb.StagePerformance, 0, len(res.StagePerformance)),
		RecurringPatterns:    make([]*pb.RecurringPattern, 0, len(res.RecurringPatterns)),
		ScoreTrajectory:      make([]*pb.ScoreTrajectoryPoint, 0, len(res.ScoreTrajectory)),
	}
	summaryInput := InsightsSummaryInput{
		WindowDays:         insightsWindowDays,
		TotalSessions30d:   res.Headline.TotalSessions,
		PipelinePassRate30: res.Headline.PassRatePct,
	}
	for _, sp := range res.StagePerformance {
		passRate := 0
		if sp.Total > 0 {
			passRate = int(float64(sp.Passed) / float64(sp.Total) * 100.0)
		}
		out.StagePerformance = append(out.StagePerformance, &pb.StagePerformance{
			StageKind: sp.StageKind, Total: int32(sp.Total),
			Passed: int32(sp.Passed), PassRate: int32(passRate),
		})
		summaryInput.StagePerformance = append(summaryInput.StagePerformance, StagePerformanceRow{
			StageKind: sp.StageKind, Total: sp.Total, Passed: sp.Passed, PassRate: passRate,
		})
	}
	for _, rp := range res.RecurringPatterns {
		out.RecurringPatterns = append(out.RecurringPatterns, &pb.RecurringPattern{
			Point: rp.Point, Count: int32(rp.Count),
		})
		summaryInput.RecurringPatterns = append(summaryInput.RecurringPatterns, RecurringPatternRow{
			Point: rp.Point, Count: rp.Count,
		})
	}
	for _, st := range res.ScoreTrajectory {
		ts := ""
		if !st.FinishedAt.IsZero() {
			ts = st.FinishedAt.UTC().Format(time.RFC3339)
		}
		out.ScoreTrajectory = append(out.ScoreTrajectory, &pb.ScoreTrajectoryPoint{
			PipelineId: st.PipelineID.String(),
			FinishedAt: ts,
			Score:      st.Score,
			Verdict:    st.Verdict,
		})
		summaryInput.ScoreTrajectory = append(summaryInput.ScoreTrajectory, ScoreTrajectoryRow{
			PipelineID: st.PipelineID.String(), FinishedAt: st.FinishedAt,
			Score: st.Score, Verdict: st.Verdict,
		})
	}
	if out.TotalSessions_30D > 0 && s.InsightsSummaryFn != nil {
		out.Summary = s.InsightsSummaryFn(ctx, uid.String(), summaryInput)
	}
	return connect.NewResponse(out), nil
}
