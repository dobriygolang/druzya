// dto.go — JSON DTOs для chi-bound endpoints (canvas submit + drafts).
// Все остальные DTOs мигрировали в proto и удалены вместе с chi-handler'ами.
package ports

import (
	"encoding/json"
	"time"

	"druz9/mock_interview/domain"
)

// referenceCriteriaDTO — структурированные критерии оценки (must mention /
// nice-to-have / common pitfalls). Используется внутри pipelineAttemptDTO.
type referenceCriteriaDTO struct {
	MustMention    []string `json:"must_mention"`
	NiceToHave     []string `json:"nice_to_have"`
	CommonPitfalls []string `json:"common_pitfalls"`
}

func toRCDTO(rc domain.ReferenceCriteria) referenceCriteriaDTO {
	if rc.MustMention == nil {
		rc.MustMention = []string{}
	}
	if rc.NiceToHave == nil {
		rc.NiceToHave = []string{}
	}
	if rc.CommonPitfalls == nil {
		rc.CommonPitfalls = []string{}
	}
	return referenceCriteriaDTO(rc)
}

// submitCanvasRequest — wire body для POST /mock/attempts/{id}/submit-canvas.
type submitCanvasRequest struct {
	ImageDataURL    string          `json:"image_data_url"`
	SceneJSON       json.RawMessage `json:"scene_json"`
	ContextMD       string          `json:"context_md"`
	NonFunctionalMD string          `json:"non_functional_md"`
}

// pipelineAttemptDTO — JSON shape для submit-canvas response. Сохранена
// одна shape на все attempt-возвраты (frontend ожидает одинаковый contract).
type pipelineAttemptDTO struct {
	ID                           string               `json:"id"`
	Kind                         string               `json:"kind"`
	QuestionBody                 string               `json:"question_body"`
	ExpectedAnswerMD             string               `json:"expected_answer_md"`
	ReferenceCriteria            referenceCriteriaDTO `json:"reference_criteria"`
	UserAnswerMD                 string               `json:"user_answer_md"`
	UserContextMD                string               `json:"user_context_md"`
	UserExcalidrawImageURL       string               `json:"user_excalidraw_image_url"`
	UserExcalidrawSceneJSON      json.RawMessage      `json:"user_excalidraw_scene_json,omitempty"`
	AIScore                      *float32             `json:"ai_score"`
	AIVerdict                    string               `json:"ai_verdict"`
	AIWaterScore                 *float32             `json:"ai_water_score"`
	AIFeedbackMD                 string               `json:"ai_feedback_md"`
	AIMissingPoints              []string             `json:"ai_missing_points"`
	AIJudgedAt                   *time.Time           `json:"ai_judged_at"`
	CreatedAt                    time.Time            `json:"created_at"`
	TaskFunctionalRequirementsMD *string              `json:"task_functional_requirements_md,omitempty"`
	TaskLanguage                 *string              `json:"task_language,omitempty"`
}

func toPipelineAttemptDTO(a domain.PipelineAttempt, qBody, qExpected string, rc *domain.ReferenceCriteria) pipelineAttemptDTO {
	missing := a.AIMissingPoints
	if missing == nil {
		missing = []string{}
	}
	d := pipelineAttemptDTO{
		ID:                     a.ID.String(),
		Kind:                   string(a.Kind),
		QuestionBody:           qBody,
		ExpectedAnswerMD:       qExpected,
		UserAnswerMD:           a.UserAnswerMD,
		UserContextMD:          a.UserContextMD,
		UserExcalidrawImageURL: a.UserExcalidrawImageURL,
		AIScore:                a.AIScore,
		AIVerdict:              string(a.AIVerdict),
		AIWaterScore:           a.AIWaterScore,
		AIFeedbackMD:           a.AIFeedbackMD,
		AIMissingPoints:        missing,
		AIJudgedAt:             a.AIJudgedAt,
		CreatedAt:              a.CreatedAt,
	}
	if len(a.UserExcalidrawSceneJSON) > 0 {
		d.UserExcalidrawSceneJSON = json.RawMessage(a.UserExcalidrawSceneJSON)
	}
	if rc != nil {
		d.ReferenceCriteria = toRCDTO(*rc)
	} else {
		d.ReferenceCriteria = toRCDTO(domain.ReferenceCriteria{})
	}
	return d
}

// canvasDraftBody — wire body для PUT /mock/attempts/{id}/canvas-draft.
type canvasDraftBody struct {
	SceneJSON       json.RawMessage `json:"scene_json"`
	NonFunctionalMD string          `json:"non_functional_md"`
	ContextMD       string          `json:"context_md"`
}

// canvasDraftDTO — wire shape для GET /mock/attempts/{id}/canvas-draft.
type canvasDraftDTO struct {
	SceneJSON       json.RawMessage `json:"scene_json"`
	NonFunctionalMD string          `json:"non_functional_md"`
	ContextMD       string          `json:"context_md"`
	UpdatedAt       string          `json:"updated_at"`
}
