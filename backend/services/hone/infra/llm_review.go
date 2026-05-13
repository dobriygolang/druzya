// Package infra — code review grader.
//
// Grades a user's review of a diff. JSON-mode call with correctness /
// completeness / clarity / tone rubric. See llm.go for shared helpers
// and the NoLLMCodeReviewGrader floor type.
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

// LLMChainCodeReviewGrader uses llmchain Task=HoneCodeReviewGrade.
// 70B-class providers (see task_map.go) — comparing a review to a diff
// is a reasoning task, not pattern matching.
type LLMChainCodeReviewGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainCodeReviewGrader wires the adapter. Same nil-policy as the
// other LLM adapters.
func NewLLMChainCodeReviewGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainCodeReviewGrader {
	if chain == nil {
		panic("hone.NewLLMChainCodeReviewGrader: chain is required (use NoLLMCodeReviewGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainCodeReviewGrader: logger is required (anti-fallback policy)")
	}
	// Larger time budget than writing feedback — reasoning over a diff
	// is slower than spotting grammar mistakes.
	return &LLMChainCodeReviewGrader{chain: chain, log: log, timeout: 28 * time.Second}
}

// codeReviewPrompt — locks the JSON shape and the rubric. Note the
// asymmetry vs writing-feedback: completeness issues won't have an
// excerpt (the reviewer didn't write anything for that gap).
const codeReviewPrompt = `You are a senior engineer mentoring a junior reviewer. They've written a code review for a diff; grade their review.

Inputs you receive:
  - PR_TITLE  (optional) — what the PR claims to do.
  - DIFF      — the unified diff being reviewed.
  - REVIEW    — the user's review write-up.

Score the REVIEW 0..100 across:
  1. Correctness — every technical claim must hold up against DIFF. Subtract heavily for confidently-wrong statements.
  2. Completeness — did they catch the obvious bugs / missing tests / unsafe ops in DIFF?
  3. Clarity — comments must be specific (line refs / function names) rather than hand-wavy.
  4. Tone — comments must be respectful and constructive. No patronising / blame language.

Then emit a flat list of issues — every entry MUST have:
  - excerpt:     verbatim slice of REVIEW the issue applies to (max ~120 chars). EMPTY string allowed only when category == "completeness" (the reviewer didn't write anything for that gap).
  - category:    one of "correctness", "completeness", "clarity", "tone".
  - suggestion:  the proposed fix as a complete drop-in replacement (or, for completeness, the comment they SHOULD have written).
  - explanation: ONE short sentence explaining why (≤ 22 words).

Rules:
  - DO NOT invent or paraphrase the excerpt. Copy verbatim from REVIEW.
  - Stop at ~10 issues even if more exist; pick the most impactful ones.
  - If the review is genuinely solid, return an empty issues array.

Output ONLY this JSON (no prose, no markdown fences):
{"overall_score": <int>, "issues": [{"excerpt":"...", "category":"...", "suggestion":"...", "explanation":"..."}, ...]}`

type codeReviewEnvelope struct {
	OverallScore int                  `json:"overall_score"`
	Issues       []codeReviewIssueRaw `json:"issues"`
}

type codeReviewIssueRaw struct {
	Excerpt     string `json:"excerpt"`
	Category    string `json:"category"`
	Suggestion  string `json:"suggestion"`
	Explanation string `json:"explanation"`
}

// GradeReview calls the chain. Caps DIFF at 24 KB and REVIEW at 8 KB —
// past those points the grading-quality benefit diminishes and the
// latency budget bites.
func (g *LLMChainCodeReviewGrader) GradeReview(ctx context.Context, in domain.GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	diff := strings.TrimSpace(in.DiffMD)
	if diff == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: empty diff")
	}
	review := strings.TrimSpace(in.ReviewMD)
	if review == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: empty review")
	}
	if len(diff) > 24_000 {
		diff = diff[:24_000] + "\n…[truncated]"
	}
	if len(review) > 8_000 {
		review = review[:8_000] + "\n…[truncated]"
	}
	var sb strings.Builder
	if title := strings.TrimSpace(in.PRTitle); title != "" {
		fmt.Fprintf(&sb, "PR_TITLE: %s\n\n", title)
	}
	fmt.Fprintf(&sb, "DIFF:\n%s\n\nREVIEW:\n%s", diff, review)

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneCodeReviewGrade,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   1500,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: codeReviewPrompt},
				{Role: llmchain.RoleUser, Content: sb.String()},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainCodeReviewGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env codeReviewEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainCodeReviewGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 240)))
			continue
		}
		return sanitiseCodeReviewFeedback(env), nil
	}
	return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// sanitiseCodeReviewFeedback clamps the score, drops bad entries, and
// coerces unknown categories. Same soft-fail philosophy as the writing
// sanitiser — keep the good issues, throw away the malformed ones.
func sanitiseCodeReviewFeedback(env codeReviewEnvelope) domain.CodeReviewFeedback {
	out := domain.CodeReviewFeedback{OverallScore: clampScore(env.OverallScore)}
	for _, raw := range env.Issues {
		excerpt := strings.TrimSpace(raw.Excerpt)
		suggestion := strings.TrimSpace(raw.Suggestion)
		// Suggestion is required for every category; excerpt is required
		// for everything except completeness (the reviewer didn't write
		// anything to quote).
		if suggestion == "" {
			continue
		}
		cat := domain.CodeReviewIssueCategory(strings.ToLower(strings.TrimSpace(raw.Category)))
		if !cat.IsValid() {
			cat = domain.ReviewIssueClarity
		}
		if excerpt == "" && cat != domain.ReviewIssueCompleteness {
			continue
		}
		out.Issues = append(out.Issues, domain.CodeReviewIssue{
			Excerpt:     excerpt,
			Category:    cat,
			Suggestion:  suggestion,
			Explanation: strings.TrimSpace(raw.Explanation),
		})
		if len(out.Issues) >= 20 {
			break
		}
	}
	return out
}
