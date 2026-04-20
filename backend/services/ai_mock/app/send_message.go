package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_mock/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// MessageContextSize is the number of prior messages sent to the LLM in addition
// to the system prompt. Bible §8: "last 10 messages always included".
const MessageContextSize = 10

// PerSessionRateLimit is the per-session message budget per minute.
const PerSessionRateLimit = 10

// PerSessionRateWindow is the rate-limit window (seconds).
const PerSessionRateWindow = 60

// SendMessage implements POST /api/v1/mock/session/:id/message.
type SendMessage struct {
	Sessions  domain.SessionRepo
	Messages  domain.MessageRepo
	Tasks     domain.TaskRepo
	Users     domain.UserRepo
	Companies domain.CompanyRepo
	LLM       domain.LLMProvider
	Limiter   domain.RateLimiter
	Log       *slog.Logger
	Now       func() time.Time
}

// SendMessageInput carries the user-supplied payload.
type SendMessageInput struct {
	UserID          uuid.UUID
	SessionID       uuid.UUID
	Content         string
	CodeSnapshot    string
	VoiceTranscript string
}

// SendMessageResult is the final assistant message returned to the HTTP caller.
// Streaming is not plumbed across the HTTP response here — the WS handler uses
// the lower-level streamAssistant helper to pipe tokens to the socket.
type SendMessageResult struct {
	UserMessage      domain.Message
	AssistantMessage domain.Message
}

// Do executes the use case: persists the user message, streams the LLM
// response, persists the assistant message, and returns the assembled
// assistant message.
func (uc *SendMessage) Do(ctx context.Context, in SendMessageInput) (SendMessageResult, error) {
	s, err := uc.loadSession(ctx, in.UserID, in.SessionID)
	if err != nil {
		return SendMessageResult{}, err
	}
	if uc.Limiter != nil {
		ok, retry, rerr := uc.Limiter.Allow(ctx, "sess:"+in.SessionID.String(), PerSessionRateLimit, PerSessionRateWindow)
		if rerr != nil {
			uc.Log.WarnContext(ctx, "mock.SendMessage: limiter err", slog.Any("err", rerr))
		} else if !ok {
			return SendMessageResult{}, fmt.Errorf("mock.SendMessage: %w (retry in %ds)", domain.ErrInvalidState, retry)
		}
	}

	// If voice_transcript set, prefer it — bible §8 treats voice as text.
	content := in.Content
	if in.VoiceTranscript != "" {
		content = in.VoiceTranscript
	}

	userMsg, err := uc.Messages.Append(ctx, domain.Message{
		SessionID:    in.SessionID,
		Role:         enums.MessageRoleUser,
		Content:      content,
		CodeSnapshot: in.CodeSnapshot,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("mock.SendMessage: persist user: %w", err)
	}

	assistantContent, tokens, err := uc.generateReply(ctx, s, in.CodeSnapshot)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("mock.SendMessage: generate: %w", err)
	}

	assistant, err := uc.Messages.Append(ctx, domain.Message{
		SessionID:  in.SessionID,
		Role:       enums.MessageRoleAssistant,
		Content:    assistantContent,
		TokensUsed: tokens,
	})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("mock.SendMessage: persist assistant: %w", err)
	}

	// Transition created → in_progress on first message.
	if s.Status == enums.MockStatusCreated {
		if err := uc.Sessions.UpdateStatus(ctx, s.ID, enums.MockStatusInProgress.String(), false); err != nil {
			uc.Log.WarnContext(ctx, "mock.SendMessage: transition status", slog.Any("err", err))
		}
	}

	return SendMessageResult{UserMessage: userMsg, AssistantMessage: assistant}, nil
}

// loadSession retrieves + authorises the session.
func (uc *SendMessage) loadSession(ctx context.Context, userID, sessionID uuid.UUID) (domain.Session, error) {
	s, err := uc.Sessions.Get(ctx, sessionID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.SendMessage: %w", err)
	}
	if s.UserID != userID {
		return domain.Session{}, fmt.Errorf("mock.SendMessage: %w", domain.ErrForbidden)
	}
	switch s.Status {
	case enums.MockStatusFinished, enums.MockStatusAbandoned:
		return domain.Session{}, fmt.Errorf("mock.SendMessage: %w: session is %s", domain.ErrInvalidState, s.Status)
	case enums.MockStatusCreated, enums.MockStatusInProgress:
		// ok
	}
	return s, nil
}

