// Package app — judge.go: two-pass LLM-based answer scoring.
//
// Pass 1 (water-detector): a tiny prompt asking for "% off-topic" — independent
// of the reference criteria so we can penalise lyrical drift even on questions
// the model has otherwise scored highly. Always uses the default Pass-1 prompt
// (admin can't override this; off-topic detection is a stable signal).
//
// Pass 2 (correctness): the heavy prompt — JSON-only output with score (0..100),
// matched_must_mention/matched_nice_to_have arrays, missing_points, and a short
// human-readable feedback paragraph. Profile.custom_prompt_template (when
// non-empty) replaces the embedded default.
//
// Score math:
//
//	correctness × (1 - water_score/100 × profile.off_topic_penalty)
//	if user answer matches any common_pitfall (case-insensitive substring) →
//	    final = final × 0.5
//
// Verdict mapping (with profile.bias_toward_fail):
//
//	final >= 70 → pass
//	final <  50 → fail
//	else 50..69 → fail if bias_toward_fail else borderline
//
// Error handling: if either LLM call fails OR JSON parsing fails (after a
// regex-based recovery attempt), we return JudgeOutput{Score:0,
// Verdict:AttemptVerdictPending, Feedback:"Не удалось получить оценку,
// попробуй ещё раз"} so the orchestrator can persist the row and let the
// user retry without 500-ing the API.
package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"
)

// JudgeClient is the seam — the orchestrator calls JudgeAnswer and is
// agnostic to whether it's the real LLM or a fake in tests.
type JudgeClient interface {
	JudgeAnswer(ctx context.Context, in JudgeInput) (JudgeOutput, error)
}

// CanvasJudgeClient — extra capability for Phase D.1 sysdesign-canvas
// scoring. Kept as a separate interface so non-vision consumers don't
// have to implement it. The orchestrator type-asserts at SubmitCanvas
// and falls back to errorFallback() when the wired judge doesn't
// implement it (e.g. nil-chain dev environment).
type CanvasJudgeClient interface {
	JudgeCanvas(ctx context.Context, in JudgeCanvasInput) (JudgeOutput, error)
}

// JudgeCanvasInput — multimodal sysdesign judge payload. ImageDataURL is a
// base64 data-URL ("data:image/png;base64,…") of the user's exported
// excalidraw drawing.
type JudgeCanvasInput struct {
	TaskBody                 string                     // mock_tasks.body_md
	FunctionalRequirementsMD string                     // mock_tasks.functional_requirements_md
	NonFunctionalMD          string                     // user-supplied
	ContextMD                string                     // user-supplied — explains tech choices
	ImageDataURL             string                     // data:image/png;base64,…
	ReferenceSolutionMD      string                     // mock_tasks.reference_solution_md (do not leak verbatim)
	ReferenceCriteria        domain.ReferenceCriteria   // must_mention / nice_to_have / common_pitfalls
	StrictnessProfile        domain.AIStrictnessProfile // bias_toward_fail honoured at verdict mapping
}

// JudgeInput is everything the prompts need.
//
// Kind selects the prompt path: AttemptTaskSolve uses the code-review
// template (no Pass-1 water detector). All other kinds use the
// question/answer template with optional RelatedTaskMD context.
//
// ReferenceSolutionMD is the canonical solution for code review — only
// consulted when Kind == AttemptTaskSolve. RelatedTaskMD is the body of the
// task that a question_answer attempt is anchored to (interviewer follow-up
// about a coding task) — only consulted when Kind == AttemptQuestionAnswer
// and the attempt has a non-nil TaskID.
type JudgeInput struct {
	QuestionBody        string
	ExpectedAnswerMD    string
	ReferenceCriteria   domain.ReferenceCriteria
	UserAnswer          string
	StrictnessProfile   domain.AIStrictnessProfile
	StageKind           domain.StageKind
	Kind                domain.AttemptKind
	ReferenceSolutionMD string
	RelatedTaskMD       string
}

// JudgeOutput — final score + verdict + qualitative fields.
type JudgeOutput struct {
	Score         float64
	Verdict       domain.AttemptVerdict
	WaterScore    float64
	Feedback      string
	MissingPoints []string
}

// LLMJudge is the production JudgeClient. Pass nil chain to disable
// (returns the error-fallback output) — convenient for environments where
// no provider keys are configured.
type LLMJudge struct {
	chain llmchain.ChatClient
	log   *slog.Logger
}

