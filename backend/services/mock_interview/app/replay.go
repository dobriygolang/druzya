// Package app — replay.go: "разбор пробного собеса" use case. Two paths:
//
//   1. GetMockReplay(attempt_id) — read-only; serves cached row.
//   2. GenerateMockReplay(attempt_id) — fires the free LLM cascade, parses
//      structured JSON (ideal_answer_md + 3-5 diff annotations), caches in
//      pipeline_attempts via ReplayRepo.SetReplay, returns the fresh blob.
//
// The orchestrator's grading remains the source of truth for score /
// verdict; this is a separate, additive "how could you have done better"
// view. Anti-fallback: on LLM failure we return ErrReplayUnavailable
// rather than persisting a placeholder — caller can show "Try again"
// without corrupting future cache hits.
//
// Prompt design rationale:
//   - Russian-language LLM (matches Sergey audience).
//   - Single JSON object output enforced by JSONMode = true.
//   - 200-400 word ideal answer ceiling — long enough to teach, short
//     enough to read on debrief.
//   - 3-5 annotations cap — more becomes noise.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// ErrReplayUnavailable — surfaced когда LLM-cascade полностью отказал
// (Chain == nil OR every provider returned an error / unparseable JSON).
// The use case maps this to a frontend-visible "Generation unavailable,
// please retry" — we do NOT cache an empty replay row, so the next call
// retries cleanly.
var ErrReplayUnavailable = fmt.Errorf("mock_interview: replay generation unavailable")

// MockReplayDeps — wired in monolith/services/mock_interview.go.
type MockReplayDeps struct {
	Attempts domain.PipelineAttemptRepo // GetWithQuestion + Get
	Replays  domain.ReplayRepo          // GetReplay + SetReplay
	Chain    llmchain.ChatClient        // free LLM cascade; nil → ErrReplayUnavailable
	Log      *slog.Logger
	Now      func() time.Time
}

// MockReplay — use-case bundle.
type MockReplay struct {
	D MockReplayDeps
}

// MockReplayOutput — wire-shape returned to ports / frontend.
type MockReplayOutput struct {
	AttemptID     uuid.UUID                 `json:"attempt_id"`
	IdealAnswerMD string                    `json:"ideal_answer_md"`
	Annotations   []domain.ReplayAnnotation `json:"annotations"`
	GeneratedAt   time.Time                 `json:"generated_at"`
	// Question / your answer are echoed back so the frontend can render
	// the split-screen without an extra round-trip to GetAttempt.
	QuestionBody string `json:"question_body"`
	YourAnswerMD string `json:"your_answer_md"`
}

// Get returns the cached replay if present, else ErrReplayNotReady. The
// frontend calls Generate when the cache is cold.
func (uc *MockReplay) Get(ctx context.Context, attemptID uuid.UUID) (MockReplayOutput, error) {
	awq, err := uc.D.Attempts.GetWithQuestion(ctx, attemptID)
	if err != nil {
		return MockReplayOutput{}, fmt.Errorf("attempts.GetWithQuestion: %w", err)
	}
	rep, rerr := uc.D.Replays.GetReplay(ctx, attemptID)
	if rerr != nil {
		return MockReplayOutput{}, rerr
	}
	return MockReplayOutput{
		AttemptID:     rep.AttemptID,
		IdealAnswerMD: rep.IdealAnswerMD,
		Annotations:   rep.Annotations,
		GeneratedAt:   rep.GeneratedAt,
		QuestionBody:  awq.QuestionBody,
		YourAnswerMD:  awq.Attempt.UserAnswerMD,
	}, nil
}

