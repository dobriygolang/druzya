// checkpoint.go — Phase 2 step UX flow UCs.
//
// StartCheckpoint:  юзер открывает checkpoint quiz CTA на step → UC
//                   возвращает skill_keys этого step'а (handler уже
//                   подбирает 5 questions из mock_pool by these keys).
//                   Если step.checkpoint_skill_keys пусто — step вообще
//                   не имеет checkpoint (e.g. сам step — mock).
//
// SubmitCheckpoint: юзер прислал ответы → UC зовёт TaskCheckpointGrade
//                   → пишет step_checkpoint_attempts row с score.
//                   Если score >= CheckpointPassThreshold (70) → passed_at = now()
//                   → UI soft-unlock'ает следующий step.
//
// Question fetching сам UC не делает — это слой handler'а (mock_pool
// access лежит в services/ai_mock и кросс-сервисная зависимость не
// оправдана для quiz pull).
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/shared/pkg/llmchain"
	"druz9/tracks/domain"

	"github.com/google/uuid"
)

// StartCheckpoint — UC. Возвращает step + признак "уже прошёл" (HasPassed).
type StartCheckpoint struct {
	Catalog     domain.CatalogRepo
	Checkpoints domain.CheckpointRepo
}

// StartCheckpointInput.
type StartCheckpointInput struct {
	UserID    uuid.UUID
	TrackID   uuid.UUID
	StepIndex int
}

// StartCheckpointResult.
type StartCheckpointResult struct {
	Step             domain.Step
	AlreadyPassed    bool
	CheckpointSkills []string
}

func (uc *StartCheckpoint) Do(ctx context.Context, in StartCheckpointInput) (StartCheckpointResult, error) {
	tw, err := uc.Catalog.GetByID(ctx, in.TrackID)
	if err != nil {
		return StartCheckpointResult{}, fmt.Errorf("tracks.StartCheckpoint catalog: %w", err)
	}
	var step *domain.Step
	for i := range tw.Steps {
		if tw.Steps[i].StepIndex == in.StepIndex {
			step = &tw.Steps[i]
			break
		}
	}
	if step == nil {
		return StartCheckpointResult{}, domain.ErrNotFound
	}
	passed, err := uc.Checkpoints.HasPassed(ctx, in.UserID, in.TrackID, in.StepIndex)
	if err != nil {
		return StartCheckpointResult{}, fmt.Errorf("tracks.StartCheckpoint passed: %w", err)
	}
	return StartCheckpointResult{
		Step:             *step,
		AlreadyPassed:    passed,
		CheckpointSkills: step.CheckpointSkillKeys,
	}, nil
}

// SubmitCheckpoint — UC. LLM-graded; persist'ит attempt.
type SubmitCheckpoint struct {
	Catalog     domain.CatalogRepo
	Checkpoints domain.CheckpointRepo
	Chain       llmchain.ChatClient
	Now         func() time.Time
	Timeout     time.Duration
}

// QuestionAnswer — single question + user answer + (optional) reference.
type QuestionAnswer struct {
	QuestionID  string `json:"question_id"`
	Question    string `json:"question"`
	UserAnswer  string `json:"user_answer"`
	ModelAnswer string `json:"model_answer,omitempty"` // optional reference for grader
}

// SubmitCheckpointInput.
type SubmitCheckpointInput struct {
	UserID    uuid.UUID
	TrackID   uuid.UUID
	StepIndex int
	Answers   []QuestionAnswer
}

// SubmitCheckpointResult.
type SubmitCheckpointResult struct {
	Score    int
	Passed   bool
	Attempts []GradedAnswer
	Attempt  domain.CheckpointAttempt
}

// GradedAnswer mirrors LLM output per-question.
type GradedAnswer struct {
	QuestionID  string `json:"question_id"`
	UserAnswer  string `json:"user_answer"`
	ModelAnswer string `json:"model_answer"`
	Correct     bool   `json:"correct"`
	Comment     string `json:"comment"`
}

type gradeResponse struct {
	Score    int            `json:"score"`
	Attempts []GradedAnswer `json:"attempts"`
}

