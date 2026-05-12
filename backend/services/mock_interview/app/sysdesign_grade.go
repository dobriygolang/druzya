// Package app — sysdesign_grade.go: 5-axis rubric grading for the SysDesign
// stage.
//
// Why split from the canvas judge (judge.go::JudgeCanvas):
//   - JudgeCanvas — multimodal vision-based scoring of an Excalidraw export.
//     Used by orchestrator.SubmitCanvas; output shape matches HR/algo verdict.
//   - SysDesignGrader — text-only rubric over a scene-JSON summary + narration
//     paragraph. Returns a structured 5-axis vector (availability /
//     consistency / scalability / cost / simplicity) instead of a single
//     score. Used by the new RunSysDesignAttempt endpoint to power the radar
//     debrief without re-running the vision judge (which costs 800-900 tokens
//     on every iteration).
//
// Anti-fallback: on LLM error / parse fail, the verdict has Unavailable=true
// and zeroed axes; the frontend shows «evaluation unavailable, retry» rather
// than a fake score.
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

// SysDesignRubricInput — wire-shape input. CanvasJSON is the Excalidraw
// scene blob (or any textual summary); NarrationText is the candidate's
// trade-offs explanation. Both are concatenated into the LLM prompt;
// CanvasJSON may be empty (the candidate has only narration).
type SysDesignRubricInput struct {
	AttemptID     uuid.UUID
	CanvasJSON    string
	NarrationText string
}

// SysDesignAxes — the 5-axis vector. Each axis is 1..5; 5 = excellent,
// 1 = serious gap. We use int (not float) so the radar polygon stays on a
// grid and the FE doesn't have to format decimals.
type SysDesignAxes struct {
	Availability int
	Consistency  int
	Scalability  int
	Cost         int
	Simplicity   int
}

// SysDesignRubricOutput — wire-shape verdict.
type SysDesignRubricOutput struct {
	Axes              SysDesignAxes
	NarrativeCritique string
	MissingConcepts   []string
	Unavailable       bool
}

// SysDesignGrader is the use-case bundle.
type SysDesignGrader struct {
	Chain    llmchain.ChatClient
	Attempts domain.PipelineAttemptRepo
	Tasks    domain.TaskRepo
	Stages   domain.PipelineStageRepo
	Log      *slog.Logger
}

// sysDesignRubricSystemPrompt — strict-JSON 5-axis system design rubric.
// Distinct from canvasSystemPrompt (judge.go): no diagram aesthetics rule
// (this UC is text-only), uses 1-5 axes instead of single 0-100 score.
const sysDesignRubricSystemPrompt = `Ты — strict senior-architect interviewer. Оцениваешь system-design решение кандидата по 5-axis rubric'у: availability / consistency / scalability / cost / simplicity.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев. Все ключи обязательны.

Схема ответа:
{
  "availability":  <целое 1..5>,
  "consistency":   <целое 1..5>,
  "scalability":   <целое 1..5>,
  "cost":          <целое 1..5>,
  "simplicity":    <целое 1..5>,
  "narrative_critique": "<2-4 предложения по-русски: общий вердикт + 1-2 приоритетных next step>",
  "missing_concepts":   [<до 6 коротких bullet'ов по-русски: концепции которых нет в решении>]
}

Что оцениваешь по каждой оси (5 = excellent, 1 = serious gap):
- **availability** — failover, replication, мульти-региональность, graceful degradation.
- **consistency** — выбор уровня consistency обоснован, явные trade-offs CAP, версионирование данных.
- **scalability** — horizontal scaling path, шардинг, кэширование, async/queue patterns.
- **cost** — реалистичные costs at scale, no over-engineering для маленьких volume, choose cheap storage where appropriate.
- **simplicity** — нет лишних компонентов, понятная и обоснованная архитектура.

Правила:
- По умолчанию ставь 2-3 по каждой оси. 5 ТОЛЬКО при production-grade обосновании.
- Если canvas пустой / narration пустой → все оси = 1, missing_concepts отражает что не предоставлено.
- missing_concepts — конкретные технологии или паттерны (e.g. "circuit breaker", "read replicas", "consistent hashing").
- narrative_critique — конструктивный, конкретный совет.`

