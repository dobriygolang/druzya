// server_test.go covers MockServer's Connect-RPC adapters end-to-end against
// in-memory mocks of the use-case dependencies. We deliberately do NOT spin
// up an HTTP server — the Connect handler interface is stable and lets us
// invoke each method directly with a context-carried user-id, which is how
// the auth middleware would have populated it in production.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"druz9/ai_mock/app"
	"druz9/ai_mock/domain"
	"druz9/ai_mock/domain/mocks"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// silentLogger discards every event so test output stays clean.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(discard{}, nil))
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }

// authedCtx returns a context carrying uid as if the auth middleware had run.
func authedCtx(uid uuid.UUID) context.Context {
	return sharedMw.WithUserID(context.Background(), uid)
}

// fakeLLM is the minimal LLMProvider stub used by use cases. The default
// behaviour is "returns a 1-line answer"; tests that need streaming override
// Stream explicitly.
type fakeLLM struct {
	completeContent string
	completeErr     error
}

func (f *fakeLLM) Complete(_ context.Context, _ domain.CompletionRequest) (domain.CompletionResponse, error) {
	if f.completeErr != nil {
		return domain.CompletionResponse{}, f.completeErr
	}
	return domain.CompletionResponse{Content: f.completeContent, TokensUsed: 7}, nil
}

func (f *fakeLLM) Stream(_ context.Context, _ domain.CompletionRequest) (<-chan domain.Token, error) {
	ch := make(chan domain.Token)
	close(ch)
	return ch, nil
}

// noLimiter is the default rate-limiter — always allows.
type noLimiter struct{}

func (noLimiter) Allow(_ context.Context, _ string, _ int, _ int) (bool, int, error) {
	return true, 0, nil
}

// buildServer constructs a MockServer with all use cases wired against the
// supplied mocks. Each test calls this with a fresh gomock controller.
func buildServer(t *testing.T, sessions domain.SessionRepo, messages domain.MessageRepo, tasks domain.TaskRepo, users domain.UserRepo, companies domain.CompanyRepo, llm domain.LLMProvider) *MockServer {
	t.Helper()
	now := func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }
	create := &app.CreateSession{
		Sessions: sessions, Tasks: tasks, Users: users, Companies: companies,
		DefaultModelFree: enums.LLMModelGPT4oMini,
		DefaultModelPaid: enums.LLMModelGPT4o,
		Log:              silentLogger(), Now: now,
	}
	get := &app.GetSession{
		Sessions: sessions, Messages: messages, Tasks: tasks,
		LastMessagesLimit: 10,
	}
	send := &app.SendMessage{
		Sessions: sessions, Messages: messages, Tasks: tasks, Users: users, Companies: companies,
		LLM: llm, Limiter: noLimiter{}, Log: silentLogger(), Now: now,
	}
	stress := &app.IngestStress{Sessions: sessions}
	finish := &app.FinishSession{Sessions: sessions, Log: silentLogger(), Now: now}
	report := &app.GetReport{Sessions: sessions}
	return NewMockServer(create, get, send, stress, finish, report, silentLogger())
}

// ── CreateSession ────────────────────────────────────────────────────────

func TestServer_CreateSession_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv := buildServer(t, nil, nil, nil, nil, nil, nil)
	_, err := srv.CreateSession(context.Background(), connect.NewRequest(&pb.CreateMockRequest{
		CompanyId: uuid.New().String(),
	}))
	if err == nil {
		t.Fatal("expected unauthenticated error")
	}
	if got := connect.CodeOf(err); got != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", got)
	}
}

func TestServer_CreateSession_InvalidCompanyID(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	srv := buildServer(t, nil, nil, nil, nil, nil, nil)
	_, err := srv.CreateSession(authedCtx(uid), connect.NewRequest(&pb.CreateMockRequest{
		CompanyId: "not-a-uuid",
	}))
	if err == nil {
		t.Fatal("expected invalid-argument error")
	}
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", got)
	}
}