// NewLLMJudge constructs the production judge.
func NewLLMJudge(chain llmchain.ChatClient, log *slog.Logger) *LLMJudge {
	return &LLMJudge{chain: chain, log: log}
}

// errorFallback — uniform "сорян, не получилось" output. The orchestrator
// stores this on the attempt; the user can retry with the same payload.
//
// Verdict MUST be a terminal value, not 'pending' — the frontend uses
// ai_verdict='pending' as the "judge is still working" signal and will
// spin forever on it. We pick 'fail' so the row settles; the feedback
// text tells the user it was an evaluation failure (not a real fail).
func errorFallback() JudgeOutput {
	return JudgeOutput{
		Score:         0,
		Verdict:       domain.AttemptVerdictFail,
		Feedback:      "Не удалось получить оценку, попробуй ещё раз",
		MissingPoints: []string{},
	}
}

// JudgeAnswer runs the two-pass pipeline + the score math. For
// task_solve kind, Pass-1 (water detector) is skipped — code is by
// definition on-topic; the code-review template runs alone.
func (j *LLMJudge) JudgeAnswer(ctx context.Context, in JudgeInput) (JudgeOutput, error) {
	if j.chain == nil {
		if j.log != nil {
			j.log.WarnContext(ctx, "mock_interview.judge: chain=nil, returning error fallback")
		}
		return errorFallback(), nil
	}

	var (
		waterScore   float64
		corr         float64
		missing      []string
		feedback     string
		err          error
		isCodeReview = in.Kind == domain.AttemptTaskSolve
	)

	if !isCodeReview {
		// Pass 1 — water/on-topic detector (skipped for code submissions).
		waterScore, err = j.pass1WaterScore(ctx, in)
		if err != nil {
			if j.log != nil {
				j.log.ErrorContext(ctx, "mock_interview.judge: pass1 failed", slog.Any("err", err))
			}
			return errorFallback(), nil
		}
	}

	// Pass 2 — correctness scoring (code-aware when Kind=task_solve).
	corr, missing, feedback, err = j.pass2Correctness(ctx, in)
	if err != nil {
		if j.log != nil {
			j.log.ErrorContext(ctx, "mock_interview.judge: pass2 failed", slog.Any("err", err))
		}
		return errorFallback(), nil
	}

	// Score math.
	final := corr * (1.0 - (waterScore/100.0)*float64(in.StrictnessProfile.OffTopicPenalty))
	if hasPitfall(in.UserAnswer, in.ReferenceCriteria.CommonPitfalls) {
		final = final * 0.5
	}
	if final < 0 {
		final = 0
	}
	if final > 100 {
		final = 100
	}

	verdict := mapVerdict(final, in.StrictnessProfile.BiasTowardFail)

	return JudgeOutput{
		Score:         final,
		Verdict:       verdict,
		WaterScore:    waterScore,
		Feedback:      feedback,
		MissingPoints: missing,
	}, nil
}

