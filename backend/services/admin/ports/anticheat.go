package ports

import (
	"context"
	"encoding/json"

	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListAnticheat(
	ctx context.Context,
	req *connect.Request[pb.ListAnticheatRequest],
) (*connect.Response[pb.AnticheatSignalList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	m := req.Msg
	f := domain.AnticheatFilter{Limit: int(m.GetLimit())}
	if pbSev := m.GetSeverity(); pbSev != pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED {
		sev := severityFromProto(pbSev)
		f.Severity = &sev
	}
	if m.GetFrom() != nil {
		t := m.GetFrom().AsTime()
		f.From = &t
	}
	list, err := s.ListAnticheatUC.Do(ctx, f)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AnticheatSignalList{Items: make([]*pb.AnticheatSignal, 0, len(list))}
	for _, sig := range list {
		out.Items = append(out.Items, toAnticheatProto(sig))
	}
	return connect.NewResponse(out), nil
}

func toAnticheatProto(sig domain.AnticheatSignal) *pb.AnticheatSignal {
	out := &pb.AnticheatSignal{
		Id:       sig.ID.String(),
		UserId:   sig.UserID.String(),
		Username: sig.Username,
		Type:     string(sig.Type),
		Severity: severityToProto(sig.Severity),
	}
	if !sig.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(sig.CreatedAt.UTC())
	}
	if sig.MatchID != nil {
		out.MatchId = sig.MatchID.String()
	}
	if len(sig.Metadata) > 0 {
		var meta any
		if err := json.Unmarshal(sig.Metadata, &meta); err == nil {
			if v, err := structpb.NewValue(meta); err == nil {
				out.Metadata = v
			}
		}
	}
	return out
}
