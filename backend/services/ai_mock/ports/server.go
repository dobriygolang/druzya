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
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	}
	if pu := m.GetPairedUserId(); pu != "" {
		pid, err := uuid.Parse(pu)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid paired_user_id: %w", err))
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
			Status:       "processing",
			OverallScore: 0,
			Sections:     &pb.MockReportSections{},
		}), nil
	}
	return connect.NewResponse(toMockReportProto(sessionID, res.Report, res.ReplayURL)), nil
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

// ── converters (domain → proto) ───────────────────────────────────────────

func toMockSessionProto(s domain.Session, task domain.TaskPublic, msgs []domain.Message) *pb.MockSession {
	out := &pb.MockSession{
		Id:          s.ID.String(),
		Status:      mockStatusToProto(s.Status),
		Section:     sectionToProtoMock(s.Section),
		Difficulty:  difficultyToProtoMock(s.Difficulty),
		DurationMin: int32(s.DurationMin),
	}
	if s.CompanyID != uuid.Nil {
		out.CompanyId = s.CompanyID.String()
	}
	if s.StartedAt != nil {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	if s.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(s.FinishedAt.UTC())
	}
	if task.ID != uuid.Nil {
		out.Task = toMockTaskProto(task)
	}
	if len(msgs) > 0 {
		out.LastMessages = make([]*pb.MockMessage, 0, len(msgs))
		for _, m := range msgs {
			out.LastMessages = append(out.LastMessages, toMockMessageProto(m))
		}
	}
	out.StressProfile = &pb.MockStressProfile{
		PausesScore:    int32(s.Stress.PausesScore),
		BackspaceScore: int32(s.Stress.BackspaceScore),
		ChaosScore:     int32(s.Stress.ChaosScore),
		PasteAttempts:  int32(s.Stress.PasteAttempts),
	}
	return out
}

func toMockMessageProto(m domain.Message) *pb.MockMessage {
	out := &pb.MockMessage{
		Id:         m.ID.String(),
		Role:       messageRoleToProto(m.Role),
		Content:    m.Content,
		TokensUsed: int32(m.TokensUsed),
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt.UTC())
	}
	return out
}

func toMockTaskProto(t domain.TaskPublic) *pb.MockTaskPublic {
	return &pb.MockTaskPublic{
		Id:          t.ID.String(),
		Slug:        t.Slug,
		Title:       t.Title,
		Description: t.Description,
		Difficulty:  difficultyToProtoMock(t.Difficulty),
		Section:     sectionToProtoMock(t.Section),
	}
}

func toMockReportProto(sessionID uuid.UUID, d domain.ReportDraft, replayURL string) *pb.MockReport {
	out := &pb.MockReport{
		SessionId:    sessionID.String(),
		Status:       "ready",
		OverallScore: int32(d.OverallScore),
	}
	if replayURL != "" {
		out.ReplayUrl = replayURL
	} else if d.ReplayURL != "" {
		out.ReplayUrl = d.ReplayURL
	}
	out.Sections = &pb.MockReportSections{
		ProblemSolving: scoredSectionToProto(d.Sections.ProblemSolving),
		CodeQuality:    scoredSectionToProto(d.Sections.CodeQuality),
		Communication:  scoredSectionToProto(d.Sections.Communication),
		StressHandling: scoredSectionToProto(d.Sections.StressHandling),
	}
	if len(d.Strengths) > 0 {
		out.Strengths = append([]string{}, d.Strengths...)
	}
	if len(d.Weaknesses) > 0 {
		out.Weaknesses = append([]string{}, d.Weaknesses...)
	}
	if d.StressAnalysis != "" {
		out.StressAnalysis = d.StressAnalysis
	}
	if len(d.Recommendations) > 0 {
		out.Recommendations = make([]*pb.MockRecommendation, 0, len(d.Recommendations))
		for _, r := range d.Recommendations {
			rec := &pb.MockRecommendation{
				Title:       r.Title,
				Description: r.Description,
				Action: &pb.MockRecommendationAction{
					Kind: r.ActionKind,
				},
			}
			if r.ActionRef != "" {
				rec.Action.Params = map[string]string{"ref": r.ActionRef}
			}
			out.Recommendations = append(out.Recommendations, rec)
		}
	}
	return out
}