// hasPitfall returns true if any common_pitfall appears (case-insensitive
// substring match) in the user's answer.
func hasPitfall(answer string, pitfalls []string) bool {
	if len(pitfalls) == 0 || strings.TrimSpace(answer) == "" {
		return false
	}
	low := strings.ToLower(answer)
	for _, p := range pitfalls {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}

// mapVerdict applies the verdict thresholds + bias-toward-fail flag.
func mapVerdict(final float64, biasFail bool) domain.AttemptVerdict {
	switch {
	case final >= 70:
		return domain.AttemptVerdictPass
	case final < 50:
		return domain.AttemptVerdictFail
	default:
		if biasFail {
			return domain.AttemptVerdictFail
		}
		return domain.AttemptVerdictBorderline
	}
}

// ── prompts ─────────────────────────────────────────────────────────────

const pass1SystemPrompt = `Ты — анализатор on-topic кандидатских ответов на собеседовании. Твоя единственная задача — оценить, насколько ответ относится к заданному вопросу. Игнорируй фактическую правильность, оценивай только релевантность темы.

Верни СТРОГО JSON одной строкой, без markdown, без комментариев:
{"water_score": <число 0..100>}

Где water_score — процент "воды" / off-topic в ответе:
- 0 — ответ полностью по теме вопроса
- 50 — половина ответа не относится к делу
- 100 — ответ полностью off-topic / лирика / не отвечает на заданный вопрос`

// pass2CodeReviewSystemPrompt is the code-aware reviewer template used when
// JudgeInput.Kind == AttemptTaskSolve. Pass-1 water detection is skipped for
// code submissions — code is on-topic by definition.
const pass2CodeReviewSystemPrompt = `Ты — строгий senior-reviewer. Оцениваешь решение задачи на собеседовании.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев, без поясняющего текста снаружи объекта. Все ключи обязательны.

Схема ответа:
{
  "score": <число 0..100, оценка решения>,
  "matched_must_mention": [<строки из must_mention, которые отражены в коде/комментариях>],
  "matched_nice_to_have": [<строки из nice_to_have, которые отражены в коде>],
  "missing_points": [<до 5 коротких пунктов, которых не хватило>],
  "feedback": "<2-4 предложения по-русски: что хорошо, что улучшить>"
}

Что оцениваешь:
1. Корректность алгоритма (приведёт ли к правильному ответу на edge-cases).
2. Сложность по времени и памяти (явно ли указана / соответствует ли must_mention).
3. Стиль кода (читаемость, naming, структура).
4. Покрытие edge cases в коде.
5. Использование пунктов из must_mention (О-нотация, конкретный подход).

Правила оценки:
- Если код не компилируется или явно неработающий — score < 30.
- Если решение O(n²) когда требовалось O(n) — score < 50.
- ОДИН пропущенный must_mention = снять минимум 30 баллов.
- По умолчанию ставь FAIL. PASS только если решение корректно, эффективно и покрывает must_mention.
- feedback — конструктивный, без снисходительности.`

const pass2SystemPrompt = `Ты — строгий технический интервьюер. Оцениваешь ответ кандидата на собеседовании по заданным критериям.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев, без поясняющего текста снаружи объекта. Все ключи обязательны.

Схема ответа:
{
  "score": <число 0..100, оценка корректности по существу>,
  "matched_must_mention": [<строки из must_mention, которые кандидат раскрыл>],
  "matched_nice_to_have": [<строки из nice_to_have, которые кандидат раскрыл>],
  "missing_points": [<до 5 коротких пунктов, которых не хватило в ответе>],
  "feedback": "<2-4 предложения по-русски: что хорошо, что улучшить>"
}

Правила:
- score = 0 если ответ пустой или совсем мимо
- score = 100 если кандидат полностью раскрыл всё must_mention И не сделал критических ошибок
- ОДИН пропущенный must_mention = снять минимум 30 баллов
- Если кандидат упоминает технически некорректную вещь — снижай балл независимо от покрытия критериев
- feedback — конструктивный, без снисходительности`

// pass2BehavioralSystemPrompt — STAR-rubric template для behavioral stage.
// Behavioral отличается от HR: оценивается СТРУКТУРА ответа (Situation /
// Task / Action / Result), а не только содержание. Хороший ответ — это
// конкретный кейс с измеримым результатом, а не абстрактные рассуждения
// о "командной работе". Reference_criteria.must_mention здесь обычно
// содержит структурные пункты ("конкретный кейс", "результат / метрика",
// "своя роль явно") — а не доменные знания.
const pass2BehavioralSystemPrompt = `Ты — строгий behavioral-интервьюер senior+ уровня. Оцениваешь ответ кандидата по STAR-формату (Situation / Task / Action / Result).

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев, без поясняющего текста снаружи объекта. Все ключи обязательны.

Схема ответа:
{
  "score": <число 0..100>,
  "matched_must_mention": [<строки из must_mention, которые кандидат раскрыл>],
  "matched_nice_to_have": [<строки из nice_to_have, которые кандидат раскрыл>],
  "missing_points": [<до 5 коротких пунктов, которых не хватило в ответе>],
  "feedback": "<2-4 предложения по-русски: что хорошо, что улучшить>"
}

Что оцениваешь по STAR:
- **Situation** — конкретный кейс с контекстом (когда / где / кто). Гипотетика и абстрактные "обычно я делаю Х" — провал.
- **Task** — какая была задача / проблема перед кандидатом. Не "у нас был конфликт" а "мне нужно было разрулить конфликт между PM и tech-lead".
- **Action** — что КАНДИДАТ ЛИЧНО сделал (не "мы", а "я"). Конкретные шаги, разговоры, решения.
- **Result** — измеримый итог. Метрика / цифра / фидбек. "Стало лучше" без конкретики — слабо.

Правила оценки:
- Гипотетический ответ ("я бы сделал так") вместо конкретного кейса → score < 40, обязательно отметить в missing_points.
- "Мы сделали" вместо "я сделал" — снять 20 баллов: behavioral про личный вклад.
- Отсутствие measurable result — снять 20 баллов.
- Признаки common_pitfalls (например "такого не было", "я всегда соглашаюсь", "конфликтов не бывает") → score × 0.5 + честный feedback что это red flag.
- score = 100 только при ВСЕХ четырёх элементах STAR + measurable result + конкретные действия от первого лица.
- По умолчанию FAIL. PASS только при чётком STAR-структурированном кейсе.
- feedback — конкретный совет: "В следующий раз начни с одной фразы про situation, потом сразу task в одном предложении" — не общая морализация.`

// pass1WaterScore calls the LLM with the on-topic detector prompt and
// parses {"water_score": N}. Returns 0 on parse failure (fail-soft toward
// "not penalising").
func (j *LLMJudge) pass1WaterScore(ctx context.Context, in JudgeInput) (float64, error) {
	user := fmt.Sprintf("Вопрос:\n%s\n\nОтвет кандидата:\n%s", in.QuestionBody, in.UserAnswer)
	resp, err := j.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.0,
		MaxTokens:   200,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: pass1SystemPrompt},
			{Role: llmchain.RoleUser, Content: user},
		},
	})
	if err != nil {
		return 0, fmt.Errorf("chain.Chat pass1: %w", err)
	}

	var parsed struct {
		WaterScore float64 `json:"water_score"`
	}
	if err := parseLLMJSON(resp.Content, &parsed); err != nil {
		return 0, fmt.Errorf("parse pass1: %w", err)
	}
	if parsed.WaterScore < 0 {
		parsed.WaterScore = 0
	}
	if parsed.WaterScore > 100 {
		parsed.WaterScore = 100
	}
	return parsed.WaterScore, nil
}

