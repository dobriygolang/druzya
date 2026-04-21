// Package ports exposes the ai_native domain via Connect-RPC.
//
// NativeServer implements druz9v1connect.NativeServiceHandler (generated from
// proto/druz9/v1/ai_native.proto). It is mounted in main.go via
// NewNativeServiceHandler + vanguard, so unary RPCs are served on both the
// native Connect path (/druz9.v1.NativeService/*) AND the REST paths declared
// via google.api.http annotations (/api/v1/native/*).
//
// ── Streaming caveat ──────────────────────────────────────────────────────
// SubmitPrompt is a SERVER-STREAMING RPC in the proto (emitting token deltas
// then a final NativePromptDone event). Vanguard does NOT transcode streaming
// RPCs to REST unless the response body is google.api.HttpBody; our schema is
// a typed proto message, so the REST path (/api/v1/native/session/{id}/prompt)
// returns 415 Unsupported Media Type from vanguard. REST clients wanting the
// final response must migrate to the Connect streaming path — this is an
// acknowledged MVP deferral (see docs/contract-first-with-buf.md for the plan
// to plumb real token streaming from the LLM provider).
//
// The streaming handler body is a STUB: it calls the existing unary
// `app.SubmitPrompt.Do` and emits a single `done` event carrying the full
// response. Real LLM-token streaming (via `LLMProvider.Stream`) is future
// work — keeping this minimal avoids reshaping the app/ layer in Phase B.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/ai_native/app"
	"druz9/ai_native/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — NativeServer satisfies the generated handler.
var _ druz9v1connect.NativeServiceHandler = (*NativeServer)(nil)

// NativeServer adapts ai_native use cases to the Connect handler interface.
//
// Field names are intentionally mangled (UC suffix) to avoid Go's method/field
// collision with the Connect-RPC methods of the same name (Verify / GetScore /
// GetProvenance / etc.).
type NativeServer struct {
	CreateUC   *app.CreateSession
	SubmitUC   *app.SubmitPrompt
	VerifyUC   *app.Verify
	GetProvUC  *app.GetProvenance
	GetScoreUC *app.GetScore
	FinishUC   *app.Finish

	Log *slog.Logger
}

// NewNativeServer wires the server.
func NewNativeServer(
	create *app.CreateSession,
	submit *app.SubmitPrompt,
	verify *app.Verify,
	getProv *app.GetProvenance,
	getScore *app.GetScore,
	finish *app.Finish,
	log *slog.Logger,
) *NativeServer {
	return &NativeServer{
		CreateUC: create, SubmitUC: submit, VerifyUC: verify,
		GetProvUC: getProv, GetScoreUC: getScore, FinishUC: finish, Log: log,
	}
}

// ── Connect handlers ──────────────────────────────────────────────────────

// CreateSession implements (POST /api/v1/native/session).
func (s *NativeServer) CreateSession(
	ctx context.Context,
	req *connect.Request[pb.CreateNativeRequest],
) (*connect.Response[pb.NativeSession], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	in := app.CreateSessionInput{
		UserID:     uid,
		Section:    sectionFromProtoNative(m.GetSection()),
		Difficulty: difficultyFromProtoNative(m.GetDifficulty()),
	}
	if lm := llmModelFromProtoNative(m.GetLlmModel()); lm != "" {
		in.PreferredModel = lm
	}
	out, err := s.CreateUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toNativeSessionProto(out.Session, out.Task)), nil
}

// SubmitPrompt is the server-streaming RPC. STUB: emits one `done` event with
// the full response — real LLM token streaming is future work.
func (s *NativeServer) SubmitPrompt(
	ctx context.Context,
	req *connect.Request[pb.SubmitPromptRequest],
	stream *connect.ServerStream[pb.NativePromptStreamEvent],
) error {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	if req.Msg.GetPrompt() == "" {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("prompt required"))
	}
	out, err := s.SubmitUC.Do(ctx, app.SubmitPromptInput{
		UserID:      uid,
		SessionID:   sessionID,
		Prompt:      req.Msg.GetPrompt(),
		ContextCode: req.Msg.GetContextCode(),
	})
	if err != nil {
		return s.toConnectErr(err)
	}
	// STUB: real token streaming from LLM.Stream. For now we emit a single
	// `done` event carrying the full response — matches the pre-Phase-B unary
	// behaviour, and any Connect streaming client will observe the terminal
	// message as expected.
	done := &pb.NativePromptStreamEvent{
		Kind: &pb.NativePromptStreamEvent_Done{
			Done: &pb.NativePromptDone{
				Final: &pb.NativePromptResponse{
					ResponseText:              out.ResponseText,
					ContainsHallucinationTrap: out.ContainsHallucinationTrap,
					ProvenanceId:              out.ProvenanceID.String(),
					Scores:                    toNativeScoresProto(out.Scores),
				},
			},
		},
	}
	if err := stream.Send(done); err != nil {
		return fmt.Errorf("native.SubmitPrompt: stream send: %w", err)
	}
	return nil
}