func scoredSectionToProto(s domain.ScoredSection) *pb.MockScoredSection {
	return &pb.MockScoredSection{Score: int32(s.Score), Comment: s.Comment}
}

// ── enum adapters ─────────────────────────────────────────────────────────

func sectionToProtoMock(s enums.Section) pb.Section {
	switch s {
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func sectionFromProtoMock(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_ALGORITHMS:
		return enums.SectionAlgorithms
	case pb.Section_SECTION_SQL:
		return enums.SectionSQL
	case pb.Section_SECTION_GO:
		return enums.SectionGo
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return enums.SectionSystemDesign
	case pb.Section_SECTION_BEHAVIORAL:
		return enums.SectionBehavioral
	default:
		return ""
	}
}

func difficultyToProtoMock(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	default:
		return pb.Difficulty_DIFFICULTY_UNSPECIFIED
	}
}

func difficultyFromProtoMock(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	default:
		return ""
	}
}

func mockStatusToProto(s enums.MockStatus) pb.MockStatus {
	switch s {
	case enums.MockStatusCreated:
		return pb.MockStatus_MOCK_STATUS_CREATED
	case enums.MockStatusInProgress:
		return pb.MockStatus_MOCK_STATUS_IN_PROGRESS
	case enums.MockStatusFinished:
		return pb.MockStatus_MOCK_STATUS_FINISHED
	case enums.MockStatusAbandoned:
		return pb.MockStatus_MOCK_STATUS_ABANDONED
	default:
		return pb.MockStatus_MOCK_STATUS_UNSPECIFIED
	}
}

func messageRoleToProto(r enums.MessageRole) pb.MessageRole {
	switch r {
	case enums.MessageRoleSystem:
		return pb.MessageRole_MESSAGE_ROLE_SYSTEM
	case enums.MessageRoleUser:
		return pb.MessageRole_MESSAGE_ROLE_USER
	case enums.MessageRoleAssistant:
		return pb.MessageRole_MESSAGE_ROLE_ASSISTANT
	default:
		return pb.MessageRole_MESSAGE_ROLE_UNSPECIFIED
	}
}

func llmModelFromProto(m pb.LLMModel) enums.LLMModel {
	switch m {
	case pb.LLMModel_LLM_MODEL_GPT_4O_MINI:
		return enums.LLMModelGPT4oMini
	case pb.LLMModel_LLM_MODEL_GPT_4O:
		return enums.LLMModelGPT4o
	case pb.LLMModel_LLM_MODEL_CLAUDE_SONNET_4:
		return enums.LLMModelClaudeSonnet4
	case pb.LLMModel_LLM_MODEL_GEMINI_PRO:
		return enums.LLMModelGeminiPro
	case pb.LLMModel_LLM_MODEL_MISTRAL_7B:
		return enums.LLMModelMistral7B
	default:
		return ""
	}
}

func editorEventTypeFromProto(t pb.EditorEventType) domain.EditorEventType {
	switch t {
	case pb.EditorEventType_EDITOR_EVENT_TYPE_PAUSE:
		return domain.EditorEventPause
	case pb.EditorEventType_EDITOR_EVENT_TYPE_BACKSPACE_BURST:
		return domain.EditorEventBackspaceBurst
	case pb.EditorEventType_EDITOR_EVENT_TYPE_CHAOTIC_EDIT:
		return domain.EditorEventChaoticEdit
	case pb.EditorEventType_EDITOR_EVENT_TYPE_PASTE_ATTEMPT:
		return domain.EditorEventPasteAttempt
	case pb.EditorEventType_EDITOR_EVENT_TYPE_IDLE:
		return domain.EditorEventIdle
	default:
		return ""
	}
}