// pass2Correctness calls the LLM with the heavy correctness prompt
// (or profile.custom_prompt_template if set) and parses the structured
// JSON output. Returns (correctness, missing_points, feedback, err).
func (j *LLMJudge) pass2Correctness(ctx context.Context, in JudgeInput) (float64, []string, string, error) {
	// Template selection cascade (custom profile prompt always wins):
	//   1. AttemptTaskSolve → code-review template
	//   2. StageBehavioral  → STAR-rubric template
	//   3. default          → general HR / question-answer template
	// Admins override anything via StrictnessProfile.CustomPromptTemplate.
	systemPrompt := pass2SystemPrompt
	switch {
	case in.Kind == domain.AttemptTaskSolve:
		systemPrompt = pass2CodeReviewSystemPrompt
	case in.StageKind == domain.StageBehavioral:
		systemPrompt = pass2BehavioralSystemPrompt
	}
	if strings.TrimSpace(in.StrictnessProfile.CustomPromptTemplate) != "" {
		systemPrompt = in.StrictnessProfile.CustomPromptTemplate
	}

	criteriaJSON, _ := json.Marshal(in.ReferenceCriteria)
	var userMsg string
	if in.Kind == domain.AttemptTaskSolve {
		// Code review: lead with the task body; show reference solution only
		// as context (the system prompt forbids leaking it). Criteria + the
		// candidate's code follow.
		userMsg = fmt.Sprintf(
			"Тип секции: %s\n\nЗадача:\n%s\n\nЭталонное решение (для контекста, не показывай дословно):\n%s\n\nКритерии (JSON):\n%s\n\nРешение кандидата:\n%s",
			in.StageKind, in.QuestionBody, in.ReferenceSolutionMD, string(criteriaJSON), in.UserAnswer,
		)
	} else {
		userMsg = fmt.Sprintf(
			"Тип секции: %s\n\nВопрос:\n%s\n\nЭталонный ответ (может быть пустым):\n%s\n\nКритерии (JSON):\n%s\n\nОтвет кандидата:\n%s",
			in.StageKind, in.QuestionBody, in.ExpectedAnswerMD, string(criteriaJSON), in.UserAnswer,
		)
		if strings.TrimSpace(in.RelatedTaskMD) != "" {
			userMsg += "\n\nКонтекст: задача, которую кандидат только что решал:\n" + in.RelatedTaskMD
		}
	}

	resp, err := j.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskReasoning,
		Temperature: 0.2,
		MaxTokens:   800,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: systemPrompt},
			{Role: llmchain.RoleUser, Content: userMsg},
		},
	})
	if err != nil {
		return 0, nil, "", fmt.Errorf("chain.Chat pass2: %w", err)
	}

	var parsed struct {
		Score              float64  `json:"score"`
		MatchedMustMention []string `json:"matched_must_mention"`
		MatchedNiceToHave  []string `json:"matched_nice_to_have"`
		MissingPoints      []string `json:"missing_points"`
		Feedback           string   `json:"feedback"`
	}
	if err := parseLLMJSON(resp.Content, &parsed); err != nil {
		return 0, nil, "", fmt.Errorf("parse pass2: %w", err)
	}
	if parsed.Score < 0 {
		parsed.Score = 0
	}
	if parsed.Score > 100 {
		parsed.Score = 100
	}
	if parsed.MissingPoints == nil {
		parsed.MissingPoints = []string{}
	}
	return parsed.Score, parsed.MissingPoints, strings.TrimSpace(parsed.Feedback), nil
}