// Generate (re)builds the replay via LLM and persists it. Idempotent —
// callers may invoke repeatedly; new content overwrites the cache.
func (uc *MockReplay) Generate(ctx context.Context, attemptID uuid.UUID) (MockReplayOutput, error) {
	awq, err := uc.D.Attempts.GetWithQuestion(ctx, attemptID)
	if err != nil {
		return MockReplayOutput{}, fmt.Errorf("attempts.GetWithQuestion: %w", err)
	}
	if uc.D.Chain == nil {
		if uc.D.Log != nil {
			uc.D.Log.WarnContext(ctx, "mock_interview.replay: chain=nil")
		}
		return MockReplayOutput{}, ErrReplayUnavailable
	}

	// Compose the prompt. We feed the LLM:
	//   * The interviewer question.
	//   * The (optional) reference answer to anchor the "ideal".
	//   * The user's actual answer.
	//   * Any aggregated AI feedback / missing-points the original
	//     judge produced — gives the replay grader continuity.
	user := buildReplayUserMsg(replayPromptInput{
		Question:          awq.QuestionBody,
		ReferenceAnswerMD: awq.ExpectedAnswerMD,
		MustMention:       awq.ReferenceCriteria.MustMention,
		CommonPitfalls:    awq.ReferenceCriteria.CommonPitfalls,
		YourAnswerMD:      awq.Attempt.UserAnswerMD,
		AIFeedbackMD:      awq.Attempt.AIFeedbackMD,
		AIMissingPoints:   awq.Attempt.AIMissingPoints,
	})

	resp, cerr := uc.D.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.3,
		MaxTokens:   1200,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: replaySystemPrompt},
			{Role: llmchain.RoleUser, Content: user},
		},
	})
	if cerr != nil {
		if uc.D.Log != nil {
			uc.D.Log.ErrorContext(ctx, "mock_interview.replay: chain.Chat", slog.Any("err", cerr))
		}
		return MockReplayOutput{}, ErrReplayUnavailable
	}

	parsed, perr := parseReplayJSON(resp.Content)
	if perr != nil {
		if uc.D.Log != nil {
			uc.D.Log.ErrorContext(ctx, "mock_interview.replay: parse",
				slog.Any("err", perr), slog.String("attempt_id", attemptID.String()))
		}
		return MockReplayOutput{}, ErrReplayUnavailable
	}

	// Persist. We stamp time before the SetReplay so the in-memory
	// output and the DB row agree.
	now := uc.now()
	if err := uc.D.Replays.SetReplay(ctx, attemptID, parsed.IdealAnswerMD, parsed.Annotations, now); err != nil {
		if uc.D.Log != nil {
			uc.D.Log.ErrorContext(ctx, "mock_interview.replay: persist",
				slog.Any("err", err), slog.String("attempt_id", attemptID.String()))
		}
		// Return the parsed payload anyway — frontend gets a useful
		// response, retry on next view re-persists. Better UX than
		// failing closed.
	}

	return MockReplayOutput{
		AttemptID:     attemptID,
		IdealAnswerMD: parsed.IdealAnswerMD,
		Annotations:   parsed.Annotations,
		GeneratedAt:   now,
		QuestionBody:  awq.QuestionBody,
		YourAnswerMD:  awq.Attempt.UserAnswerMD,
	}, nil
}

func (uc *MockReplay) now() time.Time {
	if uc.D.Now != nil {
		return uc.D.Now()
	}
	return time.Now().UTC()
}

// ─── Prompt ─────────────────────────────────────────────────────────────

// replaySystemPrompt — strict-JSON output, рассчитан на free LLM cascade
// (Groq / Cerebras / Cloudflare / ZAI / Mistral / DeepSeek / Ollama).
// Russian-language inputs / outputs.
const replaySystemPrompt = `Ты — senior tech-интервьюер. Тебе показывают вопрос с пробного собеседования, ответ кандидата и (опционально) reference-ответ. Твоя задача — сгенерировать "разбор": идеальный ответ на 200-400 слов + 3-5 точечных аннотаций где кандидат сбился или, наоборот, попал точно.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев. Все ключи обязательны.

Схема ответа:
{
  "ideal_answer_md": "<200-400 слов markdown ответа, как мог бы ответить sr-кандидат: structured, без воды, конкретные термины. Используй заголовки (## ...) и буллеты где уместно>",
  "annotations": [
    {
      "your_excerpt": "<verbatim фрагмент ответа кандидата ИЛИ пустая строка если он этой темы не коснулся>",
      "ideal_excerpt": "<verbatim фрагмент из ideal_answer_md, который соответствует>",
      "type": "missing" | "incorrect" | "good",
      "comment": "<1-2 short sentences in the user's preferred language: why exactly this / what would be better>"
    }
  ]
}

Правила:
- "missing" — кандидат не упомянул важную мысль вообще (your_excerpt пустой).
- "incorrect" — кандидат сказал, но неверно / частично / нечётко.
- "good" — кандидат попал в точку (минимум 1 такая, если возможно — давай credit).
- Минимум 3 аннотации, максимум 5. Избегай мелких style-issues; целишься в substance.
- Если ответ кандидата пустой / placeholder — ideal_answer_md всё равно генерируется, annotations все "missing".
- ideal_answer_md — конструктивно, без снисходительности. По-русски.
- Не вставляй сам "you didn't say X" в ideal_answer_md — это работа annotations.`

// replayPromptInput — internal compose-helper для user-message.
type replayPromptInput struct {
	Question          string
	ReferenceAnswerMD string
	MustMention       []string
	CommonPitfalls    []string
	YourAnswerMD      string
	AIFeedbackMD      string
	AIMissingPoints   []string
}

