// Package ports exposes the copilot domain via Connect-RPC.
//
// CopilotServer implements druz9v1connect.CopilotServiceHandler (generated
// from proto/druz9/v1/copilot.proto). It is mounted in cmd/monolith via
// NewCopilotServiceHandler + vanguard, so unary RPCs are served on both the
// native Connect path (/druz9.v1.CopilotService/*) AND the REST paths
// declared via google.api.http annotations (/api/v1/copilot/*).
//
// Analyze and Chat are server-streaming RPCs. Vanguard does not transcode
// streaming to REST — clients hitting the REST paths get only a single
// final frame (vanguard's documented limitation). Desktop clients use the
// native Connect streaming path for real-time deltas.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/copilot/app"
	"druz9/copilot/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — CopilotServer satisfies the generated handler.
var _ druz9v1connect.CopilotServiceHandler = (*CopilotServer)(nil)

// CopilotServer adapts copilot use cases to the Connect handler interface.
//
// Field names carry the UC suffix to avoid Go's method/field collision with
// the Connect-RPC methods of the same name (GetConversation / GetQuota /
// ListProviders / etc.).
type CopilotServer struct {
	AnalyzeUC          *app.Analyze
	ChatUC             *app.Chat
	ListHistoryUC      *app.ListHistory
	GetConversationUC  *app.GetConversation
	DeleteConvUC       *app.DeleteConversation
	ListProvidersUC    *app.ListProviders
	GetQuotaUC         *app.GetQuota
	GetDesktopConfigUC *app.GetDesktopConfig
	RateMessageUC      *app.RateMessage

	// Sessions (Phase 12).
	StartSessionUC       *app.StartSession
	EndSessionUC         *app.EndSession
	GetSessionAnalysisUC *app.GetSessionAnalysis
	ListSessionsUC       *app.ListSessions

	// CheckBlock (Phase-4 ADR-001 Wave 3).
	CheckBlockUC *app.CheckBlock

	Log *slog.Logger
}

// NewCopilotServer wires the server. Session-related use cases are
// optional to ease migration — passing nil for any of them causes the
// corresponding RPC to return CodeUnimplemented at runtime.
func NewCopilotServer(
	analyze *app.Analyze,
	chat *app.Chat,
	listHistory *app.ListHistory,
	getConv *app.GetConversation,
	deleteConv *app.DeleteConversation,
	listProviders *app.ListProviders,
	getQuota *app.GetQuota,
	getConfig *app.GetDesktopConfig,
	rate *app.RateMessage,
	startSession *app.StartSession,
	endSession *app.EndSession,
	getAnalysis *app.GetSessionAnalysis,
	listSessions *app.ListSessions,
	checkBlock *app.CheckBlock,
	log *slog.Logger,
) *CopilotServer {
	return &CopilotServer{
		AnalyzeUC:            analyze,
		ChatUC:               chat,
		ListHistoryUC:        listHistory,
		GetConversationUC:    getConv,
		DeleteConvUC:         deleteConv,
		ListProvidersUC:      listProviders,
		GetQuotaUC:           getQuota,
		GetDesktopConfigUC:   getConfig,
		RateMessageUC:        rate,
		StartSessionUC:       startSession,
		EndSessionUC:         endSession,
		GetSessionAnalysisUC: getAnalysis,
		ListSessionsUC:       listSessions,
		CheckBlockUC:         checkBlock,
		Log:                  log,
	}
}