// ── Phase D.1 — multimodal sysdesign canvas judge ─────────────────────

// canvasSystemPrompt is the strict-JSON, single-pass prompt used by
// JudgeCanvas. No water-detector pass — релевантность диаграммы
// определяется через совпадение с functional_requirements / must_mention,
// не через off-topic метрику. Score math совпадает с pass2 (без water'а),
// pitfall halving остаётся.
const canvasSystemPrompt = `Ты — строгий senior-architect интервьюер. Оценивай system-design решение кандидата по приложенной диаграмме (excalidraw export) + текстовому контексту.

ТЫ ВЫВОДИШЬ СТРОГО JSON ОДНИМ ОБЪЕКТОМ, без markdown-обёрток, без комментариев, без поясняющего текста снаружи объекта. Все ключи обязательны.

Схема ответа:
{
  "score": <число 0..100>,
  "matched_must_mention": [<строки из must_mention, которые видны на диаграмме или объяснены в контексте>],
  "matched_nice_to_have": [<строки из nice_to_have, которые видны или объяснены>],
  "missing_points": [<до 5 коротких пунктов, которых не хватило>],
  "feedback": "<2-4 предложения по-русски: что хорошо, что улучшить>"
}

Что оцениваешь:
1. Покрывает ли диаграмма функциональные требования.
2. Адекватность нефункциональных целей (latency / scale / consistency) выбранному решению.
3. Выбор компонентов (БД, кэш, очереди, балансер) — соответствует ли use-case.
4. Trade-offs объяснены ли в context.
5. Edge-cases: failure modes, hot keys, partition.

Правила оценки:
- Если на диаграмме явные противоречия требованиям — score < 30.
- Если кандидат не объяснил выбор БД/очередей в context — снимай не меньше 30 баллов.
- Покрытие пунктов must_mention — критично; ОДИН пропущенный must_mention = снять минимум 30 баллов.
- Common_pitfalls на диаграмме (например monolith DB при write-heavy) — упомяни в missing_points.
- По умолчанию ставь FAIL. PASS только при покрытии всех must_mention И чистого context.
- feedback — конструктивный, без снисходительности.
- Эталонное решение (если приложено) ИСПОЛЬЗУЙ для контекста, но НИКОГДА не повторяй его дословно в feedback.`

