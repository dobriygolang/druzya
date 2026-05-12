// Package app — coding_grade.go: open-ended «refactor / implement-feature»
// rubric grading for the Coding stage.
//
// Why split from algo_grade / SubmitAnswer:
//   - Algo (algo_grade.go) — Judge0 sandbox dry-run, exact-string verdict, no
//     LLM. Suitable for «implement two-sum, here are the tests».
//   - Coding — longer (200-500 LOC) snippets where there is no single right
//     answer; we want a rubric (correctness / readability / idiomaticity /
//     edge cases / suggested-lines) rather than a pass/fail count.
//
// Output shape: 5-point score (1..5) + strengths / weaknesses bullet lists +
// optional suggested_lines (1-based indices the LLM thinks the candidate
// should revisit). Anti-fallback: on LLM error or unparseable JSON we return
// a structured «evaluation_unavailable» verdict (Score=0, RubricMD="evaluation
// unavailable, retry") so the frontend can surface the error visibly instead
// of pretending a score happened.
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// CodingRubricInput — wire-shape input for the grader.
type CodingRubricInput struct {
	AttemptID uuid.UUID
	Code      string
	Language  string // shared/enums.Language string form; passed through to LLM
}

// CodingRubricOutput — wire-shape verdict. Score is 1..5 (5-point rubric).
// Strengths / Weaknesses are short bullet strings; SuggestedLines lists
// 1-based line indices the LLM flagged for revision. RubricMD is the
// human-readable summary the FE shows verbatim.
type CodingRubricOutput struct {
	Score          int
	Strengths      []string
	Weaknesses     []string
	SuggestedLines []int
	RubricMD       string
	Unavailable    bool
}

// CodingGrader is the use-case bundle. Chain is the free LLM cascade
// (nil-safe — returns structured unavailable verdict when missing).
// Attempts + Tasks lookup support attempt → task chain so we can pass the
// task's body / functional requirements to the LLM as context.
type CodingGrader struct {
	Chain    llmchain.ChatClient
	Attempts domain.PipelineAttemptRepo
	Tasks    domain.TaskRepo
	Stages   domain.PipelineStageRepo
	Log      *slog.Logger
}

// codingRubricSystemPrompt — strict-JSON, 5-axis-on-one-scale, code-aware.
// Same emphasis as judge.go on JSON-only output + fail-by-default.
const codingRubricSystemPrompt = `Ты — senior code-reviewer. Оцениваешь open-ended решение кандидата по rubric'у (рефакторинг, имплементация feature, design code-snippet).

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев. Все ключи обязательны.

Схема ответа:
{
  "score": <целое 1..5, где 5 = production-ready, 1 = серьёзные проблемы>,
  "strengths": [<3-5 коротких bullet'ов по-русски: что хорошо>],
  "weaknesses": [<3-5 коротких bullet'ов по-русски: что улучшить>],
  "suggested_lines": [<до 10 целых чисел: 1-based номера строк кода, которые стоит пересмотреть>],
  "rubric_md": "<2-4 предложения по-русски: общий вердикт + 1-2 приоритетных next step>"
}

Что оцениваешь:
1. Корректность (компилится, делает что просили, edge cases).
2. Читаемость (naming, структура, комментарии где надо, no clever-tricks).
3. Идиоматичность для языка (Go: error handling без panic'ов; Python: pythonic; JS/TS: типобезопасность).
4. Простота (нет лишних абстракций / over-engineering).
5. Тестируемость (pure functions, dependency injection, side-effects изолированы).

Правила:
- score=5 ТОЛЬКО при production-ready коде. По умолчанию ставь 2-3.
- score=1 — серьёзные баги или код не делает что просили.
- Если код пустой / placeholder → score=1, weaknesses=["код пустой"].
- suggested_lines — линии где есть конкретная проблема (не для каждого style-issue).
- rubric_md — конструктивно, без снисходительности.`

