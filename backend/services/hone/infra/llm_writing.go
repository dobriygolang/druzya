// Package infra — writing feedback grader (Wave 4.4).
//
// JSON-mode call that returns overall_score + per-issue list. See llm.go
// for shared helpers and the NoLLMWritingGrader floor type.
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

// LLMChainWritingGrader uses llmchain Task=HoneWritingFeedback. Strict
// JSON envelope is enforced server-side; malformed responses retry once
// and then surface as a typed error.
type LLMChainWritingGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainWritingGrader wires the adapter. Same nil-policy as the
// other LLM adapters.
func NewLLMChainWritingGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainWritingGrader {
	if chain == nil {
		panic("hone.NewLLMChainWritingGrader: chain is required (use NoLLMWritingGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainWritingGrader: logger is required (anti-fallback policy)")
	}
	return &LLMChainWritingGrader{chain: chain, log: log, timeout: 18 * time.Second}
}

// writingFeedbackPrompt — locks the JSON shape and the rubric.
const writingFeedbackPrompt = `You are an English writing tutor. The user is a non-native speaker working on their fluency.

You receive their TEXT (and optionally a TITLE describing what the piece is about).

Return a flat list of CONCRETE issues — every entry must:
  - excerpt:     verbatim slice of TEXT the issue applies to (max ~80 chars; keep it tight)
  - category:    one of "grammar", "vocab", "style", "clarity"
  - suggestion:  the proposed fix as a complete drop-in replacement
  - explanation: ONE short sentence explaining why (≤ 18 words)

Rules:
  - Skip subjective rewrites — only flag things that are wrong or notably off.
  - DO NOT invent or paraphrase the excerpt. Copy verbatim.
  - If a sentence has multiple unrelated issues, emit multiple entries.
  - Stop at ~10 issues even if more exist; pick the most impactful ones.
  - If the text is already strong, return an empty issues array.

Also produce overall_score (0..100): 80+ for strong, 50-79 for OK, <50 for needs work.

Output ONLY this JSON (no prose, no markdown fences):
{"overall_score": <int>, "issues": [{"excerpt":"...", "category":"...", "suggestion":"...", "explanation":"..."}, ...]}`

// writingFeedbackEnvelope — wire shape from the model.
type writingFeedbackEnvelope struct {
	OverallScore int                       `json:"overall_score"`
	Issues       []writingFeedbackIssueRaw `json:"issues"`
}

type writingFeedbackIssueRaw struct {
	Excerpt     string `json:"excerpt"`
	Category    string `json:"category"`
	Suggestion  string `json:"suggestion"`
	Explanation string `json:"explanation"`
}

// GradeWriting calls the chain, parses, sanitises. Caps text at 12 KB
// — that's ~2000 words, more than any reasonable «short essay» Hone
// targets. Past that the latency budget breaks anyway.
func (g *LLMChainWritingGrader) GradeWriting(ctx context.Context, in domain.GradeWritingInput) (domain.WritingFeedback, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return domain.WritingFeedback{}, fmt.Errorf("hone.LLMChainWritingGrader.GradeWriting: empty text")
	}
	if len(text) > 12_000 {
		text = text[:12_000] + "\n…[truncated]"
	}
	var user string
	if title := strings.TrimSpace(in.Title); title != "" {
		user = "TITLE: " + title + "\n\nTEXT:\n" + text
	} else {
		user = "TEXT:\n" + text
	}

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneWritingFeedback,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   1100,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: writingFeedbackPrompt},
				{Role: llmchain.RoleUser, Content: user},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainWritingGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env writingFeedbackEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainWritingGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 240)))
			continue
		}
		return sanitiseWritingFeedback(env), nil
	}
	return domain.WritingFeedback{}, fmt.Errorf("hone.LLMChainWritingGrader.GradeWriting: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// sanitiseWritingFeedback clamps the score, drops obviously-broken
// entries (empty excerpt or empty suggestion), and coerces unknown
// categories to "style". Soft-fail philosophy — we'd rather show 7
// good issues than refuse the whole batch over one malformed entry.
func sanitiseWritingFeedback(env writingFeedbackEnvelope) domain.WritingFeedback {
	out := domain.WritingFeedback{OverallScore: clampScore(env.OverallScore)}
	for _, raw := range env.Issues {
		excerpt := strings.TrimSpace(raw.Excerpt)
		suggestion := strings.TrimSpace(raw.Suggestion)
		if excerpt == "" || suggestion == "" {
			continue
		}
		cat := domain.WritingIssueCategory(strings.ToLower(strings.TrimSpace(raw.Category)))
		if !cat.IsValid() {
			cat = domain.WritingIssueStyle
		}
		out.Issues = append(out.Issues, domain.WritingIssue{
			Excerpt:     excerpt,
			Category:    cat,
			Suggestion:  suggestion,
			Explanation: strings.TrimSpace(raw.Explanation),
		})
		// Defensive cap — even if the model ignored the prompt's «~10 max».
		if len(out.Issues) >= 20 {
			break
		}
	}
	return out
}
