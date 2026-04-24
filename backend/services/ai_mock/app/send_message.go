package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/ai_mock/domain"
	"druz9/shared/enums"
	"druz9/shared/pkg/compaction"

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

	// Compactor — опциональный фоновый суммаризатор. Nil → окно всё равно
	// обрезается (последние 10 turns), но running_summary не пересчитывается.
	// См. backend/shared/pkg/compaction.
	Compactor     *compaction.Worker
	CompactionCfg compaction.Config
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

	assistantContent, tokens, window, err := uc.generateReply(ctx, s, in.CodeSnapshot)
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

	uc.maybeSubmitCompaction(s, window, userMsg, assistant)

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
// Возвращает также compaction.Window, построенное ДО текущего ответа —
// caller использует его в maybeSubmitCompaction после persist.
func (uc *SendMessage) generateReply(ctx context.Context, s domain.Session, currentCode string) (string, int, compaction.Window, error) {
	task, window, user, company, err := uc.loadContext(ctx, s)
	if err != nil {
		return "", 0, compaction.Window{}, err
	}
	msgs := buildLLMMessages(s, task, user, company, window, currentCode, time.Since(firstOr(s.StartedAt, s.CreatedAt)))

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
		return "", 0, compaction.Window{}, fmt.Errorf("mock.SendMessage: complete: %w", err)
	}
	return resp.Content, resp.TokensUsed, window, nil
}

// StreamReply is the WS path: builds context, persists user message ahead of
// time (done by the caller), then streams tokens over the returned channel.
// Caller must persist the assistant message from the accumulated content.
func (uc *SendMessage) StreamReply(ctx context.Context, s domain.Session, currentCode string) (<-chan domain.Token, error) {
	task, window, user, company, err := uc.loadContext(ctx, s)
	if err != nil {
		return nil, err
	}
	msgs := buildLLMMessages(s, task, user, company, window, currentCode, time.Since(firstOr(s.StartedAt, s.CreatedAt)))
	model := s.LLMModel.String()
	if model == "" {
		model = uc.fallbackModel(user)
	}
	stream, err := uc.LLM.Stream(ctx, domain.CompletionRequest{
		Model:       model,
		Messages:    msgs,
		Temperature: 0.7,
		MaxTokens:   1024,
	})
	if err != nil {
		return nil, fmt.Errorf("mock.SendMessage: stream: %w", err)
	}
	return stream, nil
}

func (uc *SendMessage) loadContext(ctx context.Context, s domain.Session) (domain.TaskWithHint, compaction.Window, domain.UserContext, domain.CompanyContext, error) {
	task, err := uc.Tasks.GetWithHint(ctx, s.TaskID)
	if err != nil {
		return domain.TaskWithHint{}, compaction.Window{}, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("task: %w", err)
	}
	// Было SummarizeOlder(keep=MessageContextSize) — теперь BuildWindow:
	// грузим полный список, отдаём LLM последние WindowSize turns; старые
	// turns (выше threshold'а) уже сжаты в Session.RunningSummary фоновым
	// воркером и вставятся отдельным system-сообщением в buildLLMMessages.
	all, err := uc.Messages.ListAll(ctx, s.ID)
	if err != nil {
		return domain.TaskWithHint{}, compaction.Window{}, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("history: %w", err)
	}
	window := compaction.BuildWindow(turnsFromMessages(all), s.RunningSummary, uc.compactionConfig())
	user, err := uc.Users.Get(ctx, s.UserID)
	if err != nil {
		return domain.TaskWithHint{}, compaction.Window{}, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("user: %w", err)
	}
	company, err := uc.Companies.Get(ctx, s.CompanyID)
	if err != nil {
		return domain.TaskWithHint{}, compaction.Window{}, domain.UserContext{}, domain.CompanyContext{}, fmt.Errorf("company: %w", err)
	}
	return task, window, user, company, nil
}

// compactionConfig — защита от невалидного/пустого поля: подменяем
// дефолтами, если вне bootstrap'а кто-то инстанциировал SendMessage без
// конфига (unit-тесты). BuildWindow и так fail-soft, но отдать ему
// заведомо валидное значение понятнее.
func (uc *SendMessage) compactionConfig() compaction.Config {
	if uc.CompactionCfg.WindowSize > 0 && uc.CompactionCfg.Threshold >= uc.CompactionCfg.WindowSize {
		return uc.CompactionCfg
	}
	return compaction.DefaultConfig()
}