// CheckBlock — GET /api/v1/copilot/check-block. Returns blocked=true while
// the caller has a live mock-session with ai_assist=FALSE.
func (s *CopilotServer) CheckBlock(
	ctx context.Context,
	_ *connect.Request[pb.CheckBlockRequest],
) (*connect.Response[pb.CheckBlockResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.CheckBlockUC == nil {
		// Gate not wired (e.g. tests, partial bring-up). Treat as
		// "not blocked" — the consult path stays open.
		return connect.NewResponse(&pb.CheckBlockResponse{}), nil
	}
	out, err := s.CheckBlockUC.Do(ctx, app.CheckBlockInput{UserID: uid})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.CheckBlockResponse{
		Blocked: out.Blocked,
		Reason:  out.Reason,
	}
	if !out.Until.IsZero() {
		resp.Until = timestamppb.New(out.Until.UTC())
	}
	return connect.NewResponse(resp), nil
}

// ── Streaming handlers ───────────────────────────────────────────────────

// Analyze streams an LLM response for a fresh or existing conversation.
func (s *CopilotServer) Analyze(
	ctx context.Context,
	req *connect.Request[pb.AnalyzeRequest],
	stream *connect.ServerStream[pb.AnalyzeEvent],
) error {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}

	convID, err := parseOptionalUUID(req.Msg.GetConversationId())
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid conversation_id: %w", err))
	}
	in := app.AnalyzeInput{
		UserID:         uid,
		ConversationID: convID,
		PromptText:     req.Msg.GetPromptText(),
		Model:          req.Msg.GetModel(),
		Attachments:    attachmentsFromProto(req.Msg.GetAttachments()),
		Client:         clientContextFromProto(req.Msg.GetClient()),
	}

	frames, err := s.AnalyzeUC.Do(ctx, in)
	if err != nil {
		return s.toConnectErr(err)
	}
	return pumpAnalyzeFrames(stream, frames)
}

// Chat streams a follow-up turn in an existing conversation.
func (s *CopilotServer) Chat(
	ctx context.Context,
	req *connect.Request[pb.ChatRequest],
	stream *connect.ServerStream[pb.ChatEvent],
) error {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	convID, err := uuid.Parse(req.Msg.GetConversationId())
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid conversation_id: %w", err))
	}
	in := app.ChatInput{
		UserID:         uid,
		ConversationID: convID,
		PromptText:     req.Msg.GetPromptText(),
		Attachments:    attachmentsFromProto(req.Msg.GetAttachments()),
		Client:         clientContextFromProto(req.Msg.GetClient()),
	}
	frames, err := s.ChatUC.Do(ctx, in)
	if err != nil {
		return s.toConnectErr(err)
	}
	return pumpChatFrames(stream, frames)
}

// ── Unary handlers ───────────────────────────────────────────────────────

