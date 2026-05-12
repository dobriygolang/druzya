// Package ports — Connect-RPC adapter для telemetry bounded context.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	telemetryApp "druz9/telemetry/app"
	"druz9/telemetry/domain"

	"github.com/google/uuid"
)

// Server adapts telemetry use cases к Connect.
type Server struct {
	druz9v1connect.UnimplementedTelemetryServiceHandler

	Record       *telemetryApp.RecordEvents
	GetConsentUC *telemetryApp.GetConsent
	SetConsentUC *telemetryApp.SetConsent
	Export       *telemetryApp.ExportEvents
	Delete       *telemetryApp.DeleteEvents
	Log          *slog.Logger
}

// NewServer wires the adapter. Record must be non-nil; consent/export/delete
// — optional (nil → respective RPC returns Unimplemented).
func NewServer(record *telemetryApp.RecordEvents, get *telemetryApp.GetConsent, set *telemetryApp.SetConsent, exp *telemetryApp.ExportEvents, del *telemetryApp.DeleteEvents, log *slog.Logger) *Server {
	if record == nil {
		panic("telemetry/ports.NewServer: nil RecordEvents")
	}
	if log == nil {
		panic("telemetry/ports.NewServer: nil logger")
	}
	return &Server{
		Record:       record,
		GetConsentUC: get,
		SetConsentUC: set,
		Export:       exp,
		Delete:       del,
		Log:          log,
	}
}

// RecordEvents — batch write. Returns count accepted (после client+server
// validation drops). Best-effort: client'у не имеет смысла retry'ить если
// accepted < requested — events ephemeral.
func (s *Server) RecordEvents(
	ctx context.Context,
	req *connect.Request[pb.RecordEventsRequest],
) (*connect.Response[pb.RecordEventsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in := req.Msg.GetEvents()
	if len(in) == 0 {
		return connect.NewResponse(&pb.RecordEventsResponse{Accepted: 0}), nil
	}
	// Hard cap на batch size: 100 events. Защита от misbehaving client'а
	// который flush'ит 10K events одним запросом и timeout'ит pgx pool.
	if len(in) > 100 {
		in = in[:100]
	}
	parsed := make([]telemetryApp.EventInput, 0, len(in))
	for _, ev := range in {
		var occurred = ev.GetOccurredAt().AsTime()
		parsed = append(parsed, telemetryApp.EventInput{
			Name:       ev.GetName(),
			Surface:    ev.GetSurface(),
			OccurredAt: occurred,
			Properties: ev.GetProperties(),
		})
	}
	accepted, err := s.Record.Do(ctx, uid, parsed)
	if err != nil {
		s.Log.ErrorContext(ctx, "telemetry.RecordEvents", slog.Any("err", err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
	}
	return connect.NewResponse(&pb.RecordEventsResponse{Accepted: int32(accepted)}), nil
}

// GetConsent — текущее согласие. exists=false → default_unset=true, и
// client сам решает default per-surface.
func (s *Server) GetConsent(
	ctx context.Context,
	req *connect.Request[pb.GetConsentRequest],
) (*connect.Response[pb.GetConsentResponse], error) {
	if s.GetConsentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("consent not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	c, exists, err := s.GetConsentUC.Do(ctx, uid, req.Msg.GetSurface())
	if err != nil {
		if errors.Is(err, domain.ErrInvalidSurface) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.Log.ErrorContext(ctx, "telemetry.GetConsent", slog.Any("err", err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
	}
	return connect.NewResponse(&pb.GetConsentResponse{
		OptedIn:        c.OptedIn,
		ConsentVersion: domain.LatestConsentVersion,
		DefaultUnset:   !exists,
	}), nil
}

// SetConsent — пользователь нажал toggle. Upsert + best-effort sink delete
// при opt-out.
func (s *Server) SetConsent(
	ctx context.Context,
	req *connect.Request[pb.SetConsentRequest],
) (*connect.Response[pb.SetConsentResponse], error) {
	if s.SetConsentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("consent not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.SetConsentUC.Do(ctx, uid, req.Msg.GetSurface(), req.Msg.GetOptedIn(), req.Msg.GetConsentVersion()); err != nil {
		if errors.Is(err, domain.ErrInvalidSurface) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.Log.ErrorContext(ctx, "telemetry.SetConsent", slog.Any("err", err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
	}
	return connect.NewResponse(&pb.SetConsentResponse{Ok: true}), nil
}

// ExportEvents — GDPR data export. Большой JSON в одном response — для
// MVP'а ok, при scale'е переключим на streaming.
func (s *Server) ExportEvents(
	ctx context.Context,
	req *connect.Request[pb.ExportEventsRequest],
) (*connect.Response[pb.ExportEventsResponse], error) {
	if s.Export == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("export not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	payload, count, err := s.Export.Do(ctx, uid, req.Msg.GetSurface())
	if err != nil {
		if errors.Is(err, domain.ErrInvalidSurface) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.Log.ErrorContext(ctx, "telemetry.ExportEvents", slog.Any("err", err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
	}
	return connect.NewResponse(&pb.ExportEventsResponse{
		EventsJson: string(payload),
		Count:      int32(count),
	}), nil
}

// DeleteEvents — GDPR data delete. Удаляет local + best-effort
// remote-cleanup через sink.
func (s *Server) DeleteEvents(
	ctx context.Context,
	req *connect.Request[pb.DeleteEventsRequest],
) (*connect.Response[pb.DeleteEventsResponse], error) {
	if s.Delete == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("delete not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.Delete.Do(ctx, uid, req.Msg.GetSurface())
	if err != nil {
		if errors.Is(err, domain.ErrInvalidSurface) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.Log.ErrorContext(ctx, "telemetry.DeleteEvents", slog.Any("err", err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
	}
	return connect.NewResponse(&pb.DeleteEventsResponse{Deleted: int32(n)}), nil
}

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}