// JudgeCanvas — single-pass multimodal scoring. Builds one user-message
// containing the structured text payload + an image content-block, sends
// via TaskVision (OpenRouter Gemini 2.0 Flash :free), and parses the
// strict-JSON response. Returns errorFallback() on any wire / parse error.
func (j *LLMJudge) JudgeCanvas(ctx context.Context, in JudgeCanvasInput) (JudgeOutput, error) {
	if j.chain == nil {
		if j.log != nil {
			j.log.WarnContext(ctx, "mock_interview.judge: chain=nil, returning canvas error fallback")
		}
		return errorFallback(), nil
	}
	if strings.TrimSpace(in.ImageDataURL) == "" {
		return errorFallback(), nil
	}
	imgBytes, mime, err := decodeDataURL(in.ImageDataURL)
	if err != nil {
		if j.log != nil {
			j.log.ErrorContext(ctx, "mock_interview.judge: canvas data url decode", slog.Any("err", err))
		}
		return errorFallback(), nil
	}

	criteriaJSON, _ := json.Marshal(in.ReferenceCriteria)
	userText := fmt.Sprintf(
		"Задача:\n%s\n\nФункциональные требования (от компании):\n%s\n\nНефункциональные требования (предложил кандидат):\n%s\n\nПояснения кандидата (выбор технологий, trade-offs):\n%s\n\nЭталонное решение (для контекста, не показывай дословно):\n%s\n\nКритерии (JSON):\n%s\n\nДиаграмма кандидата приложена изображением.",
		in.TaskBody, in.FunctionalRequirementsMD, in.NonFunctionalMD,
		in.ContextMD, in.ReferenceSolutionMD, string(criteriaJSON),
	)

	resp, err := j.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskVision,
		Temperature: 0.2,
		MaxTokens:   900,
		JSONMode:    true,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: canvasSystemPrompt},
			{
				Role:    llmchain.RoleUser,
				Content: userText,
				Images:  []llmchain.Image{{MimeType: mime, Data: imgBytes}},
			},
		},
	})
	if err != nil {
		if j.log != nil {
			j.log.ErrorContext(ctx, "mock_interview.judge: canvas chain.Chat", slog.Any("err", err))
		}
		return errorFallback(), nil
	}

	var parsed struct {
		Score              float64  `json:"score"`
		MatchedMustMention []string `json:"matched_must_mention"`
		MatchedNiceToHave  []string `json:"matched_nice_to_have"`
		MissingPoints      []string `json:"missing_points"`
		Feedback           string   `json:"feedback"`
	}
	if err := parseLLMJSON(resp.Content, &parsed); err != nil {
		if j.log != nil {
			j.log.ErrorContext(ctx, "mock_interview.judge: canvas parse", slog.Any("err", err))
		}
		return errorFallback(), nil
	}
	if parsed.Score < 0 {
		parsed.Score = 0
	}
	if parsed.Score > 100 {
		parsed.Score = 100
	}
	if parsed.MissingPoints == nil {
		parsed.MissingPoints = []string{}
	}

	final := parsed.Score
	if hasPitfall(in.ContextMD+"\n"+in.NonFunctionalMD, in.ReferenceCriteria.CommonPitfalls) {
		final = final * 0.5
	}
	if final < 0 {
		final = 0
	}
	if final > 100 {
		final = 100
	}
	verdict := mapVerdict(final, in.StrictnessProfile.BiasTowardFail)
	return JudgeOutput{
		Score:         final,
		Verdict:       verdict,
		WaterScore:    0,
		Feedback:      strings.TrimSpace(parsed.Feedback),
		MissingPoints: parsed.MissingPoints,
	}, nil
}

// decodeDataURL parses a "data:<mime>;base64,<payload>" URL into raw bytes
// and the mime type. Accepts only image/png and image/jpeg per Phase D.1
// spec; other types are an error so the orchestrator can 400 cleanly.
func decodeDataURL(s string) ([]byte, string, error) {
	const prefix = "data:"
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, prefix) {
		return nil, "", fmt.Errorf("data url: missing prefix")
	}
	rest := s[len(prefix):]
	semi := strings.Index(rest, ";")
	if semi < 0 {
		return nil, "", fmt.Errorf("data url: missing ;base64,")
	}
	mime := rest[:semi]
	if mime != "image/png" && mime != "image/jpeg" {
		return nil, "", fmt.Errorf("data url: unsupported mime %q", mime)
	}
	rest = rest[semi+1:]
	if !strings.HasPrefix(rest, "base64,") {
		return nil, "", fmt.Errorf("data url: not base64")
	}
	rest = rest[len("base64,"):]
	bytes, err := base64.StdEncoding.DecodeString(rest)
	if err != nil {
		return nil, "", fmt.Errorf("data url: base64 decode: %w", err)
	}
	return bytes, mime, nil
}

// parseLLMJSON attempts strict json.Unmarshal first; on failure regex-extracts
// the first {...} block from the text and retries.
var jsonObjectRe = regexp.MustCompile(`(?s)\{.*\}`)

func parseLLMJSON(raw string, dst any) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("empty response")
	}
	if err := json.Unmarshal([]byte(raw), dst); err == nil {
		return nil
	}
	m := jsonObjectRe.FindString(raw)
	if m == "" {
		return fmt.Errorf("no json object in response")
	}
	if err := json.Unmarshal([]byte(m), dst); err != nil {
		return fmt.Errorf("regex-extracted json: %w", err)
	}
	return nil
}