// generateReply assembles the full prompt context and calls the LLM.
// Non-streaming path used by the HTTP endpoint; StreamReply is the WS path.
func (uc *SendMessage) generateReply(ctx context.Context, s domain.Session, currentCode string) (string, int, error) {
	task, history, user, company, err := uc.loadContext(ctx, s)
	if err != nil {
		return "", 0, err
	}
	msgs := buildLLMMessages(s, task, user, company, history, currentCode, time.Since(firstOr(s.StartedAt, s.CreatedAt)))

	model := s.LLMModel.String()
	if model == "" {
		model = uc.fallbackModel(user)
	}
	resp, err := uc.LLM.Complete(ctx, domain.CompletionRequest{
		Model:       model,
		Messages:    msgs,
		Temperature: 0.7,
		MaxTokens:   1024,
	})
	if err != nil {
		return "", 0, err
	}
	return resp.Content, resp.TokensUsed, nil
}

// StreamReply is the WS path: builds context, persists user message ahead of
// time (done by the caller), then streams tokens over the returned channel.
// Caller must persist the assistant message from the accumulated content.
func (uc *SendMessage) StreamReply(ctx context.Context, s domain.Session, currentCode string) (<-chan domain.Token, error) {
	task, history, user, company, err := uc.loadContext(ctx, s)
	if err != nil {
		return nil, err
	}
	msgs := buildLLMMessages(s, task, user, company, history, currentCode, time.Since(firstOr(s.StartedAt, s.CreatedAt)))
	model := s.LLMModel.String()
	if model == "" {
		model = uc.fallbackModel(user)
	}
	return uc.LLM.Stream(ctx, domain.CompletionRequest{
		Model:       model,
		Messages:    msgs,
		Temperature: 0.7,
		MaxTokens:   1024,
	})
}

func (uc *SendMessage) loadContext(ctx context.Context, s domain.Session) (domain.TaskWithHint, []domain.Message, domain.UserContext, domain.CompanyContext, error) {
	task, err := uc.Tasks.GetWithHint(ctx, s.TaskID)
	if err != nil {
		return domain.TaskWithHint{}, nil, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("task: %w", err)
	}
	// SummarizeOlder is the future compaction step. For now we just take the
	// tail; see STUB note below.
	history, err := SummarizeOlder(ctx, uc.Messages, s.ID, MessageContextSize)
	if err != nil {
		return domain.TaskWithHint{}, nil, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("history: %w", err)
	}
	user, err := uc.Users.Get(ctx, s.UserID)
	if err != nil {
		return domain.TaskWithHint{}, nil, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("user: %w", err)
	}
	company, err := uc.Companies.Get(ctx, s.CompanyID)
	if err != nil {
		return domain.TaskWithHint{}, nil, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("company: %w", err)
	}
	return task, history, user, company, nil
}

func (uc *SendMessage) fallbackModel(user domain.UserContext) string {
	switch user.Subscription {
	case enums.SubscriptionPlanSeeker, enums.SubscriptionPlanAscendant:
		return enums.LLMModelGPT4o.String()
	case enums.SubscriptionPlanFree:
		return enums.LLMModelGPT4oMini.String()
	}
	return enums.LLMModelGPT4oMini.String()
}

// buildLLMMessages produces the final [system, …history, user?] slice. The
// caller already persisted the incoming user message into history.
func buildLLMMessages(s domain.Session, t domain.TaskWithHint, user domain.UserContext, company domain.CompanyContext, history []domain.Message, currentCode string, elapsed time.Duration) []domain.LLMMessage {
	sys := domain.BuildSystemPrompt(s, t, user, company, elapsed, s.Stress, currentCode)
	msgs := []domain.LLMMessage{{Role: domain.LLMRoleSystem, Content: sys}}
	msgs = append(msgs, domain.ToLLMMessages(history, MessageContextSize)...)
	return msgs
}

// SummarizeOlder is a STUB context-compaction helper. Today it simply returns
// the last MessageContextSize messages from the DB; the docstring lists the
// full plan.
//
// STUB: once token counting is wired, if total tokens exceed model limit,
// summarise [0..len-MessageContextSize] via a second LLM call and prepend the
// summary as a system message. Tracking: bible §8 "older messages → summarized".
func SummarizeOlder(ctx context.Context, msgs domain.MessageRepo, sessionID uuid.UUID, keep int) ([]domain.Message, error) {
	return msgs.ListLast(ctx, sessionID, keep)
}

func firstOr(p *time.Time, fallback time.Time) time.Time {
	if p != nil {
		return *p
	}
	return fallback
}