func TestServer_CreateSession_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, cid, tid, sid := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	sessions := mocks.NewMockSessionRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	users := mocks.NewMockUserRepo(ctrl)
	companies := mocks.NewMockCompanyRepo(ctrl)

	users.EXPECT().Get(gomock.Any(), uid).Return(domain.UserContext{ID: uid, Subscription: enums.SubscriptionPlanFree}, nil)
	companies.EXPECT().Get(gomock.Any(), cid).Return(domain.CompanyContext{ID: cid, Name: "Yandex", Level: "senior"}, nil)
	tasks.EXPECT().PickForSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.TaskWithHint{ID: tid, Slug: "lru", Title: "LRU"}, nil)
	sessions.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
		s.ID = sid
		return s, nil
	})

	srv := buildServer(t, sessions, nil, tasks, users, companies, nil)
	resp, err := srv.CreateSession(authedCtx(uid), connect.NewRequest(&pb.CreateMockRequest{
		CompanyId:   cid.String(),
		Section:     pb.Section_SECTION_ALGORITHMS,
		Difficulty:  pb.Difficulty_DIFFICULTY_MEDIUM,
		DurationMin: 45,
	}))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if resp.Msg.GetId() != sid.String() {
		t.Fatalf("session id = %q, want %q", resp.Msg.GetId(), sid.String())
	}
}

// TestServer_CreateSession_AIAssistRoundTrip pins the Phase-4 ADR-001 (Wave 3)
// wire: ai_assist set on the proto request must reach the persisted Session
// AND surface back on the proto response. Drives copilot.CheckBlock.
func TestServer_CreateSession_AIAssistRoundTrip(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, cid, tid, sid := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	sessions := mocks.NewMockSessionRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	users := mocks.NewMockUserRepo(ctrl)
	companies := mocks.NewMockCompanyRepo(ctrl)

	users.EXPECT().Get(gomock.Any(), uid).Return(domain.UserContext{ID: uid, Subscription: enums.SubscriptionPlanFree}, nil)
	companies.EXPECT().Get(gomock.Any(), cid).Return(domain.CompanyContext{ID: cid, Name: "Yandex", Level: "senior"}, nil)
	tasks.EXPECT().PickForSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.TaskWithHint{ID: tid, Slug: "lru", Title: "LRU"}, nil)
	sessions.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
		if !s.AIAssist {
			t.Fatalf("AIAssist did not reach repo.Create — got %v", s.AIAssist)
		}
		s.ID = sid
		return s, nil
	})

	srv := buildServer(t, sessions, nil, tasks, users, companies, nil)
	resp, err := srv.CreateSession(authedCtx(uid), connect.NewRequest(&pb.CreateMockRequest{
		CompanyId:   cid.String(),
		Section:     pb.Section_SECTION_ALGORITHMS,
		Difficulty:  pb.Difficulty_DIFFICULTY_MEDIUM,
		DurationMin: 45,
		AiAssist:    true,
	}))
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if !resp.Msg.GetAiAssist() {
		t.Fatalf("response ai_assist = false, want true")
	}
}

// ── GetSession ────────────────────────────────────────────────────────────

func TestServer_GetSession_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{}, domain.ErrNotFound)

	srv := buildServer(t, sessions, mocks.NewMockMessageRepo(ctrl), mocks.NewMockTaskRepo(ctrl), nil, nil, nil)
	_, err := srv.GetSession(authedCtx(uid), connect.NewRequest(&pb.GetMockSessionRequest{SessionId: sid.String()}))
	if err == nil {
		t.Fatal("expected not-found error")
	}
	if got := connect.CodeOf(err); got != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", got)
	}
}

func TestServer_GetSession_PermissionDenied(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, otherUID, sid := uuid.New(), uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	// Session belongs to otherUID — caller is uid → ErrForbidden.
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: otherUID}, nil)

	srv := buildServer(t, sessions, mocks.NewMockMessageRepo(ctrl), mocks.NewMockTaskRepo(ctrl), nil, nil, nil)
	_, err := srv.GetSession(authedCtx(uid), connect.NewRequest(&pb.GetMockSessionRequest{SessionId: sid.String()}))
	if err == nil {
		t.Fatal("expected permission-denied error")
	}
	if got := connect.CodeOf(err); got != connect.CodePermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied", got)
	}
}

