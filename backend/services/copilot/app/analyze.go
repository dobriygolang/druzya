package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/copilot/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Stream frame surfaced to the caller
// ─────────────────────────────────────────────────────────────────────────

// StreamFrame is what the ports layer translates into proto stream events.
// Exactly one of Created/Delta/Done/Err is populated per frame.
type StreamFrame struct {
	Created *ConversationCreatedFrame
	Delta   string
	Done    *ConversationDoneFrame
	Err     error
}

// ConversationCreatedFrame carries ids assigned when the stream opens.
type ConversationCreatedFrame struct {
	ConversationID     uuid.UUID
	UserMessageID      uuid.UUID
	AssistantMessageID uuid.UUID
	Model              string
}

// ConversationDoneFrame is the final frame with token accounting + updated
// quota snapshot (so the client does not need a follow-up GetQuota).
type ConversationDoneFrame struct {
	AssistantMessageID uuid.UUID
	TokensIn           int
	TokensOut          int
	LatencyMs          int
	Quota              domain.Quota
}

// ─────────────────────────────────────────────────────────────────────────
// Shared deps and helpers
// ─────────────────────────────────────────────────────────────────────────

// systemPrompt is the server-controlled prelude prepended to every copilot
// conversation. Client never sees this. Kept short — budget for the user's
// screenshot bytes and follow-up context.
const systemPrompt = `You are Druz9 Copilot — a stealthy, precise assistant for software engineers.
You are being shown a screenshot of the user's screen (code, terminal, a task, or an error).
Answer in the language the user wrote to you (Russian by default).
Be concise. Use Markdown. When quoting code, use fenced blocks with the correct language tag.
When the screenshot shows a programming task, explain the idea first, then show a clean solution.
Never mention that you cannot see the image if an image is provided — analyse it as given.`

// streamOptions holds cross-cutting knobs shared between Analyze and Chat.
type streamOptions struct {
	DefaultModel string
	Temperature  float64
	MaxTokens    int
}

// deriveTitle takes the first ~60 chars of a prompt as the conversation
// title. Falls back to a generic label when the prompt is empty (image-only).
func deriveTitle(prompt string) string {
	s := strings.TrimSpace(prompt)
	if s == "" {
		return "Скриншот"
	}
	const maxRunes = 60
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}

// anyScreenshot reports whether any attachment is an image payload.
func anyScreenshot(atts []domain.AttachmentInput) bool {
	for _, a := range atts {
		if a.IsScreenshot() {
			return true
		}
	}
	return false
}

