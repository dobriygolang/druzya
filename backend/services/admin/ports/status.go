// status.go — Connect handler for the PUBLIC status page.
//
// SECURITY: this RPC has NO auth gate. It is the user-facing transparency
// surface for druz9 — anonymous visitors must be able to see whether the
// platform is up. The handler MUST NOT touch private data.
package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// GetStatusPage assembles a fresh /status snapshot.
func (s *AdminServer) GetStatusPage(
	ctx context.Context,
	_ *connect.Request[pb.GetStatusPageRequest],
) (*connect.Response[pb.StatusPage], error) {
	if s.GetStatusUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("status not wired"))
	}
	page, err := s.GetStatusUC.Do(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("status: %w", err))
	}
	return connect.NewResponse(statusPageToProto(page)), nil
}

func statusPageToProto(p domain.StatusPage) *pb.StatusPage {
	out := &pb.StatusPage{
		OverallStatus: string(p.OverallStatus),
		Uptime_90D:    formatPercent(p.Uptime90D),
		Services:      make([]*pb.StatusServiceState, 0, len(p.Services)),
		Incidents:     make([]*pb.StatusIncident, 0, len(p.Incidents)),
	}
	if !p.GeneratedAt.IsZero() {
		out.GeneratedAt = timestamppb.New(p.GeneratedAt.UTC())
	}
	for _, svc := range p.Services {
		out.Services = append(out.Services, &pb.StatusServiceState{
			Name:       svc.Name,
			Slug:       svc.Slug,
			Status:     string(svc.Status),
			Uptime_30D: formatPercent(svc.Uptime30D),
			LatencyMs:  svc.LatencyMS,
		})
	}
	for _, inc := range p.Incidents {
		row := &pb.StatusIncident{
			Id:               inc.ID,
			Title:            inc.Title,
			Description:      inc.Description,
			Severity:         inc.Severity,
			AffectedServices: append([]string(nil), inc.AffectedServices...),
		}
		if !inc.StartedAt.IsZero() {
			row.StartedAt = timestamppb.New(inc.StartedAt.UTC())
		}
		if inc.EndedAt != nil {
			row.EndedAt = timestamppb.New(inc.EndedAt.UTC())
		}
		out.Incidents = append(out.Incidents, row)
	}
	return out
}

// formatPercent renders a 0..100 float as e.g. "99.97%". Two decimals so
// the marketing copy "99.97% за 90 дней" remains readable.
func formatPercent(v float64) string {
	if v < 0 {
		v = 0
	}
	if v > 100 {
		v = 100
	}
	return fmt.Sprintf("%.2f%%", v)
}