func TestServer_GetSession_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid, tid := uuid.New(), uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	messages := mocks.NewMockMessageRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)

	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{
		ID: sid, UserID: uid, TaskID: tid,
		Section: enums.SectionAlgorithms, Difficulty: enums.DifficultyMedium,
		Status: enums.MockStatusInProgress, DurationMin: 45,
	}, nil)
	messages.EXPECT().ListLast(gomock.Any(), sid, 10).Return([]domain.Message{
		{ID: uuid.New(), SessionID: sid, Role: enums.MessageRoleAssistant, Content: "hi"},
	}, nil)
	tasks.EXPECT().GetWithHint(gomock.Any(), tid).Return(domain.TaskWithHint{
		ID: tid, Slug: "lru", Title: "LRU", Description: "...", SolutionHint: "PRIVATE",
	}, nil)

	srv := buildServer(t, sessions, messages, tasks, nil, nil, nil)
	resp, err := srv.GetSession(authedCtx(uid), connect.NewRequest(&pb.GetMockSessionRequest{SessionId: sid.String()}))
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if resp.Msg.GetTask() == nil {
		t.Fatal("expected task in response")
	}
	if resp.Msg.GetTask().GetTitle() != "LRU" {
		t.Fatalf("title = %q", resp.Msg.GetTask().GetTitle())
	}
	// Solution-hint must NOT cross the wire.
	for _, m := range resp.Msg.GetLastMessages() {
		if m.GetContent() == "PRIVATE" {
			t.Fatal("solution hint leaked into response")
		}
	}
}

// ── SendMessage ──────────────────────────────────────────────────────────

func TestServer_SendMessage_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid, cid, tid := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	sessions := mocks.NewMockSessionRepo(ctrl)
	messages := mocks.NewMockMessageRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	users := mocks.NewMockUserRepo(ctrl)
	companies := mocks.NewMockCompanyRepo(ctrl)

	sess := domain.Session{
		ID: sid, UserID: uid, CompanyID: cid, TaskID: tid,
		Status: enums.MockStatusInProgress, LLMModel: enums.LLMModelGPT4oMini,
	}
	sessions.EXPECT().Get(gomock.Any(), sid).Return(sess, nil).AnyTimes()
	tasks.EXPECT().GetWithHint(gomock.Any(), tid).Return(domain.TaskWithHint{ID: tid}, nil)
	messages.EXPECT().ListAll(gomock.Any(), sid).Return(nil, nil)
	users.EXPECT().Get(gomock.Any(), uid).Return(domain.UserContext{ID: uid}, nil)
	companies.EXPECT().Get(gomock.Any(), cid).Return(domain.CompanyContext{ID: cid}, nil)

	// Persist user message, then assistant message.
	messages.EXPECT().Append(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, m domain.Message) (domain.Message, error) {
		m.ID = uuid.New()
		return m, nil
	}).Times(2)

	srv := buildServer(t, sessions, messages, tasks, users, companies, &fakeLLM{completeContent: "AI reply"})
	resp, err := srv.SendMessage(authedCtx(uid), connect.NewRequest(&pb.MockMessageRequest{
		SessionId: sid.String(),
		Content:   "hello AI",
	}))
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if resp.Msg.GetContent() != "AI reply" {
		t.Fatalf("AI reply = %q", resp.Msg.GetContent())
	}
}

func TestServer_SendMessage_ToFinishedSession(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: uid, Status: enums.MockStatusFinished}, nil)

	srv := buildServer(t, sessions, mocks.NewMockMessageRepo(ctrl), mocks.NewMockTaskRepo(ctrl), mocks.NewMockUserRepo(ctrl), mocks.NewMockCompanyRepo(ctrl), &fakeLLM{})
	_, err := srv.SendMessage(authedCtx(uid), connect.NewRequest(&pb.MockMessageRequest{SessionId: sid.String(), Content: "hi"}))
	if err == nil {
		t.Fatal("expected invalid-argument error")
	}
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", got)
	}
}

func TestServer_SendMessage_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv := buildServer(t, nil, nil, nil, nil, nil, nil)
	_, err := srv.SendMessage(context.Background(), connect.NewRequest(&pb.MockMessageRequest{SessionId: uuid.New().String(), Content: "hi"}))
	if err == nil || connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("expected unauthenticated, got %v", err)
	}
}

func TestServer_SendMessage_EmptyContent(t *testing.T) {
	t.Parallel()
	srv := buildServer(t, nil, nil, nil, nil, nil, nil)
	_, err := srv.SendMessage(authedCtx(uuid.New()), connect.NewRequest(&pb.MockMessageRequest{
		SessionId: uuid.New().String(),
		// no content, no voice transcript
	}))
	if err == nil || connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("expected invalid-argument, got %v", err)
	}
}

// ── FinishSession ────────────────────────────────────────────────────────

