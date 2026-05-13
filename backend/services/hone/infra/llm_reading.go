// Package infra — reading summary grader (Wave 4.3).
//
// Single JSON-mode call that scores a user's reading summary 0..100.
// See llm.go for shared helpers and the NoLLMSummaryGrader floor type.
package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmchain"
)

// LLMChainSummaryGrader uses llmchain Task=HoneSummaryGrade. Single
// JSON-mode call; we read out the score, ignore the feedback (UI shows
// just the number for MVP, feedback can be surfaced later).
type LLMChainSummaryGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainSummaryGrader wires the adapter. Same nil-policy as the
// other LLM adapters: chain MUST be non-nil; the wirer falls back to
// NoLLMSummaryGrader at boot when no providers are configured.
func NewLLMChainSummaryGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainSummaryGrader {
	if chain == nil {
		panic("hone.NewLLMChainSummaryGrader: chain is required (use NoLLMSummaryGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainSummaryGrader: logger is required (anti-fallback policy)")
	}
	return &LLMChainSummaryGrader{chain: chain, log: log, timeout: 12 * time.Second}
}

// summaryGradePrompt — ground rules for the model. Compact: tell it
// what we're scoring on, lock the JSON shape, refuse fabrication.
const summaryGradePrompt = `You are a strict but fair reading-comprehension grader.

Inputs:
- TITLE: chapter / article title.
- BODY: the full chapter / article text the user just read.
- SUMMARY: what the user wrote about it.

Score the summary 0..100 on three axes (weight equally):
  1. Coverage — does it mention the key claims, characters, or arguments of BODY?
  2. Accuracy — does every statement actually hold up against BODY?
  3. Non-fabrication — penalize hard for content the user invented (-30+ if egregious).

A vague but accurate summary scores ~50–60.
A detailed and accurate summary scores 80–95.
An empty or off-topic summary scores 0–20.
A summary that contains fabrications loses points proportional to severity.

Return ONLY this JSON (no prose around it):
{"score": <integer 0..100>, "feedback": "<one short sentence>"}`

// gradeJSONEnvelope — wire shape returned by the model.
type gradeJSONEnvelope struct {
	Score    int    `json:"score"`
	Feedback string `json:"feedback"`
}

// GradeSummary calls the chain. Truncates BODY to ~16 KB so a giant
// chapter doesn't blow the model's context window — the first chunk is
// usually enough for grading the user's high-level summary; if a future
// version wants per-section grading we'll chunk + map-reduce.
func (g *LLMChainSummaryGrader) GradeSummary(ctx context.Context, in domain.GradeSummaryInput) (int, error) {
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > 16_000 {
		body = body[:16_000] + "\n…[truncated]"
	}
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		return 0, fmt.Errorf("hone.LLMChainSummaryGrader.GradeSummary: empty summary")
	}
	user := fmt.Sprintf("TITLE: %s\n\nBODY:\n%s\n\nSUMMARY:\n%s", in.Title, body, summary)

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneSummaryGrade,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   180,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: summaryGradePrompt},
				{Role: llmchain.RoleUser, Content: user},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSummaryGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env gradeJSONEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSummaryGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		if env.Score < 0 {
			env.Score = 0
		}
		if env.Score > 100 {
			env.Score = 100
		}
		return env.Score, nil
	}
	return 0, fmt.Errorf("hone.LLMChainSummaryGrader.GradeSummary: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}
