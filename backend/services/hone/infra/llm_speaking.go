// Package infra — speaking pronunciation grader.
//
// Compares Whisper transcript against the reference prompt and returns
// pronunciation + fluency scores plus per-token diff. See llm.go for
// shared helpers and the NoLLMSpeakingGrader floor type.
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

// LLMChainSpeakingGrader uses llmchain Task=HoneSpeakingGrade. Strict JSON
// envelope; malformed responses retry once then surface a typed error.
type LLMChainSpeakingGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainSpeakingGrader wires the adapter. Same nil-policy as the
// other LLM adapters.
func NewLLMChainSpeakingGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainSpeakingGrader {
	if chain == nil {
		panic("hone.NewLLMChainSpeakingGrader: chain is required (use NoLLMSpeakingGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainSpeakingGrader: logger is required (anti-fallback policy)")
	}
	return &LLMChainSpeakingGrader{chain: chain, log: log, timeout: 15 * time.Second}
}

// speakingGradePrompt — locks the JSON shape and the rubric. Distinct
// task type so we can route to a smaller/faster model than writing
// feedback (Speaking grading is mostly token alignment + heuristics —
// 8B-class is plenty).
const speakingGradePrompt = `You are an English pronunciation coach. The user is a non-native speaker practicing shadowing exercises.

You receive:
- PROMPT: the reference text the user was supposed to read aloud
- TRANSCRIPT: what the speech-to-text model heard (Whisper)
- LEVEL: CEFR level (B1 / B2 / C1) — adjust strictness accordingly
- DURATION_MS: how long the user spoke; target_ms = word_count(PROMPT) * 380.

Compute:
  - pronunciation_score (0..100): how close TRANSCRIPT is to PROMPT.
    Word-level alignment. Each mismatch / missing / extra word costs ~3-5 pts.
    Empty transcript = 0. Perfect match = 100. Be slightly lenient at B1, strict at C1.
  - fluency_score (0..100): based on timing variance (duration vs target_ms).
    Within ±15% = 100. Each 15% drift drops 20 pts. Floor at 0.
  - coach_feedback: ONE actionable sentence ≤ 140 chars. Focus on the single
    most impactful tip ("Practice 'th' — sounded like 's'" / "Slow down — words
    are running together"). Be specific, never "try harder".
  - word_diffs: array of per-token alignment outcomes. status ∈
    "match" | "miss" | "extra" | "substitute". Cap at 30 items.

Output ONLY this JSON (no prose, no markdown fences):
{"pronunciation_score":<int>,"fluency_score":<int>,"coach_feedback":"...",
 "word_diffs":[{"status":"match","expected":"...","actual":"..."}, ...]}`

type speakingGradeEnvelope struct {
	PronunciationScore int                        `json:"pronunciation_score"`
	FluencyScore       int                        `json:"fluency_score"`
	CoachFeedback      string                     `json:"coach_feedback"`
	WordDiffs          []speakingGradeWordDiffRaw `json:"word_diffs"`
}

type speakingGradeWordDiffRaw struct {
	Status   string `json:"status"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
}

// GradeSpeaking calls the chain, parses, sanitises. Handles the empty-
// transcript edge case server-side (zero scores + coaching nudge) so the
// LLM doesn't have to deal with degenerate inputs that confuse models.
func (g *LLMChainSpeakingGrader) GradeSpeaking(ctx context.Context, in domain.SpeakingGraderInput) (domain.SpeakingFeedback, error) {
	prompt := strings.TrimSpace(in.Prompt)
	if prompt == "" {
		return domain.SpeakingFeedback{}, fmt.Errorf("hone.LLMChainSpeakingGrader.GradeSpeaking: empty prompt")
	}
	transcript := strings.TrimSpace(in.Transcript)
	// Empty transcript = silent recording. Skip LLM call — the floor
	// outcome is deterministic + saves the budget.
	if transcript == "" {
		return domain.SpeakingFeedback{
			PronunciationScore: 0,
			FluencyScore:       0,
			CoachFeedback:      "I did not hear any words — please check your mic and try again.",
			WordDiffs:          nil,
		}, nil
	}

	level := string(in.Level)
	if level == "" {
		level = "B2"
	}
	user := fmt.Sprintf(
		"PROMPT: %s\n\nTRANSCRIPT: %s\n\nLEVEL: %s\n\nDURATION_MS: %d",
		prompt, transcript, level, in.DurationMS,
	)

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneSpeakingGrade,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   900,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: speakingGradePrompt},
				{Role: llmchain.RoleUser, Content: user},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSpeakingGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env speakingGradeEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSpeakingGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 240)))
			continue
		}
		return sanitiseSpeakingFeedback(env), nil
	}
	return domain.SpeakingFeedback{}, fmt.Errorf("hone.LLMChainSpeakingGrader.GradeSpeaking: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// sanitiseSpeakingFeedback clamps scores 0..100, caps coach feedback at
// 140 chars, drops unknown word-diff statuses, caps word_diffs at 30
// entries. Soft-fail philosophy.
func sanitiseSpeakingFeedback(env speakingGradeEnvelope) domain.SpeakingFeedback {
	out := domain.SpeakingFeedback{
		PronunciationScore: clampScore(env.PronunciationScore),
		FluencyScore:       clampScore(env.FluencyScore),
		CoachFeedback:      truncateRunes(strings.TrimSpace(env.CoachFeedback), 140),
	}
	for _, raw := range env.WordDiffs {
		status := domain.WordDiffStatus(strings.ToLower(strings.TrimSpace(raw.Status)))
		if !isValidWordDiffStatus(status) {
			continue
		}
		out.WordDiffs = append(out.WordDiffs, domain.WordDiff{
			Status:   status,
			Expected: strings.TrimSpace(raw.Expected),
			Actual:   strings.TrimSpace(raw.Actual),
		})
		if len(out.WordDiffs) >= 30 {
			break
		}
	}
	return out
}

func isValidWordDiffStatus(s domain.WordDiffStatus) bool {
	switch s {
	case domain.WordDiffMatch, domain.WordDiffMiss, domain.WordDiffExtra, domain.WordDiffSubstitute:
		return true
	}
	return false
}