func TestServer_FinishSession_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: uid, Status: enums.MockStatusInProgress}, nil)
	sessions.EXPECT().UpdateStatus(gomock.Any(), sid, enums.MockStatusFinished.String(), true).Return(nil)

	srv := buildServer(t, sessions, nil, nil, nil, nil, nil)
	resp, err := srv.FinishSession(authedCtx(uid), connect.NewRequest(&pb.FinishMockSessionRequest{SessionId: sid.String()}))
	if err != nil {
		t.Fatalf("FinishSession: %v", err)
	}
	if resp.Msg.GetStatus() != pb.MockStatus_MOCK_STATUS_FINISHED {
		t.Fatalf("status = %v", resp.Msg.GetStatus())
	}
}

func TestServer_FinishSession_DoubleFinishIdempotent(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	// Already finished — must NOT call UpdateStatus.
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: uid, Status: enums.MockStatusFinished}, nil)

	srv := buildServer(t, sessions, nil, nil, nil, nil, nil)
	resp, err := srv.FinishSession(authedCtx(uid), connect.NewRequest(&pb.FinishMockSessionRequest{SessionId: sid.String()}))
	if err != nil {
		t.Fatalf("idempotent finish: %v", err)
	}
	if resp.Msg.GetStatus() != pb.MockStatus_MOCK_STATUS_FINISHED {
		t.Fatal("status should remain finished")
	}
}

func TestServer_FinishSession_Forbidden(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, otherUID, sid := uuid.New(), uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: otherUID, Status: enums.MockStatusInProgress}, nil)

	srv := buildServer(t, sessions, nil, nil, nil, nil, nil)
	_, err := srv.FinishSession(authedCtx(uid), connect.NewRequest(&pb.FinishMockSessionRequest{SessionId: sid.String()}))
	if err == nil || connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
}

// ── GetReport ────────────────────────────────────────────────────────────

func TestServer_GetReport_Processing(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	// Empty Report → still processing.
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{ID: sid, UserID: uid, Status: enums.MockStatusFinished}, nil)

	srv := buildServer(t, sessions, nil, nil, nil, nil, nil)
	resp, err := srv.GetReport(authedCtx(uid), connect.NewRequest(&pb.GetMockReportRequest{SessionId: sid.String()}))
	if err != nil {
		t.Fatalf("GetReport: %v", err)
	}
	if resp.Msg.GetStatus() != "processing" {
		t.Fatalf("status = %q, want processing", resp.Msg.GetStatus())
	}
}

func TestServer_GetReport_Ready(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid, sid := uuid.New(), uuid.New()
	sessions := mocks.NewMockSessionRepo(ctrl)
	// Worker writes the blob via json.Marshal(domain.ReportDraft{...}) which
	// emits CamelCase keys (no struct tags). The reader uses case-insensitive
	// unmarshal — so we replicate the write-side shape here.
	sessions.EXPECT().Get(gomock.Any(), sid).Return(domain.Session{
		ID: sid, UserID: uid, Status: enums.MockStatusFinished,
		Report:    []byte(`{"OverallScore": 84, "Sections": {"ProblemSolving": {"Score": 90, "Comment": "ok"}}}`),
		ReplayURL: "https://replays.example/foo.json",
	}, nil)

	srv := buildServer(t, sessions, nil, nil, nil, nil, nil)
	resp, err := srv.GetReport(authedCtx(uid), connect.NewRequest(&pb.GetMockReportRequest{SessionId: sid.String()}))
	if err != nil {
		t.Fatalf("GetReport: %v", err)
	}
	if resp.Msg.GetStatus() != "ready" {
		t.Fatalf("status = %q, want ready", resp.Msg.GetStatus())
	}
	if resp.Msg.GetOverallScore() != 84 {
		t.Fatalf("overall_score = %d", resp.Msg.GetOverallScore())
	}
	if resp.Msg.GetReplayUrl() == "" {
		t.Fatalf("replay_url should be propagated")
	}
}

// ── error mapping ─────────────────────────────────────────────────────────

func TestServer_ToConnectErr_DefaultIsInternal(t *testing.T) {
	t.Parallel()
	srv := buildServer(t, nil, nil, nil, nil, nil, nil)
	got := srv.toConnectErr(errors.New("upstream exploded"))
	if connect.CodeOf(got) != connect.CodeInternal {
		t.Fatalf("default mapping should be Internal, got %v", connect.CodeOf(got))
	}
}