// maybeSubmitCompaction — после persist'а свежего user/assistant turn'а
// перестраивает окно и non-blocking Submit'ит Job, если переполнение.
func (uc *SendMessage) maybeSubmitCompaction(s domain.Session, priorWindow compaction.Window, user, assistant domain.Message) {
	if uc.Compactor == nil {
		return
	}
	turns := append([]compaction.Turn(nil), priorWindow.Tail...)
	if strings.TrimSpace(user.Content) != "" {
		turns = append(turns, compaction.Turn{Role: string(user.Role), Content: user.Content})
	}
	if strings.TrimSpace(assistant.Content) != "" {
		turns = append(turns, compaction.Turn{Role: string(assistant.Role), Content: assistant.Content})
	}
	fresh := compaction.BuildWindow(turns, priorWindow.RunningSummary, uc.compactionConfig())
	if !fresh.NeedsCompaction {
		return
	}
	err := uc.Compactor.Submit(compaction.Job{
		SessionKey:  s.ID.String(),
		PrevSummary: fresh.RunningSummary,
		OldTurns:    fresh.OldTurns,
	})
	if err != nil && !errors.Is(err, compaction.ErrWorkerStopped) && uc.Log != nil {
		uc.Log.Warn("mock.SendMessage: compaction submit failed",
			slog.Any("err", err), slog.String("session", s.ID.String()))
	}
}

// turnsFromMessages — мост между domain.Message и compaction.Turn
// (пакет compaction — domain-agnostic). Симметричен copilot/app.
func turnsFromMessages(msgs []domain.Message) []compaction.Turn {
	out := make([]compaction.Turn, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, compaction.Turn{Role: string(m.Role), Content: m.Content})
	}
	return out
}

// fallbackModel picks a default model when the session doesn't pin one.
// Paid tiers get the full GPT-4o; free and anything unknown fall back to
// 4o-mini (cost-safe default).
func (uc *SendMessage) fallbackModel(user domain.UserContext) string {
	switch user.Subscription {
	case enums.SubscriptionPlanSeeker, enums.SubscriptionPlanAscendant:
		return enums.LLMModelGPT4o.String()
	case enums.SubscriptionPlanFree:
		return enums.LLMModelGPT4oMini.String()
	default:
		return enums.LLMModelGPT4oMini.String()
	}
}

// buildLLMMessages produces the final [system, summary?, …tail] slice.
// Если у session.RunningSummary непустая строка — вставляем её отдельным
// system-сообщением СРАЗУ после главного prompt'а (до tail turns).
// Сам tail уже обрезан BuildWindow'ом до WindowSize последних turns.
func buildLLMMessages(s domain.Session, t domain.TaskWithHint, user domain.UserContext, company domain.CompanyContext, window compaction.Window, currentCode string, elapsed time.Duration) []domain.LLMMessage {
	sys := domain.BuildSystemPrompt(s, t, user, company, elapsed, s.Stress, currentCode)
	msgs := []domain.LLMMessage{{Role: domain.LLMRoleSystem, Content: sys}}
	if sum := strings.TrimSpace(window.RunningSummary); sum != "" {
		msgs = append(msgs, domain.LLMMessage{
			Role:    domain.LLMRoleSystem,
			Content: "Previous conversation summary:\n" + sum,
		})
	}
	for _, t := range window.Tail {
		role := domain.LLMRoleUser
		switch enums.MessageRole(t.Role) {
		case enums.MessageRoleSystem:
			role = domain.LLMRoleSystem
		case enums.MessageRoleAssistant:
			role = domain.LLMRoleAssistant
		case enums.MessageRoleUser:
			role = domain.LLMRoleUser
		}
		msgs = append(msgs, domain.LLMMessage{Role: role, Content: t.Content})
	}
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
	out, err := msgs.ListLast(ctx, sessionID, keep)
	if err != nil {
		return nil, fmt.Errorf("mock.SummarizeOlder: %w", err)
	}
	return out, nil
}

func firstOr(p *time.Time, fallback time.Time) time.Time {
	if p != nil {
		return *p
	}
	return fallback
}
