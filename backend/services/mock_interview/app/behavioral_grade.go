// Package app — behavioral_grade.go: STAR-format rubric for the Behavioral
// stage.
//
// Why distinct from judge.go's pass2BehavioralSystemPrompt:
//   - That prompt is the SubmitAnswer code-path — it returns a 0-100 score
//     and the orchestrator persists the verdict to pipeline_attempts.
//   - This UC is the "Run rubric" iterative knob — returns a 4-axis breakdown
//     (Situation / Task / Action / Result) plus a separate communication
//     score, so the candidate can see WHY their answer fell short of STAR
//     structure before committing the final Submit.
//
// Anti-fallback: structured unavailable verdict on LLM error.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// BehavioralRubricInput — wire-shape input.
type BehavioralRubricInput struct {
	AttemptID  uuid.UUID
	AnswerText string
}

// BehavioralAxes — STAR breakdown. Each axis is 1..5; 5 = excellent presence
// of that element, 1 = missing entirely.
type BehavioralAxes struct {
	Situation int
	Task      int
	Action    int
	Result    int
}

// BehavioralRubricOutput — wire-shape verdict.
type BehavioralRubricOutput struct {
	Axes               BehavioralAxes
	CommunicationScore int    // 1..5 — clarity, structure, brevity
	BodyMD             string // human-readable summary
	Unavailable        bool
}

// BehavioralGrader is the use-case bundle.
type BehavioralGrader struct {
	Chain    llmchain.ChatClient
	Attempts domain.PipelineAttemptRepo
	Stages   domain.PipelineStageRepo
	Log      *slog.Logger
}

// behavioralRubricSystemPrompt — strict-JSON STAR rubric.
const behavioralRubricSystemPrompt = `Ты — strict senior behavioral-interviewer. Оцениваешь ответ кандидата по STAR-формату (Situation / Task / Action / Result) + communication clarity.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев. Все ключи обязательны.

Схема ответа:
{
  "situation":     <целое 1..5>,
  "task":          <целое 1..5>,
  "action":        <целое 1..5>,
  "result":        <целое 1..5>,
  "communication": <целое 1..5>,
  "body_md": "<3-5 предложений по-русски: конкретный feedback по каждой оси STAR + что улучшить>"
}

Что оцениваешь:
- **situation** — конкретный кейс (когда / где / кто), не абстрактные "обычно я делаю X". 5 = ясный контекст с деталями.
- **task** — конкретная задача / проблема перед кандидатом. 5 = чёткая формулировка ставки.
- **action** — что кандидат ЛИЧНО сделал (не "мы", а "я"). 5 = конкретные шаги с ownership.
- **result** — measurable итог (метрика / цифра / фидбек). 5 = quantified outcome.
- **communication** — структура, краткость, ясность ответа. 5 = можно публиковать как case-study.

Правила:
- По умолчанию ставь 2-3. 5 ТОЛЬКО при чёткой STAR-структуре + конкретике.
- "Мы сделали" вместо "я сделал" → action ≤ 2.
- Гипотетический ответ ("я бы сделал так") вместо real case → situation ≤ 2.
- Отсутствие measurable result → result ≤ 2.
- body_md — конкретный совет, не общие морализации.`

// Run executes the STAR rubric grader.
func (g *BehavioralGrader) Run(ctx context.Context, in BehavioralRubricInput) (BehavioralRubricOutput, error) {
	if strings.TrimSpace(in.AnswerText) == "" {
		return BehavioralRubricOutput{}, fmt.Errorf("answer empty: %w", domain.ErrValidation)
	}

	att, err := g.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return BehavioralRubricOutput{}, fmt.Errorf("attempts.Get: %w", err)
	}
	// Behavioral attempts are question_answer (or future voice_answer once
	// merged); we explicitly REJECT task_solve to surface caller bugs early.
	if att.Kind != domain.AttemptQuestionAnswer && att.Kind != domain.AttemptVoiceAnswer {
		return BehavioralRubricOutput{}, fmt.Errorf("attempt kind=%s, want question_answer|voice_answer: %w", att.Kind, domain.ErrConflict)
	}

	if g.Stages != nil {
		stage, sErr := g.Stages.Get(ctx, att.PipelineStageID)
		if sErr == nil && stage.StageKind != domain.StageBehavioral {
			return BehavioralRubricOutput{}, fmt.Errorf("stage_kind=%s not eligible for run-behavioral: %w", stage.StageKind, domain.ErrConflict)
		}
	}

	if g.Chain == nil {
		if g.Log != nil {
			g.Log.WarnContext(ctx, "mock_interview.behavioral_grade: chain=nil, returning unavailable")
		}
		return behavioralUnavailable(), nil
	}

	// Question body isn't on PipelineAttempt directly (lives on the joined
	// default_question / company_question row); behavioral rubric scoring
	// works fine on the answer alone — STAR structure is judged by content
	// shape rather than against a specific question. The full final-grade
	// path (SubmitAnswer) is the one that needs the question for must_mention
	// matching; this UC is the lightweight rubric-only iterator.
	userMsg := fmt.Sprintf("Ответ кандидата:\n%s", in.AnswerText)

	resp, err := g.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.2,
		MaxTokens:   700,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: behavioralRubricSystemPrompt},
			{Role: llmchain.RoleUser, Content: userMsg},
		},
	})
	if err != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.behavioral_grade: chain.Chat", slog.Any("err", err))
		}
		return behavioralUnavailable(), nil
	}

	parsed, perr := parseBehavioralRubric(resp.Content)
	if perr != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.behavioral_grade: parse", slog.Any("err", perr))
		}
		return behavioralUnavailable(), nil
	}
	return parsed, nil
}

func behavioralUnavailable() BehavioralRubricOutput {
	return BehavioralRubricOutput{
		Axes:               BehavioralAxes{},
		CommunicationScore: 0,
		BodyMD:             "Оценка временно недоступна — попробуй ещё раз.",
		Unavailable:        true,
	}
}

func parseBehavioralRubric(raw string) (BehavioralRubricOutput, error) {
	var p struct {
		Situation     int    `json:"situation"`
		Task          int    `json:"task"`
		Action        int    `json:"action"`
		Result        int    `json:"result"`
		Communication int    `json:"communication"`
		BodyMD        string `json:"body_md"`
	}
	if err := parseLLMJSON(raw, &p); err != nil {
		return BehavioralRubricOutput{}, fmt.Errorf("parse behavioral rubric: %w", err)
	}
	clamp := func(n int) int {
		if n < 1 {
			return 1
		}
		if n > 5 {
			return 5
		}
		return n
	}
	return BehavioralRubricOutput{
		Axes: BehavioralAxes{
			Situation: clamp(p.Situation),
			Task:      clamp(p.Task),
			Action:    clamp(p.Action),
			Result:    clamp(p.Result),
		},
		CommunicationScore: clamp(p.Communication),
		BodyMD:             strings.TrimSpace(p.BodyMD),
		Unavailable:        false,
	}, nil
}