// Verify implements (POST /api/v1/native/session/{session_id}/verify).
func (s *NativeServer) Verify(
	ctx context.Context,
	req *connect.Request[pb.NativeVerifyRequest],
) (*connect.Response[pb.NativeScores], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	provID, err := uuid.Parse(req.Msg.GetProvenanceId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid provenance_id: %w", err))
	}
	action := actionFromProto(req.Msg.GetAction())
	if !action.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid action"))
	}
	out, err := s.VerifyUC.Do(ctx, app.VerifyInput{
		UserID:       uid,
		SessionID:    sessionID,
		ProvenanceID: provID,
		Action:       action,
		Reason:       req.Msg.GetReason(),
		RevisedCode:  req.Msg.GetRevisedCode(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toNativeScoresProto(out.Scores)), nil
}

// GetProvenance implements (GET /api/v1/native/session/{session_id}/provenance).
func (s *NativeServer) GetProvenance(
	ctx context.Context,
	req *connect.Request[pb.GetNativeProvenanceRequest],
) (*connect.Response[pb.NativeProvenanceGraph], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	out, err := s.GetProvUC.Do(ctx, app.GetProvenanceInput{UserID: uid, SessionID: sessionID})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toProvenanceGraphProto(out.Records)), nil
}

// GetScore implements (GET /api/v1/native/session/{session_id}/score).
func (s *NativeServer) GetScore(
	ctx context.Context,
	req *connect.Request[pb.GetNativeScoreRequest],
) (*connect.Response[pb.NativeScores], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sessionID, err := uuid.Parse(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", err))
	}
	out, err := s.GetScoreUC.Do(ctx, app.GetScoreInput{UserID: uid, SessionID: sessionID})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toNativeScoresProto(out.Scores)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *NativeServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidState):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("native: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("native failure"))
	}
}

// ── converters (domain → proto) ───────────────────────────────────────────

func toNativeSessionProto(s domain.Session, task domain.TaskPublic) *pb.NativeSession {
	out := &pb.NativeSession{
		Id:      s.ID.String(),
		Section: sectionToProtoNative(s.Section),
		Task: &pb.NativeTaskPublic{
			Id:          task.ID.String(),
			Slug:        task.Slug,
			Title:       task.Title,
			Description: task.Description,
			Difficulty:  difficultyToProtoNative(task.Difficulty),
			Section:     sectionToProtoNative(task.Section),
		},
		Scores: toNativeScoresProto(s.Scores),
	}
	if !s.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	if s.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(s.FinishedAt.UTC())
	}
	return out
}

func toNativeScoresProto(s domain.Scores) *pb.NativeScores {
	return &pb.NativeScores{
		Context:      int32(s.Context),
		Verification: int32(s.Verification),
		Judgment:     int32(s.Judgment),
		Delivery:     int32(s.Delivery),
	}
}

func toProvenanceGraphProto(records []domain.ProvenanceRecord) *pb.NativeProvenanceGraph {
	out := &pb.NativeProvenanceGraph{Records: make([]*pb.NativeProvenanceRecord, 0, len(records))}
	for _, r := range records {
		rec := &pb.NativeProvenanceRecord{
			Id:       r.ID.String(),
			Kind:     provenanceKindToProto(r.Kind),
			Snippet:  r.Snippet,
			AiPrompt: r.AIPrompt,
		}
		if r.ParentID != nil {
			rec.ParentId = r.ParentID.String()
		}
		if r.VerifiedAt != nil {
			rec.VerifiedAt = timestamppb.New(r.VerifiedAt.UTC())
		}
		if !r.CreatedAt.IsZero() {
			rec.CreatedAt = timestamppb.New(r.CreatedAt.UTC())
		}
		out.Records = append(out.Records, rec)
	}
	return out
}

// ── enum adapters ─────────────────────────────────────────────────────────

func sectionToProtoNative(s enums.Section) pb.Section {
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

func sectionFromProtoNative(s pb.Section) enums.Section {
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
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func difficultyToProtoNative(d enums.Difficulty) pb.Difficulty {
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

func difficultyFromProtoNative(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	case pb.Difficulty_DIFFICULTY_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func llmModelFromProtoNative(m pb.LLMModel) enums.LLMModel {
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
	case pb.LLMModel_LLM_MODEL_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func actionFromProto(a pb.NativeAction) domain.ActionKind {
	switch a {
	case pb.NativeAction_NATIVE_ACTION_ACCEPTED:
		return domain.ActionAccepted
	case pb.NativeAction_NATIVE_ACTION_REJECTED:
		return domain.ActionRejected
	case pb.NativeAction_NATIVE_ACTION_REVISED:
		return domain.ActionRevised
	case pb.NativeAction_NATIVE_ACTION_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func provenanceKindToProto(k enums.ProvenanceKind) pb.ProvenanceKind {
	switch k {
	case enums.ProvenanceKindAIGenerated:
		return pb.ProvenanceKind_PROVENANCE_KIND_AI_GENERATED
	case enums.ProvenanceKindHumanWritten:
		return pb.ProvenanceKind_PROVENANCE_KIND_HUMAN_WRITTEN
	case enums.ProvenanceKindAIRevisedByHuman:
		return pb.ProvenanceKind_PROVENANCE_KIND_AI_REVISED_BY_HUMAN
	case enums.ProvenanceKindAIRejected:
		return pb.ProvenanceKind_PROVENANCE_KIND_AI_REJECTED
	default:
		return pb.ProvenanceKind_PROVENANCE_KIND_UNSPECIFIED
	}
}
