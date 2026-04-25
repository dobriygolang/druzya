package ports

import (
	"fmt"
	"time"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// JSON DTOs for the chi REST layer. Field names follow snake_case to match
// the rest of the druz9 HTTP surface and the existing frontend expectations.

type companyDTO struct {
	ID               string    `json:"id"`
	Slug             string    `json:"slug"`
	Name             string    `json:"name"`
	Difficulty       string    `json:"difficulty"`
	MinLevelRequired int       `json:"min_level_required"`
	Sections         []string  `json:"sections"`
	LogoURL          string    `json:"logo_url"`
	Description      string    `json:"description"`
	Active           bool      `json:"active"`
	SortOrder        int       `json:"sort_order"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func toCompanyDTO(c domain.Company) companyDTO {
	if c.Sections == nil {
		c.Sections = []string{}
	}
	return companyDTO{
		ID: c.ID.String(), Slug: c.Slug, Name: c.Name,
		Difficulty: c.Difficulty, MinLevelRequired: c.MinLevelRequired, Sections: c.Sections,
		LogoURL: c.LogoURL, Description: c.Description, Active: c.Active,
		SortOrder: c.SortOrder, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

type strictnessDTO struct {
	ID                   string    `json:"id"`
	Slug                 string    `json:"slug"`
	Name                 string    `json:"name"`
	OffTopicPenalty      float32   `json:"off_topic_penalty"`
	MustMentionPenalty   float32   `json:"must_mention_penalty"`
	HallucinationPenalty float32   `json:"hallucination_penalty"`
	BiasTowardFail       bool      `json:"bias_toward_fail"`
	CustomPromptTemplate string    `json:"custom_prompt_template"`
	Active               bool      `json:"active"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

func toStrictnessDTO(p domain.AIStrictnessProfile) strictnessDTO {
	return strictnessDTO{
		ID: p.ID.String(), Slug: p.Slug, Name: p.Name,
		OffTopicPenalty: p.OffTopicPenalty, MustMentionPenalty: p.MustMentionPenalty,
		HallucinationPenalty: p.HallucinationPenalty, BiasTowardFail: p.BiasTowardFail,
		CustomPromptTemplate: p.CustomPromptTemplate, Active: p.Active,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

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

func fromRCDTO(d referenceCriteriaDTO) domain.ReferenceCriteria {
	return domain.ReferenceCriteria(d)
}

type taskDTO struct {
	ID                       string               `json:"id"`
	StageKind                string               `json:"stage_kind"`
	Language                 string               `json:"language"`
	Difficulty               int                  `json:"difficulty"`
	Title                    string               `json:"title"`
	BodyMD                   string               `json:"body_md"`
	SampleIOMD               string               `json:"sample_io_md"`
	ReferenceCriteria        referenceCriteriaDTO `json:"reference_criteria"`
	ReferenceSolutionMD      string               `json:"reference_solution_md"`
	FunctionalRequirementsMD string               `json:"functional_requirements_md"`
	TimeLimitMin             int                  `json:"time_limit_min"`
	AIStrictnessProfileID    *string              `json:"ai_strictness_profile_id"`
	Active                   bool                 `json:"active"`
	CreatedAt                time.Time            `json:"created_at"`
	UpdatedAt                time.Time            `json:"updated_at"`
}

func toTaskDTO(t domain.MockTask) taskDTO {
	d := taskDTO{
		ID: t.ID.String(), StageKind: string(t.StageKind), Language: string(t.Language),
		Difficulty: t.Difficulty, Title: t.Title, BodyMD: t.BodyMD,
		SampleIOMD: t.SampleIOMD, ReferenceCriteria: toRCDTO(t.ReferenceCriteria),
		ReferenceSolutionMD:      t.ReferenceSolutionMD,
		FunctionalRequirementsMD: t.FunctionalRequirementsMD,
		TimeLimitMin:             t.TimeLimitMin, Active: t.Active,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
	if t.AIStrictnessProfileID != nil {
		s := t.AIStrictnessProfileID.String()
		d.AIStrictnessProfileID = &s
	}
	return d
}

type taskQuestionDTO struct {
	ID                string               `json:"id"`
	TaskID            string               `json:"task_id"`
	Body              string               `json:"body"`
	ExpectedAnswerMD  string               `json:"expected_answer_md"`
	ReferenceCriteria referenceCriteriaDTO `json:"reference_criteria"`
	SortOrder         int                  `json:"sort_order"`
	CreatedAt         time.Time            `json:"created_at"`
}

func toTaskQuestionDTO(q domain.TaskQuestion) taskQuestionDTO {
	return taskQuestionDTO{
		ID: q.ID.String(), TaskID: q.TaskID.String(), Body: q.Body,
		ExpectedAnswerMD: q.ExpectedAnswerMD, ReferenceCriteria: toRCDTO(q.ReferenceCriteria),
		SortOrder: q.SortOrder, CreatedAt: q.CreatedAt,
	}
}

type defaultQuestionDTO struct {
	ID                string               `json:"id"`
	StageKind         string               `json:"stage_kind"`
	Body              string               `json:"body"`
	ExpectedAnswerMD  string               `json:"expected_answer_md"`
	ReferenceCriteria referenceCriteriaDTO `json:"reference_criteria"`
	Active            bool                 `json:"active"`
	SortOrder         int                  `json:"sort_order"`
	CreatedAt         time.Time            `json:"created_at"`
}

func toDefaultQuestionDTO(q domain.DefaultQuestion) defaultQuestionDTO {
	return defaultQuestionDTO{
		ID: q.ID.String(), StageKind: string(q.StageKind), Body: q.Body,
		ExpectedAnswerMD: q.ExpectedAnswerMD, ReferenceCriteria: toRCDTO(q.ReferenceCriteria),
		Active: q.Active, SortOrder: q.SortOrder, CreatedAt: q.CreatedAt,
	}
}

type companyQuestionDTO struct {
	ID                string               `json:"id"`
	CompanyID         string               `json:"company_id"`
	StageKind         string               `json:"stage_kind"`
	Body              string               `json:"body"`
	ExpectedAnswerMD  string               `json:"expected_answer_md"`
	ReferenceCriteria referenceCriteriaDTO `json:"reference_criteria"`
	Active            bool                 `json:"active"`
	SortOrder         int                  `json:"sort_order"`
	CreatedAt         time.Time            `json:"created_at"`
}

func toCompanyQuestionDTO(q domain.CompanyQuestion) companyQuestionDTO {
	return companyQuestionDTO{
		ID: q.ID.String(), CompanyID: q.CompanyID.String(), StageKind: string(q.StageKind),
		Body: q.Body, ExpectedAnswerMD: q.ExpectedAnswerMD,
		ReferenceCriteria: toRCDTO(q.ReferenceCriteria), Active: q.Active,
		SortOrder: q.SortOrder, CreatedAt: q.CreatedAt,
	}
}

type companyStageDTO struct {
	StageKind             string   `json:"stage_kind"`
	Ordinal               int      `json:"ordinal"`
	Optional              bool     `json:"optional"`
	LanguagePool          []string `json:"language_pool"`
	TaskPoolIDs           []string `json:"task_pool_ids"`
	AIStrictnessProfileID *string  `json:"ai_strictness_profile_id"`
}

func toCompanyStageDTO(s domain.CompanyStage) companyStageDTO {
	langs := make([]string, 0, len(s.LanguagePool))
	for _, l := range s.LanguagePool {
		langs = append(langs, string(l))
	}
	taskIDs := make([]string, 0, len(s.TaskPoolIDs))
	for _, t := range s.TaskPoolIDs {
		taskIDs = append(taskIDs, t.String())
	}
	d := companyStageDTO{
		StageKind: string(s.StageKind), Ordinal: s.Ordinal, Optional: s.Optional,
		LanguagePool: langs, TaskPoolIDs: taskIDs,
	}
	if s.AIStrictnessProfileID != nil {
		v := s.AIStrictnessProfileID.String()
		d.AIStrictnessProfileID = &v
	}
	return d
}

func fromCompanyStageDTO(companyID uuid.UUID, d companyStageDTO) (domain.CompanyStage, error) {
	out := domain.CompanyStage{
		CompanyID: companyID,
		StageKind: domain.StageKind(d.StageKind),
		Ordinal:   d.Ordinal,
		Optional:  d.Optional,
	}
	for _, l := range d.LanguagePool {
		out.LanguagePool = append(out.LanguagePool, domain.TaskLanguage(l))
	}
	for _, t := range d.TaskPoolIDs {
		id, err := uuid.Parse(t)
		if err != nil {
			return domain.CompanyStage{}, fmt.Errorf("uuid.Parse task_pool_id: %w", err)
		}
		out.TaskPoolIDs = append(out.TaskPoolIDs, id)
	}
	if d.AIStrictnessProfileID != nil && *d.AIStrictnessProfileID != "" {
		id, err := uuid.Parse(*d.AIStrictnessProfileID)
		if err != nil {
			return domain.CompanyStage{}, fmt.Errorf("uuid.Parse ai_strictness_profile_id: %w", err)
		}
		out.AIStrictnessProfileID = &id
	}
	return out, nil
}

type pipelineStageDTO struct {
	ID                    string     `json:"id"`
	StageKind             string     `json:"stage_kind"`
	Ordinal               int        `json:"ordinal"`
	Status                string     `json:"status"`
	Score                 *float32   `json:"score"`
	Verdict               *string    `json:"verdict"`
	AIFeedbackMD          string     `json:"ai_feedback_md"`
	AIStrictnessProfileID *string    `json:"ai_strictness_profile_id"`
	StartedAt             *time.Time `json:"started_at"`
	FinishedAt            *time.Time `json:"finished_at"`
}

func toPipelineStageDTO(s domain.PipelineStage) pipelineStageDTO {
	d := pipelineStageDTO{
		ID: s.ID.String(), StageKind: string(s.StageKind), Ordinal: s.Ordinal,
		Status: string(s.Status), Score: s.Score, AIFeedbackMD: s.AIFeedbackMD,
		StartedAt: s.StartedAt, FinishedAt: s.FinishedAt,
	}
	if s.Verdict != nil {
		v := string(*s.Verdict)
		d.Verdict = &v
	}
	if s.AIStrictnessProfileID != nil {
		v := s.AIStrictnessProfileID.String()
		d.AIStrictnessProfileID = &v
	}
	return d
}

type pipelineDTO struct {
	ID              string             `json:"id"`
	UserID          string             `json:"user_id"`
	CompanyID       *string            `json:"company_id"`
	AIAssist        bool               `json:"ai_assist"`
	CurrentStageIdx int                `json:"current_stage_idx"`
	Verdict         string             `json:"verdict"`
	TotalScore      *float32           `json:"total_score"`
	StartedAt       time.Time          `json:"started_at"`
	FinishedAt      *time.Time         `json:"finished_at"`
	Stages          []pipelineStageDTO `json:"stages"`
}

func toPipelineDTO(p app.PipelineWithStages) pipelineDTO {
	d := pipelineDTO{
		ID: p.Pipeline.ID.String(), UserID: p.Pipeline.UserID.String(),
		AIAssist: p.Pipeline.AIAssist, CurrentStageIdx: p.Pipeline.CurrentStageIdx,
		Verdict: string(p.Pipeline.Verdict), TotalScore: p.Pipeline.TotalScore,
		StartedAt: p.Pipeline.StartedAt, FinishedAt: p.Pipeline.FinishedAt,
		Stages: make([]pipelineStageDTO, 0, len(p.Stages)),
	}
	if p.Pipeline.CompanyID != nil {
		v := p.Pipeline.CompanyID.String()
		d.CompanyID = &v
	}
	for _, s := range p.Stages {
		d.Stages = append(d.Stages, toPipelineStageDTO(s))
	}
	return d
}

// submitCanvasRequest — Phase D.1 sysdesign-canvas submission payload.
// image_data_url must be a "data:image/png;base64,…" or
// "data:image/jpeg;base64,…" url; the handler enforces shape + 5MB size
// before invoking the orchestrator.
type submitCanvasRequest struct {
	ImageDataURL    string `json:"image_data_url"`
	ContextMD       string `json:"context_md"`
	NonFunctionalMD string `json:"non_functional_md"`
}

// pipelineAttemptDTO — JSON shape of a single attempt (with the resolved
// question body fields) for the /mock/pipelines/{id} extended view.
type pipelineAttemptDTO struct {
	ID                string               `json:"id"`
	Kind              string               `json:"kind"`
	QuestionBody      string               `json:"question_body"`
	ExpectedAnswerMD  string               `json:"expected_answer_md"`
	ReferenceCriteria referenceCriteriaDTO `json:"reference_criteria"`
	UserAnswerMD      string               `json:"user_answer_md"`
	// User-provided sysdesign-canvas extras (Phase D.1). Empty for non-canvas
	// attempts; emitted always for symmetry.
	UserContextMD          string     `json:"user_context_md"`
	UserExcalidrawImageURL string     `json:"user_excalidraw_image_url"`
	AIScore                *float32   `json:"ai_score"`
	AIVerdict              string     `json:"ai_verdict"`
	AIWaterScore           *float32   `json:"ai_water_score"`
	AIFeedbackMD           string     `json:"ai_feedback_md"`
	AIMissingPoints        []string   `json:"ai_missing_points"`
	AIJudgedAt             *time.Time `json:"ai_judged_at"`
	CreatedAt              time.Time  `json:"created_at"`
	// Phase D.2: surface task fields when the attempt is rooted on a
	// mock_tasks row. nil/omitted otherwise so the frontend can branch.
	TaskFunctionalRequirementsMD *string `json:"task_functional_requirements_md,omitempty"`
	TaskLanguage                 *string `json:"task_language,omitempty"`
}

func toPipelineAttemptDTO(a domain.PipelineAttempt, qBody, qExpected string, rc *domain.ReferenceCriteria) pipelineAttemptDTO {
	missing := a.AIMissingPoints
	if missing == nil {
		missing = []string{}
	}
	d := pipelineAttemptDTO{
		ID: a.ID.String(), Kind: string(a.Kind),
		QuestionBody: qBody, ExpectedAnswerMD: qExpected,
		UserAnswerMD:           a.UserAnswerMD,
		UserContextMD:          a.UserContextMD,
		UserExcalidrawImageURL: a.UserExcalidrawImageURL,
		AIScore:                a.AIScore, AIVerdict: string(a.AIVerdict),
		AIWaterScore:    a.AIWaterScore,
		AIFeedbackMD:    a.AIFeedbackMD,
		AIMissingPoints: missing,
		AIJudgedAt:      a.AIJudgedAt,
		CreatedAt:       a.CreatedAt,
	}
	if rc != nil {
		d.ReferenceCriteria = toRCDTO(*rc)
	} else {
		d.ReferenceCriteria = toRCDTO(domain.ReferenceCriteria{})
	}
	return d
}

// pipelineStageWithAttemptsDTO extends pipelineStageDTO with the attempts
// joined under it (Phase B GET shape).
type pipelineStageWithAttemptsDTO struct {
	pipelineStageDTO
	Attempts []pipelineAttemptDTO `json:"attempts"`
}

func toStageWithAttemptsDTO(s app.StageWithAttempts) pipelineStageWithAttemptsDTO {
	out := pipelineStageWithAttemptsDTO{
		pipelineStageDTO: toPipelineStageDTO(s.Stage),
		Attempts:         make([]pipelineAttemptDTO, 0, len(s.Attempts)),
	}
	for _, av := range s.Attempts {
		rc := av.ReferenceCriteria
		dto := toPipelineAttemptDTO(av.Attempt, av.QuestionBody, av.ExpectedAnswerMD, &rc)
		// Only surface the task-scoped fields when the attempt actually
		// references a task (TaskID != nil). For HR / default-question
		// attempts the strings are empty and we keep them null in JSON.
		if av.Attempt.TaskID != nil {
			fr := av.TaskFunctionalRequirementsMD
			lang := av.TaskLanguage
			dto.TaskFunctionalRequirementsMD = &fr
			dto.TaskLanguage = &lang
		}
		out.Attempts = append(out.Attempts, dto)
	}
	return out
}

// pipelineFullDTO — pipeline + stages-with-attempts.
type pipelineFullDTO struct {
	ID              string                         `json:"id"`
	UserID          string                         `json:"user_id"`
	CompanyID       *string                        `json:"company_id"`
	AIAssist        bool                           `json:"ai_assist"`
	CurrentStageIdx int                            `json:"current_stage_idx"`
	Verdict         string                         `json:"verdict"`
	TotalScore      *float32                       `json:"total_score"`
	StartedAt       time.Time                      `json:"started_at"`
	FinishedAt      *time.Time                     `json:"finished_at"`
	Stages          []pipelineStageWithAttemptsDTO `json:"stages"`
}

func toPipelineFullDTO(p app.PipelineFull) pipelineFullDTO {
	d := pipelineFullDTO{
		ID: p.Pipeline.ID.String(), UserID: p.Pipeline.UserID.String(),
		AIAssist: p.Pipeline.AIAssist, CurrentStageIdx: p.Pipeline.CurrentStageIdx,
		Verdict: string(p.Pipeline.Verdict), TotalScore: p.Pipeline.TotalScore,
		StartedAt: p.Pipeline.StartedAt, FinishedAt: p.Pipeline.FinishedAt,
		Stages: make([]pipelineStageWithAttemptsDTO, 0, len(p.Stages)),
	}
	if p.Pipeline.CompanyID != nil {
		v := p.Pipeline.CompanyID.String()
		d.CompanyID = &v
	}
	for _, s := range p.Stages {
		d.Stages = append(d.Stages, toStageWithAttemptsDTO(s))
	}
	return d
}

func toPipelineSummaryDTO(p domain.MockPipeline) pipelineDTO {
	d := pipelineDTO{
		ID: p.ID.String(), UserID: p.UserID.String(),
		AIAssist: p.AIAssist, CurrentStageIdx: p.CurrentStageIdx,
		Verdict: string(p.Verdict), TotalScore: p.TotalScore,
		StartedAt: p.StartedAt, FinishedAt: p.FinishedAt,
		Stages: []pipelineStageDTO{}, // list view doesn't fetch stages
	}
	if p.CompanyID != nil {
		v := p.CompanyID.String()
		d.CompanyID = &v
	}
	return d
}

// leaderboardEntryDTO — wire shape for GET /mock/leaderboard items.
type leaderboardEntryDTO struct {
	Rank              int     `json:"rank"`
	UserID            string  `json:"user_id"`
	DisplayName       string  `json:"display_name"`
	AvatarURL         string  `json:"avatar_url"`
	PipelinesFinished int     `json:"pipelines_finished"`
	PipelinesPassed   int     `json:"pipelines_passed"`
	AvgScore          float32 `json:"avg_score"`
}