func (uc *SubmitCheckpoint) Do(ctx context.Context, in SubmitCheckpointInput) (SubmitCheckpointResult, error) {
	if len(in.Answers) == 0 {
		return SubmitCheckpointResult{}, fmt.Errorf("%w: empty answers", domain.ErrInvalidInput)
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	gradeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt, err := buildGradePrompt(in.Answers)
	if err != nil {
		return SubmitCheckpointResult{}, fmt.Errorf("tracks.SubmitCheckpoint prompt: %w", err)
	}
	resp, err := uc.Chain.Chat(gradeCtx, llmchain.Request{
		Task:        llmchain.TaskCheckpointGrade,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   800,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: gradeSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return SubmitCheckpointResult{}, fmt.Errorf("tracks.SubmitCheckpoint grade: %w", err)
	}
	graded, err := parseGradeResponse(resp.Content)
	if err != nil {
		return SubmitCheckpointResult{}, fmt.Errorf("tracks.SubmitCheckpoint parse: %w", err)
	}
	if len(graded.Attempts) != len(in.Answers) {
		return SubmitCheckpointResult{}, fmt.Errorf("tracks.SubmitCheckpoint: graded %d != asked %d",
			len(graded.Attempts), len(in.Answers))
	}

	now := uc.now().UTC()
	attemptsJSON, _ := json.Marshal(graded.Attempts)

	att := domain.CheckpointAttempt{
		UserID:    in.UserID,
		TrackID:   in.TrackID,
		StepIndex: in.StepIndex,
		Score:     graded.Score,
		Attempts:  attemptsJSON,
	}
	if graded.Score >= domain.CheckpointPassThreshold {
		t := now
		att.PassedAt = &t
	}
	saved, err := uc.Checkpoints.Insert(gradeCtx, att)
	if err != nil {
		return SubmitCheckpointResult{}, fmt.Errorf("tracks.SubmitCheckpoint insert: %w", err)
	}
	return SubmitCheckpointResult{
		Score:    saved.Score,
		Passed:   saved.PassedAt != nil,
		Attempts: graded.Attempts,
		Attempt:  saved,
	}, nil
}

func (uc *SubmitCheckpoint) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

const gradeSystemPrompt = `You are a strict grader for a 5-question checkpoint quiz.

Output JSON ONLY (no markdown, no commentary):
{"score":<int 0..100>,"attempts":[{"question_id":"...","user_answer":"...","model_answer":"<correct full answer>","correct":<bool>,"comment":"<1 sentence — why correct/wrong>"}, ...]}

Rules:
- score = round(100 * correct_count / total_count). All-correct = 100.
- model_answer must be the canonical correct answer (1-3 sentences max), regardless of user's answer.
- A partially correct answer is still INCORRECT — quiz is binary per-question.
- If user_answer is empty / "не знаю" / nonsensical → correct=false, comment cites missing concept.
- Comments concise; no encouragement, no fluff.`

func buildGradePrompt(answers []QuestionAnswer) (string, error) {
	if len(answers) == 0 {
		return "", fmt.Errorf("empty answers")
	}
	var b strings.Builder
	b.WriteString("Grade these answers:\n\n")
	for i, qa := range answers {
		fmt.Fprintf(&b, "[%d] question_id=%q\n  Q: %s\n  A: %s\n",
			i+1, qa.QuestionID, qa.Question, qa.UserAnswer)
		if qa.ModelAnswer != "" {
			fmt.Fprintf(&b, "  REF (canonical): %s\n", qa.ModelAnswer)
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

func parseGradeResponse(raw string) (gradeResponse, error) {
	cleaned := stripFences(raw)
	var out gradeResponse
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return gradeResponse{}, fmt.Errorf("unmarshal: %w", err)
	}
	if out.Score < 0 || out.Score > 100 {
		return gradeResponse{}, fmt.Errorf("score out of range: %d", out.Score)
	}
	for i, a := range out.Attempts {
		if strings.TrimSpace(a.QuestionID) == "" {
			return gradeResponse{}, fmt.Errorf("attempt[%d] empty question_id", i)
		}
	}
	return out, nil
}

func stripFences(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(s, "```"))
}