// Run executes the 5-axis grader.
//
// Either CanvasJSON OR NarrationText must be non-empty (a system design with
// neither is meaningless). Empty payloads return a structured 1-1-1-1-1
// verdict rather than failing, mirroring the «empty diagram» path in
// JudgeCanvas — но без vision-call'а.
func (g *SysDesignGrader) Run(ctx context.Context, in SysDesignRubricInput) (SysDesignRubricOutput, error) {
	if strings.TrimSpace(in.CanvasJSON) == "" && strings.TrimSpace(in.NarrationText) == "" {
		return SysDesignRubricOutput{}, fmt.Errorf("canvas + narration both empty: %w", domain.ErrValidation)
	}

	att, err := g.Attempts.Get(ctx, in.AttemptID)
	if err != nil {
		return SysDesignRubricOutput{}, fmt.Errorf("attempts.Get: %w", err)
	}
	// Accept both task_solve (legacy сall path) and sysdesign_canvas.
	if att.Kind != domain.AttemptTaskSolve && att.Kind != domain.AttemptSysDesignCanvas {
		return SysDesignRubricOutput{}, fmt.Errorf("attempt kind=%s, want task_solve|sysdesign_canvas: %w", att.Kind, domain.ErrConflict)
	}

	if g.Stages != nil {
		stage, sErr := g.Stages.Get(ctx, att.PipelineStageID)
		if sErr == nil && stage.StageKind != domain.StageSysDesign {
			return SysDesignRubricOutput{}, fmt.Errorf("stage_kind=%s not eligible for run-sysdesign: %w", stage.StageKind, domain.ErrConflict)
		}
	}

	// Pull task body + functional requirements for prompt context.
	var taskBody, funcReqs string
	if att.TaskID != nil && g.Tasks != nil {
		if t, tErr := g.Tasks.Get(ctx, *att.TaskID); tErr == nil {
			taskBody = t.BodyMD
			funcReqs = t.FunctionalRequirementsMD
		}
	}

	if g.Chain == nil {
		if g.Log != nil {
			g.Log.WarnContext(ctx, "mock_interview.sysdesign_grade: chain=nil, returning unavailable")
		}
		return sysDesignUnavailable(), nil
	}

	// Truncate canvas JSON to keep token use sane (vision-judge already
	// consumes the visual signal; this UC's canvas summary is just hint).
	canvasSummary := truncate(in.CanvasJSON, 4*1024)

	userMsg := fmt.Sprintf(
		"Задача:\n%s\n\nФункциональные требования:\n%s\n\nДиаграмма (JSON):\n%s\n\nПояснения кандидата (trade-offs / выбор технологий):\n%s",
		taskBody, funcReqs, canvasSummary, in.NarrationText,
	)

	resp, err := g.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.2,
		MaxTokens:   900,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: sysDesignRubricSystemPrompt},
			{Role: llmchain.RoleUser, Content: userMsg},
		},
	})
	if err != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.sysdesign_grade: chain.Chat", slog.Any("err", err))
		}
		return sysDesignUnavailable(), nil
	}

	parsed, perr := parseSysDesignRubric(resp.Content)
	if perr != nil {
		if g.Log != nil {
			g.Log.ErrorContext(ctx, "mock_interview.sysdesign_grade: parse", slog.Any("err", perr))
		}
		return sysDesignUnavailable(), nil
	}
	return parsed, nil
}

// sysDesignUnavailable — structured anti-fallback.
func sysDesignUnavailable() SysDesignRubricOutput {
	return SysDesignRubricOutput{
		Axes:              SysDesignAxes{}, // all zeroes
		NarrativeCritique: "Оценка временно недоступна — попробуй ещё раз.",
		MissingConcepts:   []string{},
		Unavailable:       true,
	}
}

// parseSysDesignRubric — strict json with regex fallback. Clamps axes to 1..5.
func parseSysDesignRubric(raw string) (SysDesignRubricOutput, error) {
	var p struct {
		Availability      int      `json:"availability"`
		Consistency       int      `json:"consistency"`
		Scalability       int      `json:"scalability"`
		Cost              int      `json:"cost"`
		Simplicity        int      `json:"simplicity"`
		NarrativeCritique string   `json:"narrative_critique"`
		MissingConcepts   []string `json:"missing_concepts"`
	}
	if err := parseLLMJSON(raw, &p); err != nil {
		return SysDesignRubricOutput{}, fmt.Errorf("parse sysdesign rubric: %w", err)
	}
	if p.MissingConcepts == nil {
		p.MissingConcepts = []string{}
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
	return SysDesignRubricOutput{
		Axes: SysDesignAxes{
			Availability: clamp(p.Availability),
			Consistency:  clamp(p.Consistency),
			Scalability:  clamp(p.Scalability),
			Cost:         clamp(p.Cost),
			Simplicity:   clamp(p.Simplicity),
		},
		NarrativeCritique: strings.TrimSpace(p.NarrativeCritique),
		MissingConcepts:   p.MissingConcepts,
		Unavailable:       false,
	}, nil
}