// toLLMImages converts attachments into the domain.LLMImage shape, skipping
// non-screenshot kinds.
func toLLMImages(atts []domain.AttachmentInput) []domain.LLMImage {
	out := make([]domain.LLMImage, 0, len(atts))
	for _, a := range atts {
		if !a.IsScreenshot() {
			continue
		}
		out = append(out, domain.LLMImage{MimeType: a.MimeType, Data: a.Data})
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// Analyze use case
// ─────────────────────────────────────────────────────────────────────────

// Analyze implements streaming Analyze: creates a conversation (or reuses
// one when ConversationID is non-nil), records the user turn, opens an LLM
// stream, pipes deltas, and commits the assistant turn on Done.
//
// The caller receives a channel of StreamFrame. The channel closes when the
// stream terminates — successfully or not. Errors arrive as a frame with
// Err set; they are terminal and no further frames follow.
type Analyze struct {
	Conversations domain.ConversationRepo
	Messages      domain.MessageRepo
	Quotas        domain.QuotaRepo
	LLM           domain.LLMProvider
	Config        domain.ConfigProvider
	// Sessions is optional. When non-nil, new conversations created by
	// this handler are auto-attached to the user's live session (if any).
	Sessions domain.SessionRepo

	Log *slog.Logger
	Now func() time.Time

	Options streamOptions
}

// AnalyzeInput is the validated use-case payload.
type AnalyzeInput struct {
	UserID         uuid.UUID
	ConversationID uuid.UUID // optional — zero means "new"
	PromptText     string
	Model          string
	Attachments    []domain.AttachmentInput
	// Client is an opaque telemetry record; not used for routing in MVP.
	Client domain.ClientContext
}

// Do kicks off the streaming pipeline. The returned channel is owned by the
// use case and closed when the stream terminates.
func (uc *Analyze) Do(ctx context.Context, in AnalyzeInput) (<-chan StreamFrame, error) {
	if strings.TrimSpace(in.PromptText) == "" && !anyScreenshot(in.Attachments) {
		return nil, fmt.Errorf("copilot.Analyze: %w: empty prompt and no screenshot", domain.ErrInvalidInput)
	}

	cfg, err := uc.Config.Load(ctx)
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: load config: %w", err)
	}
	model := in.Model
	if model == "" {
		model = cfg.DefaultModelID
	}

	// Quota check (and lazy window rotation).
	quota, err := uc.Quotas.GetOrInit(ctx, in.UserID)
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: quota: %w", err)
	}
	if rotated, changed := quota.RotateIfDue(uc.now()); changed {
		if rerr := uc.Quotas.ResetWindow(ctx, in.UserID); rerr != nil {
			return nil, fmt.Errorf("copilot.Analyze: reset quota: %w", rerr)
		}
		quota = rotated
	}
	if !quota.HasBudget() {
		return nil, fmt.Errorf("copilot.Analyze: %w", domain.ErrQuotaExceeded)
	}
	if len(quota.ModelsAllowed) > 0 && !quota.IsModelAllowed(model) {
		return nil, fmt.Errorf("copilot.Analyze: %w: %s", domain.ErrModelNotAllowed, model)
	}

	// Resolve the conversation (new or existing).
	var conv domain.Conversation
	if in.ConversationID == uuid.Nil {
		conv, err = uc.Conversations.Create(ctx, in.UserID, deriveTitle(in.PromptText), model)
		if err != nil {
			return nil, fmt.Errorf("copilot.Analyze: create conversation: %w", err)
		}
		// Auto-attach to the user's live session if one exists. This is
		// best-effort: a failure here does NOT roll back the
		// conversation create — the turn still succeeds, the session
		// just misses one conversation.
		if uc.Sessions != nil {
			if live, lerr := uc.Sessions.GetLive(ctx, in.UserID); lerr == nil {
				if aerr := uc.Sessions.AttachConversation(ctx, conv.ID, live.ID); aerr != nil && uc.Log != nil {
					uc.Log.Warn("copilot.Analyze: attach to live session failed",
						"err", aerr, "conv", conv.ID, "session", live.ID)
				}
			}
		}
	} else {
		conv, err = uc.Conversations.Get(ctx, in.ConversationID)
		if err != nil {
			return nil, fmt.Errorf("copilot.Analyze: get conversation: %w", err)
		}
		if conv.UserID != in.UserID {
			return nil, fmt.Errorf("copilot.Analyze: %w", domain.ErrNotFound)
		}
	}

	// Record the user turn.
	userMsg, err := uc.Messages.Insert(ctx, domain.Message{
		ConversationID: conv.ID,
		Role:           enums.MessageRoleUser,
		Content:        in.PromptText,
		HasScreenshot:  anyScreenshot(in.Attachments),
	})
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: insert user msg: %w", err)
	}

	// Record a placeholder assistant turn so we have an id to return
	// immediately. The final content/tokens are committed via UpdateAssistant
	// after the stream completes.
	assistantMsg, err := uc.Messages.Insert(ctx, domain.Message{
		ConversationID: conv.ID,
		Role:           enums.MessageRoleAssistant,
		Content:        "",
	})
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: insert assistant placeholder: %w", err)
	}

	// Build the prior-message context for multi-turn follow-ups.
	prior, err := uc.priorMessages(ctx, conv.ID, userMsg.ID, assistantMsg.ID)
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: prior: %w", err)
	}

	llmMessages := buildLLMMessages(prior, in.PromptText, in.Attachments)

	// Open the LLM stream.
	events, err := uc.LLM.Stream(ctx, domain.CompletionRequest{
		Model:       model,
		Messages:    llmMessages,
		Temperature: uc.Options.Temperature,
		MaxTokens:   uc.Options.MaxTokens,
	})
	if err != nil {
		return nil, fmt.Errorf("copilot.Analyze: open stream: %w", err)
	}

	out := make(chan StreamFrame, 16)
	started := uc.now()

	go uc.pump(ctx, pumpCtx{
		conv:        conv,
		userMsgID:   userMsg.ID,
		assistantID: assistantMsg.ID,
		model:       model,
		events:      events,
		out:         out,
		started:     started,
		userID:      in.UserID,
		isFirstTurn: in.ConversationID == uuid.Nil,
	})
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// pump — shared with Chat
// ─────────────────────────────────────────────────────────────────────────

type pumpCtx struct {
	conv        domain.Conversation
	userMsgID   uuid.UUID
	assistantID uuid.UUID
	model       string
	events      <-chan domain.StreamEvent
	out         chan StreamFrame
	started     time.Time
	userID      uuid.UUID
	isFirstTurn bool
}