// Run executes the rubric grader.
//
// Validation cascade mirrors algo_grade.go: code non-empty + attempt is
// task_solve + parent stage_kind is coding. We log + degrade on LLM errors
// rather than failing the request — the orchestrator's SubmitAnswer is the
// canonical grade path, this is a separate «show me a richer rubric» knob.
func (g *CodingGrader) Run(ctx context.Context, in CodingRubricInput) (CodingRubricOutput, error) {
	if strings.TrimSpace(in.Code) == "" {
		return CodingRubricOutput{}, fmt.Errorf("code empty: %w", domain.ErrValidation)
	}
	if strings.TrimSpace(in.Language) == "" {
		return CodingRubricOutput{}, fmt.Errorf("language empty: %w", domain.ErrValidation)
	}

	att, err := g.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return CodingRubricOutput{}, fmt.Errorf("attempts.Get: %w", err)
	}
	if att.Kind != domain.AttemptTaskSolve {
		return CodingRubricOutput{}, fmt.Errorf("attempt kind=%s, want task_solve: %w", att.Kind, domain.ErrConflict)
	}

	// Stage check — coding only (defence-in-depth; algo has its own UC).
	if g.Stages != nil {
		stage, sErr := g.Stages.Get(ctx, att.PipelineStageID)
		if sErr == nil && stage.StageKind != domain.StageCoding {
			return CodingRubricOutput{}, fmt.Errorf("stage_kind=%s not eligible for run-coding: %w", stage.StageKind, domain.ErrConflict)
		}
	}

	// Pull task body + functional requirements for context — non-fatal if
	// missing (some tasks may not have them).
	var taskBody, funcReqs string
	if att.TaskID != nil && g.Tasks != nil {
		if t, tErr := g.Tasks.Get(ctx, *att.TaskID); tErr == nil {
			taskBody = t.BodyMD
			funcReqs = t.FunctionalRequirementsMD
		}
	}

	if g.Chain == nil {
		if g.Log != nil {
			g.Log.WarnContext(ctx, "mock_interview.coding_grade: chain=nil, returning unavailable")
		}
		return codingUnavailable(), nil
	}

	userMsg := fmt.Sprintf(
		"Язык: %s\n\nЗадача:\n%s\n\nФункциональные требования:\n%s\n\nКод кандидата:\n```%s\n%s\n```",
		in.Language, taskBody, funcReqs, in.Language, in.Code,
	)

	resp, err := g.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.2,
		MaxTokens:   900,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: codingRubricSystemPrompt},
			{Role: llmchain.RoleUser, Content: userMsg},
		},
	})
	if err != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.coding_grade: chain.Chat", slog.Any("err", err))
		}
		return codingUnavailable(), nil
	}

	parsed, perr := parseCodingRubric(resp.Content)
	if perr != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.coding_grade: parse", slog.Any("err", perr))
		}
		return codingUnavailable(), nil
	}
	return parsed, nil
}

// codingUnavailable — anti-fallback structured verdict. Frontend renders the
// «evaluation unavailable, retry» banner; weights this row at 0 for the radar
// aggregation.
func codingUnavailable() CodingRubricOutput {
	return CodingRubricOutput{
		Score:       0,
		Strengths:   []string{},
		Weaknesses:  []string{},
		RubricMD:    "Оценка временно недоступна — попробуй ещё раз.",
		Unavailable: true,
	}
}

// parseCodingRubric — strict json.Unmarshal, regex-fallback for stray text.
// Mirrors parseLLMJSON in judge.go (separate package-private impl so this
// file is self-contained for tests).
func parseCodingRubric(raw string) (CodingRubricOutput, error) {
	var p struct {
		Score          int      `json:"score"`
		Strengths      []string `json:"strengths"`
		Weaknesses     []string `json:"weaknesses"`
		SuggestedLines []int    `json:"suggested_lines"`
		RubricMD       string   `json:"rubric_md"`
	}
	if err := parseLLMJSON(raw, &p); err != nil {
		return CodingRubricOutput{}, fmt.Errorf("parse coding rubric: %w", err)
	}

	// Clamp score to 1..5 (LLMs sometimes return 0 or 6 despite the prompt).
	score := p.Score
	if score < 1 {
		score = 1
	}
	if score > 5 {
		score = 5
	}
	if p.Strengths == nil {
		p.Strengths = []string{}
	}
	if p.Weaknesses == nil {
		p.Weaknesses = []string{}
	}
	if p.SuggestedLines == nil {
		p.SuggestedLines = []int{}
	}
	// Dedup suggested_lines + drop non-positive (LLM occasionally returns 0).
	seen := make(map[int]struct{}, len(p.SuggestedLines))
	lines := make([]int, 0, len(p.SuggestedLines))
	for _, n := range p.SuggestedLines {
		if n <= 0 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		lines = append(lines, n)
	}

	return CodingRubricOutput{
		Score:          score,
		Strengths:      p.Strengths,
		Weaknesses:     p.Weaknesses,
		SuggestedLines: lines,
		RubricMD:       strings.TrimSpace(p.RubricMD),
		Unavailable:    false,
	}, nil
}

// Compile-time sanity — keep encoding/json in the import list so this file
// stays self-contained when parseLLMJSON moves (also documents intent).
var _ = json.Marshal
