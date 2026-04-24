// llm_chain.go — copilot's domain.LLMProvider implemented on top of
// shared/pkg/llmchain.
//
// Why this file exists (rather than just importing llmchain directly in
// the app layer): domain.LLMProvider.Stream has a copilot-specific
// signature (domain.CompletionRequest / domain.StreamEvent). This
// adapter converts types, picks the chain task based on the requested
// model id ("druz9/turbo" → Task=CopilotStream; concrete id →
// ModelOverride), and forwards the stream events 1:1.
//
// Once every caller migrates to this adapter, the old OpenRouter
// streaming client (llm_openrouter.go) becomes internal to the
// llmchain package and can be deleted.
package infra

import (
	"context"
	"fmt"
	"strings"

	"druz9/copilot/domain"
	"druz9/shared/enums"
	"druz9/shared/pkg/llmchain"
)

// ChainedLLM routes copilot streaming calls through llmchain.Chain.
// The TurboID sentinel is the virtual model id: when CompletionRequest
// model equals it (or is empty), we route via Task=CopilotStream so the
// chain picks the best provider. Any other id goes via ModelOverride,
// giving the user's chosen model direct dispatch without fallback (if
// the user pinned a specific id, they don't want "silently swap").
type ChainedLLM struct {
	Chain   *llmchain.Chain
	TurboID string // default "druz9/turbo"
}

// TurboModelID is the canonical virtual model id. Kept as a package
// constant (not a field) so callers can test equality without dragging
// the adapter around; migration 00045 seeds the row with this id.
const TurboModelID = "druz9/turbo"

// NewChainedLLM builds the adapter. chain MUST be non-nil — callers
// should check cfg availability before constructing.
func NewChainedLLM(chain *llmchain.Chain) *ChainedLLM {
	if chain == nil {
		panic("copilot.NewChainedLLM: chain is required (anti-fallback policy)")
	}
	return &ChainedLLM{Chain: chain, TurboID: TurboModelID}
}

// Stream implements domain.LLMProvider. Conversion is straightforward:
// copilot's domain.LLMMessage → llmchain.Message, domain.CompletionRequest
// → llmchain.Request. The reverse translation on events happens in a
// goroutine that re-emits domain.StreamEvent frames as they arrive.
func (c *ChainedLLM) Stream(ctx context.Context, req domain.CompletionRequest) (<-chan domain.StreamEvent, error) {
	msgs := make([]llmchain.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		var images []llmchain.Image
		for _, img := range m.Images {
			images = append(images, llmchain.Image{MimeType: img.MimeType, Data: img.Data})
		}
		msgs = append(msgs, llmchain.Message{
			Role:    roleFromDomain(m.Role),
			Content: m.Content,
			Images:  images,
		})
	}

	lreq := llmchain.Request{
		Messages:    msgs,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	}
	// Turbo / empty-model → let chain pick. Concrete model → pin it so
	// the user's deliberate choice isn't silently overridden on fallback.
	if req.Model == "" || req.Model == c.TurboID {
		lreq.Task = llmchain.TaskCopilotStream
	} else {
		lreq.ModelOverride = req.Model
	}

	src, err := c.Chain.ChatStream(ctx, lreq)
	if err != nil {
		return nil, fmt.Errorf("copilot.ChainedLLM.Stream: %w", err)
	}

	out := make(chan domain.StreamEvent, 16)
	go func() {
		defer close(out)
		for ev := range src {
			switch {
			case ev.Err != nil:
				out <- domain.StreamEvent{Err: ev.Err}
			case ev.Done != nil:
				out <- domain.StreamEvent{Done: &domain.CompletionDone{
					TokensIn:  ev.Done.TokensIn,
					TokensOut: ev.Done.TokensOut,
					// Model echo carries the actual provider-qualified id so
					// callers can log "served by groq/llama-3.3-70b" even
					// when the request came in as "druz9/turbo".
					Model: prefixProvider(ev.Done.Provider, ev.Done.Model),
				}}
			default:
				out <- domain.StreamEvent{Delta: ev.Delta}
			}
		}
	}()
	return out, nil
}

func roleFromDomain(r enums.MessageRole) llmchain.Role {
	switch r {
	case enums.MessageRoleSystem:
		return llmchain.RoleSystem
	case enums.MessageRoleAssistant:
		return llmchain.RoleAssistant
	case enums.MessageRoleUser:
		return llmchain.RoleUser
	default:
		return llmchain.RoleUser
	}
}

// prefixProvider attaches the actual-serving-provider prefix to the
// model id if the driver echoed back a bare name (e.g. "llama-3.3-70b-
// versatile" from Groq → "groq/llama-3.3-70b-versatile"). OpenRouter
// ids are already fully qualified, don't double-prefix.
func prefixProvider(p llmchain.Provider, m string) string {
	if m == "" {
		return ""
	}
	if strings.Contains(m, "/") {
		return m
	}
	return string(p) + "/" + m
}

// Interface guard.
var _ domain.LLMProvider = (*ChainedLLM)(nil)
