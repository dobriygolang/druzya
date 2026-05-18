// Package ports exposes the ai_mock domain via Connect-RPC.
//
// MockServer implements druz9v1connect.MockServiceHandler (generated from
// proto/druz9/v1/ai_mock.proto). It is mounted in main.go via
// NewMockServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.MockService/*) and the REST paths
// (/api/v1/mock/*) declared via google.api.http annotations.
//
// The /ws/mock/{sessionId} WebSocket is NOT part of Connect — it stays in
// ws.go / ws_handler.go as a raw chi route.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/ai_mock/app"
	"druz9/ai_mock/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// Compile-time assertion — MockServer satisfies the generated handler.
var _ druz9v1connect.MockServiceHandler = (*MockServer)(nil)

// MockServer adapts ai_mock use cases to the Connect handler interface.
type MockServer struct {
	Create *app.CreateSession
	Get    *app.GetSession
	Send   *app.SendMessage
	Stress *app.IngestStress
	Finish *app.FinishSession
	Report *app.GetReport
	// Insights powers /api/v1/mock/insights/overview. Optional: nil-safe —
	// the RPC returns Unavailable until the wirer binds it.
	Insights *app.InsightsOverview
	// InsightsSummaryFn — LLM/templated narrative paragraph. Returns ""
	// to signal "no summary"; UI hides the section. Wired by cmd/monolith
	// so the Redis cache + chain dependencies stay out of this package.
	InsightsSummaryFn func(ctx context.Context, userID string, data InsightsSummaryInput) string

	Log *slog.Logger
}

// NewMockServer wires the server.
func NewMockServer(
	create *app.CreateSession,
	get *app.GetSession,
	send *app.SendMessage,
	stress *app.IngestStress,
	finish *app.FinishSession,
	report *app.GetReport,
	log *slog.Logger,
) *MockServer {
	return &MockServer{Create: create, Get: get, Send: send, Stress: stress, Finish: finish, Report: report, Log: log}
}

// ── Connect handlers ──────────────────────────────────────────────────────

// CreateSession implements (POST /api/v1/mock/session).
func (s *MockServer) CreateSession(
	ctx context.Context,
	req *connect.Request[pb.CreateMockRequest],
) (*connect.Response[pb.MockSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	companyID, err := uuid.Parse(m.GetCompanyId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid company_id: %w", err))
	}
	in := app.CreateSessionInput{
		UserID:         uid,
		CompanyID:      companyID,
		Section:        sectionFromProtoMock(m.GetSection()),
		Difficulty:     difficultyFromProtoMock(m.GetDifficulty()),
		DurationMin:    int(m.GetDurationMin()),
		VoiceMode:      m.GetVoiceMode(),
		DevilsAdvocate: m.GetDevilsAdvocate(),
		AIAssist:       m.GetAiAssist(),
	}
	if pu := m.GetPairedUserId(); pu != "" {
		pid, parseErr := uuid.Parse(pu)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid paired_user_id: %w", parseErr))
		}
		in.PairedUserID = &pid
	}
	if lm := llmModelFromProto(m.GetLlmModel()); lm != "" {
		in.PreferredModel = lm
	}
	res, err := s.Create.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toMockSessionProto(res, domain.TaskPublic{}, nil)), nil
}

// GetSession implements (GET /api/v1/mock/session/{session_id}).
func (s *MockServer) GetSession(
	ctx context.Context,
	req *connect.Request[pb.GetMockSessionRequest],
) (*connect.Response[pb.MockSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	res, err := s.Get.Do(ctx, uid, sessionID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toMockSessionProto(res.Session, res.Task, res.LastMessages)), nil
}

// SendMessage implements (POST /api/v1/mock/session/{session_id}/message).
func (s *MockServer) SendMessage(
	ctx context.Context,
	req *connect.Request[pb.MockMessageRequest],
) (*connect.Response[pb.MockMessage], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	m := req.Msg
	if m.GetContent() == "" && m.GetVoiceTranscript() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("content or voice_transcript required"))
	}
	res, err := s.Send.Do(ctx, app.SendMessageInput{
		UserID:          uid,
		SessionID:       sessionID,
		Content:         m.GetContent(),
		CodeSnapshot:    m.GetCodeSnapshot(),
		VoiceTranscript: m.GetVoiceTranscript(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toMockMessageProto(res.AssistantMessage)), nil
}

// IngestStress implements (POST /api/v1/mock/session/{session_id}/stress).
// The response echoes the batch's session id (proto has no void response; the
// semantic contract is "204-ish — empty body").
func (s *MockServer) IngestStress(
	ctx context.Context,
	req *connect.Request[pb.StressEventsBatch],
) (*connect.Response[pb.StressEventsBatch], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	events := make([]domain.EditorEvent, 0, len(req.Msg.GetEvents()))
	for _, e := range req.Msg.GetEvents() {
		t := editorEventTypeFromProto(e.GetType())
		if !t.IsValid() {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid event type"))
		}
		ev := domain.EditorEvent{Type: t, AtMs: e.GetAtMs(), DurationMs: e.GetDurationMs()}
		if len(e.GetMetadata()) > 0 {
			meta := make(map[string]any, len(e.GetMetadata()))
			for k, v := range e.GetMetadata() {
				meta[k] = v
			}
			ev.Metadata = meta
		}
		events = append(events, ev)
	}
	if _, err := s.Stress.Do(ctx, app.IngestStressInput{
		UserID: uid, SessionID: sessionID, Events: events,
	}); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.StressEventsBatch{SessionId: sessionID.String()}), nil
}

// FinishSession implements (POST /api/v1/mock/session/{session_id}/finish).
func (s *MockServer) FinishSession(
	ctx context.Context,
	req *connect.Request[pb.FinishMockSessionRequest],
) (*connect.Response[pb.MockSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	res, err := s.Finish.Do(ctx, uid, sessionID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toMockSessionProto(res, domain.TaskPublic{}, nil)), nil
}

// GetReport implements (GET /api/v1/mock/session/{session_id}/report).
func (s *MockServer) GetReport(
	ctx context.Context,
	req *connect.Request[pb.GetMockReportRequest],
) (*connect.Response[pb.MockReport], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	res, err := s.Report.Do(ctx, uid, sessionID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if res.Status == app.ReportStatusProcessing {
		// Bible allows 200 + status=processing. Clients poll until ready.
		return connect.NewResponse(&pb.MockReport{
			SessionId:    sessionID.String(),
			Status:       pb.MockReportStatus_MOCK_REPORT_STATUS_PROCESSING,
			OverallScore: 0,
			Sections:     &pb.MockReportSections{},
		}), nil
	}
	return connect.NewResponse(toMockReportProto(sessionID, res.Report)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *MockServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidState):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("mock: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("mock failure"))
	}
}
