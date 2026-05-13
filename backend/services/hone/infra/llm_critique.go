// Package infra — whiteboard architecture critique streamer.
//
// Produces "STRENGTHS / CONCERNS / MISSING / CLOSING" sections from a
// tldraw JSON blob. See llm.go for shared helpers and floor types.
package infra

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmchain"
)

// ─── LLMChainCritiqueStreamer ─────────────────────────────────────────────

// LLMChainCritiqueStreamer produces sectioned architectural critique.
//
// MVP impl: non-streaming Chat call, then split response on section markers
// and emit packets sequentially. True token-level streaming per-section is a
// post-MVP nice-to-have — the UX cost of a 2-3s blocking call before the
// first fade-in is acceptable, and the robustness gain (no partial-marker
// mis-classification) is significant.
//
// Prompt forces a "## STRENGTHS / ## CONCERNS / ## MISSING / ## CLOSING"
// format. Parser walks the response line-by-line and attributes each to the
// currently-active section.
type LLMChainCritiqueStreamer struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainCritiqueStreamer wires the adapter.
func NewLLMChainCritiqueStreamer(chain llmchain.ChatClient, log *slog.Logger) *LLMChainCritiqueStreamer {
	if chain == nil {
		panic("hone.NewLLMChainCritiqueStreamer: chain is required")
	}
	if log == nil {
		panic("hone.NewLLMChainCritiqueStreamer: logger is required")
	}
	return &LLMChainCritiqueStreamer{chain: chain, log: log, timeout: 45 * time.Second}
}

const critiquePromptTemplate = `You are a senior system-design interviewer reviewing an architecture diagram.

The user's whiteboard is provided as a tldraw JSON blob below. Infer the architecture from the shapes (rectangles = services, circles = datastores, arrows = flows, text = labels / API paths / replica counts).

Produce a focused critique in EXACTLY four sections, using these headers verbatim:

## STRENGTHS
2-3 short bullet points on what is well-designed.

## CONCERNS
2-3 short bullet points on actual problems with the current design.

## MISSING
2-3 short bullet points on what the design omits (caching, retries, queues, monitoring, etc).

## CLOSING
One paragraph: the single most important thing to fix first, and why.

Be specific. Reference shapes by label ("the api → postgres edge…"). No hedging, no pleasantries. Start the first line with "## STRENGTHS".

Whiteboard JSON:
%s`

// Critique fetches the critique and streams it section-by-section.
func (s *LLMChainCritiqueStreamer) Critique(ctx context.Context, stateJSON []byte, yield func(domain.CritiquePacket) error) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	prompt := fmt.Sprintf(critiquePromptTemplate, string(stateJSON))

	resp, err := s.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskSysDesignCritique,
		Temperature: 0.4,
		MaxTokens:   1200,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return fmt.Errorf("hone.LLMChainCritiqueStreamer.Critique: chain: %w (%w)", err, domain.ErrLLMUnavailable)
	}

	sections := splitCritiqueBySections(resp.Content)
	if len(sections) == 0 {
		// Model ignored the section format — emit everything under "closing"
		// so the UI still shows something useful. Better than a 503 when the
		// response is actually present, just non-conforming.
		s.log.Warn("hone.LLMChainCritiqueStreamer: no sections detected, falling back to closing-only",
			slog.String("preview", firstN(resp.Content, 200)))
		return emitSingleSection(yield, domain.CritiqueClosing, strings.TrimSpace(resp.Content))
	}
	return emitSections(yield, sections)
}

// sectionBlock is one parsed section.
type sectionBlock struct {
	Section domain.CritiqueSection
	Body    string
}

// splitCritiqueBySections walks the response top-to-bottom, switching section
// on "## <KEYWORD>" lines. Unknown keywords are collapsed into the current
// section (conservative — we never drop content).
func splitCritiqueBySections(s string) []sectionBlock {
	lines := strings.Split(s, "\n")
	var out []sectionBlock
	var current domain.CritiqueSection
	var buf strings.Builder

	flush := func() {
		body := strings.TrimSpace(buf.String())
		if current == "" || body == "" {
			buf.Reset()
			return
		}
		out = append(out, sectionBlock{Section: current, Body: body})
		buf.Reset()
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			keyword := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(trimmed, "## ")))
			var next domain.CritiqueSection
			switch {
			case strings.HasPrefix(keyword, "strength"):
				next = domain.CritiqueStrengths
			case strings.HasPrefix(keyword, "concern"):
				next = domain.CritiqueConcerns
			case strings.HasPrefix(keyword, "missing"):
				next = domain.CritiqueMissing
			case strings.HasPrefix(keyword, "closing"):
				next = domain.CritiqueClosing
			}
			if next != "" {
				flush()
				current = next
				continue
			}
		}
		buf.WriteString(line)
		buf.WriteString("\n")
	}
	flush()
	return out
}

// emitSections walks the parsed sections and yields one CritiquePacket per
// section, flagging Done=true on the final packet. Callers typically render
// each packet as a fade-in paragraph.
func emitSections(yield func(domain.CritiquePacket) error, blocks []sectionBlock) error {
	for i, b := range blocks {
		if err := yield(domain.CritiquePacket{
			Section: b.Section,
			Delta:   b.Body,
			Done:    i == len(blocks)-1,
		}); err != nil {
			return err
		}
	}
	return nil
}

func emitSingleSection(yield func(domain.CritiquePacket) error, section domain.CritiqueSection, body string) error {
	return yield(domain.CritiquePacket{
		Section: section,
		Delta:   body,
		Done:    true,
	})
}