// ListHistory returns paged past conversations for the caller.
func (s *CopilotServer) ListHistory(
	ctx context.Context,
	req *connect.Request[pb.ListCopilotHistoryRequest],
) (*connect.Response[pb.ListCopilotHistoryResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.ListHistoryUC.Do(ctx, app.ListHistoryInput{
		UserID: uid,
		Cursor: domain.Cursor(req.Msg.GetCursor()),
		Limit:  int(req.Msg.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.ListCopilotHistoryResponse{
		NextCursor: string(out.NextCursor),
	}
	resp.Conversations = make([]*pb.CopilotConversation, 0, len(out.Conversations))
	for _, c := range out.Conversations {
		resp.Conversations = append(resp.Conversations, conversationSummaryToProto(c))
	}
	return connect.NewResponse(resp), nil
}

// GetConversation returns a single conversation + messages.
func (s *CopilotServer) GetConversation(
	ctx context.Context,
	req *connect.Request[pb.GetCopilotConversationRequest],
) (*connect.Response[pb.CopilotConversationDetail], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", err))
	}
	detail, err := s.GetConversationUC.Do(ctx, app.GetConversationInput{UserID: uid, ConversationID: id})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(conversationDetailToProto(detail)), nil
}

// DeleteConversation removes a conversation owned by the caller.
func (s *CopilotServer) DeleteConversation(
	ctx context.Context,
	req *connect.Request[pb.DeleteCopilotConversationRequest],
) (*connect.Response[pb.DeleteCopilotConversationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", err))
	}
	if err := s.DeleteConvUC.Do(ctx, app.DeleteConversationInput{UserID: uid, ConversationID: id}); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.DeleteCopilotConversationResponse{}), nil
}

// ListProviders returns the model catalogue with per-user availability.
func (s *CopilotServer) ListProviders(
	ctx context.Context,
	_ *connect.Request[pb.ListCopilotProvidersRequest],
) (*connect.Response[pb.ListCopilotProvidersResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.ListProvidersUC.Do(ctx, app.ListProvidersInput{UserID: uid})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.ListCopilotProvidersResponse{}
	resp.Models = make([]*pb.CopilotProviderModel, 0, len(out.Models))
	for _, m := range out.Models {
		resp.Models = append(resp.Models, providerModelToProto(m))
	}
	return connect.NewResponse(resp), nil
}

// GetQuota returns the caller's quota snapshot.
func (s *CopilotServer) GetQuota(
	ctx context.Context,
	_ *connect.Request[pb.GetCopilotQuotaRequest],
) (*connect.Response[pb.CopilotQuota], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	q, err := s.GetQuotaUC.Do(ctx, app.GetQuotaInput{UserID: uid})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(quotaToProto(q)), nil
}

// GetDesktopConfig returns remote config to the desktop client.
func (s *CopilotServer) GetDesktopConfig(
	ctx context.Context,
	req *connect.Request[pb.GetDesktopConfigRequest],
) (*connect.Response[pb.DesktopConfig], error) {
	// Public endpoint for unauthenticated bootstrap is also fine, but we
	// follow the other services and require auth. Flip this when the
	// onboarding flow needs an unauthenticated config fetch.
	if _, ok := sharedMw.UserIDFromContext(ctx); !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	cfg, err := s.GetDesktopConfigUC.Do(ctx, app.GetDesktopConfigInput{KnownRev: req.Msg.GetKnownRev()})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(desktopConfigToProto(cfg)), nil
}

// StartSession — POST /api/v1/copilot/sessions.
func (s *CopilotServer) StartSession(
	ctx context.Context,
	req *connect.Request[pb.StartCopilotSessionRequest],
) (*connect.Response[pb.CopilotSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.StartSessionUC.Do(ctx, app.StartSessionInput{
		UserID: uid,
		Kind:   sessionKindFromProto(req.Msg.GetKind()),
	})
	if err != nil {
		if errors.Is(err, domain.ErrLiveSessionExists) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(sessionToProto(out, 0)), nil
}

// EndSession — POST /api/v1/copilot/sessions/{id}/end.
func (s *CopilotServer) EndSession(
	ctx context.Context,
	req *connect.Request[pb.EndCopilotSessionRequest],
) (*connect.Response[pb.CopilotSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	out, err := s.EndSessionUC.Do(ctx, app.EndSessionInput{UserID: uid, SessionID: id})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(sessionToProto(out, 0)), nil
}

// GetSessionAnalysis — GET /api/v1/copilot/sessions/{id}/analysis.
func (s *CopilotServer) GetSessionAnalysis(
	ctx context.Context,
	req *connect.Request[pb.GetCopilotSessionAnalysisRequest],
) (*connect.Response[pb.CopilotSessionAnalysis], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	r, err := s.GetSessionAnalysisUC.Do(ctx, app.GetSessionAnalysisInput{UserID: uid, SessionID: id})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(reportToProto(r)), nil
}

// ListSessions — GET /api/v1/copilot/sessions.
func (s *CopilotServer) ListSessions(
	ctx context.Context,
	req *connect.Request[pb.ListCopilotSessionsRequest],
) (*connect.Response[pb.ListCopilotSessionsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.ListSessionsUC.Do(ctx, app.ListSessionsInput{
		UserID: uid,
		Kind:   sessionKindFromProto(req.Msg.GetKind()),
		Cursor: domain.Cursor(req.Msg.GetCursor()),
		Limit:  int(req.Msg.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.ListCopilotSessionsResponse{NextCursor: string(out.NextCursor)}
	resp.Sessions = make([]*pb.CopilotSession, 0, len(out.Sessions))
	for _, ss := range out.Sessions {
		resp.Sessions = append(resp.Sessions, sessionSummaryToProto(ss))
	}
	return connect.NewResponse(resp), nil
}

// RateMessage records thumbs-up/down/clear on an assistant message.
func (s *CopilotServer) RateMessage(
	ctx context.Context,
	req *connect.Request[pb.RateCopilotMessageRequest],
) (*connect.Response[pb.RateCopilotMessageResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetMessageId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid message_id: %w", err))
	}
	rating := req.Msg.GetRating()
	if rating < -1 || rating > 1 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("rating must be -1, 0, or +1"))
	}
	if err := s.RateMessageUC.Do(ctx, app.RateMessageInput{
		UserID:    uid,
		MessageID: id,
		Rating:    int8(rating),
	}); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.RateCopilotMessageResponse{}), nil
}

// ── helpers ──────────────────────────────────────────────────────────────

// parseOptionalUUID tolerates an empty string as uuid.Nil.
func parseOptionalUUID(s string) (uuid.UUID, error) {
	if s == "" {
		return uuid.Nil, nil
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, fmt.Errorf("copilot.parseOptionalUUID: %w", err)
	}
	return id, nil
}

// pumpAnalyzeFrames translates app.StreamFrame into pb.AnalyzeEvent frames
// and sends them on the Connect stream. Returns on upstream close or on
// send error (the first send error terminates the stream).
func pumpAnalyzeFrames(stream *connect.ServerStream[pb.AnalyzeEvent], frames <-chan app.StreamFrame) error {
	for f := range frames {
		ev, err := streamFrameToAnalyzeEvent(f)
		if err != nil {
			return err
		}
		if ev == nil {
			continue
		}
		if sendErr := stream.Send(ev); sendErr != nil {
			return fmt.Errorf("copilot.Analyze: stream send: %w", sendErr)
		}
	}
	return nil
}

// pumpChatFrames is the Chat analogue of pumpAnalyzeFrames. The frame
// shape is identical; only the proto envelope type differs.
func pumpChatFrames(stream *connect.ServerStream[pb.ChatEvent], frames <-chan app.StreamFrame) error {
	for f := range frames {
		ev, err := streamFrameToChatEvent(f)
		if err != nil {
			return err
		}
		if ev == nil {
			continue
		}
		if sendErr := stream.Send(ev); sendErr != nil {
			return fmt.Errorf("copilot.Chat: stream send: %w", sendErr)
		}
	}
	return nil
}

// streamFrameToAnalyzeEvent maps one app.StreamFrame onto the proto union.
// Returns (nil, nil) to skip frames that carry nothing useful.
// Returns a non-nil error to terminate the RPC with a proper Connect code.
func streamFrameToAnalyzeEvent(f app.StreamFrame) (*pb.AnalyzeEvent, error) {
	switch {
	case f.Err != nil:
		// Terminal error. Emit a structured error event AND terminate the
		// RPC so Connect clients see a failure code. We prefer the code
		// path over stream.Send+return nil — observers can still reason
		// about errors via transport semantics.
		code, msg, retryAfter := classifyStreamErr(f.Err)
		ev := &pb.AnalyzeEvent{Kind: &pb.AnalyzeEvent_Error{Error: &pb.CopilotStreamError{
			Code:              code,
			Message:           msg,
			RetryAfterSeconds: retryAfter,
		}}}
		return ev, nil
	case f.Created != nil:
		return &pb.AnalyzeEvent{Kind: &pb.AnalyzeEvent_Created{Created: &pb.CopilotConversationCreated{
			ConversationId:     f.Created.ConversationID.String(),
			UserMessageId:      f.Created.UserMessageID.String(),
			AssistantMessageId: f.Created.AssistantMessageID.String(),
			ModelId:            f.Created.Model,
		}}}, nil
	case f.Done != nil:
		return &pb.AnalyzeEvent{Kind: &pb.AnalyzeEvent_Done{Done: &pb.CopilotDone{
			AssistantMessageId: f.Done.AssistantMessageID.String(),
			TokensIn:           int32(f.Done.TokensIn),
			TokensOut:          int32(f.Done.TokensOut),
			LatencyMs:          int32(f.Done.LatencyMs),
			UpdatedQuota:       quotaToProto(f.Done.Quota),
		}}}, nil
	case f.Delta != "":
		return &pb.AnalyzeEvent{Kind: &pb.AnalyzeEvent_Delta{Delta: &pb.CopilotTokenDelta{
			Text: f.Delta,
		}}}, nil
	default:
		return nil, nil
	}
}

// streamFrameToChatEvent is identical logic to the Analyze variant, wrapped
// in the ChatEvent envelope.
func streamFrameToChatEvent(f app.StreamFrame) (*pb.ChatEvent, error) {
	switch {
	case f.Err != nil:
		code, msg, retryAfter := classifyStreamErr(f.Err)
		return &pb.ChatEvent{Kind: &pb.ChatEvent_Error{Error: &pb.CopilotStreamError{
			Code:              code,
			Message:           msg,
			RetryAfterSeconds: retryAfter,
		}}}, nil
	case f.Created != nil:
		return &pb.ChatEvent{Kind: &pb.ChatEvent_Created{Created: &pb.CopilotConversationCreated{
			ConversationId:     f.Created.ConversationID.String(),
			UserMessageId:      f.Created.UserMessageID.String(),
			AssistantMessageId: f.Created.AssistantMessageID.String(),
			ModelId:            f.Created.Model,
		}}}, nil
	case f.Done != nil:
		return &pb.ChatEvent{Kind: &pb.ChatEvent_Done{Done: &pb.CopilotDone{
			AssistantMessageId: f.Done.AssistantMessageID.String(),
			TokensIn:           int32(f.Done.TokensIn),
			TokensOut:          int32(f.Done.TokensOut),
			LatencyMs:          int32(f.Done.LatencyMs),
			UpdatedQuota:       quotaToProto(f.Done.Quota),
		}}}, nil
	case f.Delta != "":
		return &pb.ChatEvent{Kind: &pb.ChatEvent_Delta{Delta: &pb.CopilotTokenDelta{
			Text: f.Delta,
		}}}, nil
	default:
		return nil, nil
	}
}

// classifyStreamErr projects a domain or provider error onto a stable
// code/message pair that the desktop client can branch on.
func classifyStreamErr(err error) (code, msg string, retryAfter int32) {
	switch {
	case errors.Is(err, domain.ErrQuotaExceeded):
		return "rate_limited", "quota exceeded", 0
	case errors.Is(err, domain.ErrModelNotAllowed):
		return "model_unavailable", "model not allowed on current plan", 0
	case errors.Is(err, domain.ErrInvalidInput):
		return "invalid_input", err.Error(), 0
	default:
		return "internal", "copilot stream failure", 0
	}
}

// ── error mapping ────────────────────────────────────────────────────────

func (s *CopilotServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrQuotaExceeded):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, domain.ErrRateLimited):
		// Rate-limit по IP/User — 429 через Connect CodeResourceExhausted,
		// симметрично ErrQuotaExceeded (ops-метрики различают их по тексту).
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, domain.ErrModelNotAllowed):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrAIAssistBlocked):
		// Phase-4 ADR-001 (Wave 3) — strict mock-session blocks Cue.
		// Desktop client should poll CheckBlock to avoid hitting this.
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		if s.Log != nil {
			s.Log.Error("copilot: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("copilot failure"))
	}
}