func buildReplayUserMsg(in replayPromptInput) string {
	var sb strings.Builder
	sb.WriteString("# Вопрос интервьюера\n\n")
	sb.WriteString(strings.TrimSpace(in.Question))
	sb.WriteString("\n\n")

	if strings.TrimSpace(in.ReferenceAnswerMD) != "" {
		sb.WriteString("# Reference-ответ (опорный, не обязательно дословно)\n\n")
		sb.WriteString(strings.TrimSpace(in.ReferenceAnswerMD))
		sb.WriteString("\n\n")
	}
	if len(in.MustMention) > 0 {
		sb.WriteString("# Обязательно затронуть (must-mention)\n")
		for _, m := range in.MustMention {
			if t := strings.TrimSpace(m); t != "" {
				sb.WriteString("- ")
				sb.WriteString(t)
				sb.WriteString("\n")
			}
		}
		sb.WriteString("\n")
	}
	if len(in.CommonPitfalls) > 0 {
		sb.WriteString("# Типичные ошибки\n")
		for _, p := range in.CommonPitfalls {
			if t := strings.TrimSpace(p); t != "" {
				sb.WriteString("- ")
				sb.WriteString(t)
				sb.WriteString("\n")
			}
		}
		sb.WriteString("\n")
	}

	sb.WriteString("# Ответ кандидата (verbatim)\n\n")
	if a := strings.TrimSpace(in.YourAnswerMD); a == "" {
		sb.WriteString("(пусто)")
	} else {
		sb.WriteString(a)
	}
	sb.WriteString("\n\n")

	if strings.TrimSpace(in.AIFeedbackMD) != "" {
		sb.WriteString("# Предыдущий AI-фидбек (для контекста)\n\n")
		sb.WriteString(strings.TrimSpace(in.AIFeedbackMD))
		sb.WriteString("\n\n")
	}
	if len(in.AIMissingPoints) > 0 {
		sb.WriteString("# Что AI ранее пометил как пропущенное\n")
		for _, p := range in.AIMissingPoints {
			if t := strings.TrimSpace(p); t != "" {
				sb.WriteString("- ")
				sb.WriteString(t)
				sb.WriteString("\n")
			}
		}
		sb.WriteString("\n")
	}

	sb.WriteString("Сгенерируй разбор по схеме.")
	return sb.String()
}

// ─── Parsing ─────────────────────────────────────────────────────────────

type replayJSONShape struct {
	IdealAnswerMD string `json:"ideal_answer_md"`
	Annotations   []struct {
		YourExcerpt  string `json:"your_excerpt"`
		IdealExcerpt string `json:"ideal_excerpt"`
		Type         string `json:"type"`
		Comment      string `json:"comment"`
	} `json:"annotations"`
}

// parseReplayJSON — strict JSON, regex-fallback на stray text.
// Validation:
//   - ideal_answer_md non-empty (trimmed)
//   - annotations: clamp to 5, coerce unknown types to "missing"
//
// Returns the same shape the use case caches.
func parseReplayJSON(raw string) (struct {
	IdealAnswerMD string
	Annotations   []domain.ReplayAnnotation
}, error,
) {
	var result struct {
		IdealAnswerMD string
		Annotations   []domain.ReplayAnnotation
	}

	var p replayJSONShape
	if err := strictOrRegexJSON(raw, &p); err != nil {
		return result, fmt.Errorf("parse replay json: %w", err)
	}
	ideal := strings.TrimSpace(p.IdealAnswerMD)
	if ideal == "" {
		return result, fmt.Errorf("ideal_answer_md empty")
	}
	out := make([]domain.ReplayAnnotation, 0, len(p.Annotations))
	for _, a := range p.Annotations {
		typ := domain.ReplayAnnotationType(strings.TrimSpace(a.Type))
		if !typ.IsValid() {
			typ = domain.ReplayAnnotationMissing
		}
		out = append(out, domain.ReplayAnnotation{
			YourExcerpt:  strings.TrimSpace(a.YourExcerpt),
			IdealExcerpt: strings.TrimSpace(a.IdealExcerpt),
			Type:         typ,
			Comment:      strings.TrimSpace(a.Comment),
		})
		if len(out) >= 5 {
			break
		}
	}
	result.IdealAnswerMD = ideal
	result.Annotations = out
	return result, nil
}

// strictOrRegexJSON — same shape as parseLLMJSON in judge.go but
// scoped to this file so tests stay self-contained.
var replayJSONObjectRe = regexp.MustCompile(`(?s)\{.*\}`)

func strictOrRegexJSON(raw string, dst any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("empty response")
	}
	if err := json.Unmarshal([]byte(raw), dst); err == nil {
		return nil
	}
	m := replayJSONObjectRe.FindString(raw)
	if m == "" {
		return fmt.Errorf("no json object in response")
	}
	if err := json.Unmarshal([]byte(m), dst); err != nil {
		return fmt.Errorf("regex-extracted json: %w", err)
	}
	return nil
}