// pump bridges the provider's StreamEvent channel into the use-case's
// StreamFrame channel, commits the final message, increments the quota,
// and closes the output.
func (uc *Analyze) pump(ctx context.Context, p pumpCtx) {
	defer close(p.out)

	// Emit the Created frame first so clients can render "working..." with
	// the right ids even before the first token arrives.
	p.out <- StreamFrame{Created: &ConversationCreatedFrame{
		ConversationID:     p.conv.ID,
		UserMessageID:      p.userMsgID,
		AssistantMessageID: p.assistantID,
		Model:              p.model,
	}}

	var assembled strings.Builder
	var tokensIn, tokensOut int
	var modelEcho string

	for ev := range p.events {
		if ev.Err != nil {
			// Treat provider errors as terminal but still commit whatever
			// we accumulated so history doesn't show a phantom empty turn.
			uc.commitAssistant(ctx, p, assembled.String(), tokensIn, tokensOut)
			p.out <- StreamFrame{Err: ev.Err}
			return
		}
		if ev.Done != nil {
			tokensIn = ev.Done.TokensIn
			tokensOut = ev.Done.TokensOut
			if ev.Done.Model != "" {
				modelEcho = ev.Done.Model
			}
			break
		}
		if ev.Delta != "" {
			assembled.WriteString(ev.Delta)
			p.out <- StreamFrame{Delta: ev.Delta}
		}
	}

	latency := int(uc.now().Sub(p.started) / time.Millisecond)
	content := assembled.String()

	// Commit assistant message; log and continue on failure — we still want
	// to emit Done to the client so the UI doesn't hang.
	uc.commitAssistantFull(ctx, p.assistantID, content, tokensIn, tokensOut, latency)

	// Bookkeeping: increment quota, touch the conversation.
	if err := uc.Quotas.IncrementUsage(ctx, p.userID); err != nil && uc.Log != nil {
		uc.Log.Warn("copilot.Analyze: quota increment failed", "err", err, "user", p.userID)
	}
	if err := uc.Conversations.Touch(ctx, p.conv.ID); err != nil && uc.Log != nil {
		uc.Log.Warn("copilot.Analyze: conversation touch failed", "err", err, "conv", p.conv.ID)
	}

	// Re-read the quota so the Done frame reflects the post-increment state.
	quota, err := uc.Quotas.GetOrInit(ctx, p.userID)
	if err != nil && uc.Log != nil {
		uc.Log.Warn("copilot.Analyze: read quota after commit failed", "err", err)
	}

	_ = modelEcho // reserved for future fallback logging

	p.out <- StreamFrame{Done: &ConversationDoneFrame{
		AssistantMessageID: p.assistantID,
		TokensIn:           tokensIn,
		TokensOut:          tokensOut,
		LatencyMs:          latency,
		Quota:              quota,
	}}
}

// commitAssistant is the minimal-info variant used on error paths.
func (uc *Analyze) commitAssistant(ctx context.Context, p pumpCtx, content string, tokensIn, tokensOut int) {
	latency := int(uc.now().Sub(p.started) / time.Millisecond)
	uc.commitAssistantFull(ctx, p.assistantID, content, tokensIn, tokensOut, latency)
}

func (uc *Analyze) commitAssistantFull(ctx context.Context, id uuid.UUID, content string, tokensIn, tokensOut, latencyMs int) {
	if err := uc.Messages.UpdateAssistant(ctx, id, content, tokensIn, tokensOut, latencyMs); err != nil && uc.Log != nil {
		uc.Log.Warn("copilot.Analyze: update assistant failed", "err", err, "id", id)
	}
}

func (uc *Analyze) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

// priorMessages loads all messages from a conversation EXCEPT the pair we
// just inserted for this turn (the current user prompt and its placeholder
// assistant reply). For a brand-new conversation this returns an empty slice.
func (uc *Analyze) priorMessages(ctx context.Context, conversationID, currentUserID, currentAssistantID uuid.UUID) ([]domain.Message, error) {
	all, err := uc.Messages.List(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("copilot.loadConversationHistory: %w", err)
	}
	out := make([]domain.Message, 0, len(all))
	for _, m := range all {
		if m.ID == currentUserID || m.ID == currentAssistantID {
			continue
		}
		// Skip empty placeholder assistant messages from prior incomplete turns.
		if m.Role == enums.MessageRoleAssistant && m.Content == "" {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

// buildLLMMessages packs the system prompt + prior turns + current user
// turn (with images) into the provider-agnostic shape.
func buildLLMMessages(prior []domain.Message, currentText string, attachments []domain.AttachmentInput) []domain.LLMMessage {
	out := make([]domain.LLMMessage, 0, len(prior)+2)
	out = append(out, domain.LLMMessage{Role: enums.MessageRoleSystem, Content: systemPrompt})
	for _, m := range prior {
		out = append(out, domain.LLMMessage{Role: m.Role, Content: m.Content})
	}
	out = append(out, domain.LLMMessage{
		Role:    enums.MessageRoleUser,
		Content: currentText,
		Images:  toLLMImages(attachments),
	})
	return out
}
