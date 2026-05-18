package ports

import (
	"druz9/ai_mock/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// domain ↔ proto + enum-конвертеры для ai_mock. Вынесены из server.go,
// чтобы handler-функции не тонули в boilerplate.

func toMockSessionProto(s domain.Session, task domain.TaskPublic, msgs []domain.Message) *pb.MockSession {
	out := &pb.MockSession{
		Id:          s.ID.String(),
		Status:      mockStatusToProto(s.Status),
		Section:     sectionToProtoMock(s.Section),
		Difficulty:  difficultyToProtoMock(s.Difficulty),
		DurationMin: int32(s.DurationMin),
		AiAssist:    s.AIAssist,
	}
	if s.CompanyID != uuid.Nil {
		out.CompanyId = s.CompanyID.String()
	}
	if s.StartedAt != nil {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	if s.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(s.FinishedAt.UTC())
	}
	if task.ID != uuid.Nil {
		out.Task = toMockTaskProto(task)
	}
	if len(msgs) > 0 {
		out.LastMessages = make([]*pb.MockMessage, 0, len(msgs))
		for _, m := range msgs {
			out.LastMessages = append(out.LastMessages, toMockMessageProto(m))
		}
	}
	out.StressProfile = &pb.MockStressProfile{
		PausesScore:    int32(s.Stress.PausesScore),
		BackspaceScore: int32(s.Stress.BackspaceScore),
		ChaosScore:     int32(s.Stress.ChaosScore),
		PasteAttempts:  int32(s.Stress.PasteAttempts),
	}
	return out
}

func toMockMessageProto(m domain.Message) *pb.MockMessage {
	out := &pb.MockMessage{
		Id:         m.ID.String(),
		Role:       messageRoleToProto(m.Role),
		Content:    m.Content,
		TokensUsed: int32(m.TokensUsed),
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt.UTC())
	}
	return out
}

func toMockTaskProto(t domain.TaskPublic) *pb.MockTaskPublic {
	return &pb.MockTaskPublic{
		Id:          t.ID.String(),
		Slug:        t.Slug,
		Title:       t.Title,
		Description: t.Description,
		Difficulty:  difficultyToProtoMock(t.Difficulty),
		Section:     sectionToProtoMock(t.Section),
	}
}

func toMockReportProto(sessionID uuid.UUID, d domain.ReportDraft) *pb.MockReport {
	out := &pb.MockReport{
		SessionId:    sessionID.String(),
		Status:       pb.MockReportStatus_MOCK_REPORT_STATUS_READY,
		OverallScore: int32(d.OverallScore),
	}
	out.Sections = &pb.MockReportSections{
		ProblemSolving: scoredSectionToProto(d.Sections.ProblemSolving),
		CodeQuality:    scoredSectionToProto(d.Sections.CodeQuality),
		Communication:  scoredSectionToProto(d.Sections.Communication),
		StressHandling: scoredSectionToProto(d.Sections.StressHandling),
	}
	if len(d.Strengths) > 0 {
		out.Strengths = append([]string{}, d.Strengths...)
	}
	if len(d.Weaknesses) > 0 {
		out.Weaknesses = append([]string{}, d.Weaknesses...)
	}
	if d.StressAnalysis != "" {
		out.StressAnalysis = d.StressAnalysis
	}
	if len(d.Recommendations) > 0 {
		out.Recommendations = make([]*pb.MockRecommendation, 0, len(d.Recommendations))
		for _, r := range d.Recommendations {
			rec := &pb.MockRecommendation{
				Title:       r.Title,
				Description: r.Description,
				Action:      &pb.MockRecommendationAction{Kind: r.ActionKind},
			}
			if r.ActionRef != "" {
				rec.Action.Params = map[string]string{"ref": r.ActionRef}
			}
			out.Recommendations = append(out.Recommendations, rec)
		}
	}
	return out
}

func scoredSectionToProto(s domain.ScoredSection) *pb.MockScoredSection {
	return &pb.MockScoredSection{Score: int32(s.Score), Comment: s.Comment}
}

func sectionToProtoMock(s enums.Section) pb.Section {
	switch s {
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	case enums.SectionEnglishHR:
		return pb.Section_SECTION_ENGLISH_HR
	case enums.SectionSystemDesignSenior:
		return pb.Section_SECTION_SYSTEM_DESIGN_SENIOR
	case enums.SectionTechLeadEM:
		return pb.Section_SECTION_TECH_LEAD_EM
	case enums.SectionSysanalyst:
		return pb.Section_SECTION_SYSANALYST
	case enums.SectionProductAnalyst:
		return pb.Section_SECTION_PRODUCT_ANALYST
	case enums.SectionQA:
		return pb.Section_SECTION_QA
	case enums.SectionDevOps:
		return pb.Section_SECTION_DEVOPS
	case enums.SectionMLEng:
		return pb.Section_SECTION_ML_ENG
	case enums.SectionMLSystemDesign:
		return pb.Section_SECTION_ML_SYSTEM_DESIGN
	case enums.SectionMLCoding:
		return pb.Section_SECTION_ML_CODING
	case enums.SectionMLTheory:
		return pb.Section_SECTION_ML_THEORY
	}
	return pb.Section_SECTION_UNSPECIFIED
}

func sectionFromProtoMock(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_ALGORITHMS:
		return enums.SectionAlgorithms
	case pb.Section_SECTION_SQL:
		return enums.SectionSQL
	case pb.Section_SECTION_GO:
		return enums.SectionGo
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return enums.SectionSystemDesign
	case pb.Section_SECTION_BEHAVIORAL:
		return enums.SectionBehavioral
	case pb.Section_SECTION_ENGLISH_HR:
		return enums.SectionEnglishHR
	case pb.Section_SECTION_SYSTEM_DESIGN_SENIOR:
		return enums.SectionSystemDesignSenior
	case pb.Section_SECTION_TECH_LEAD_EM:
		return enums.SectionTechLeadEM
	case pb.Section_SECTION_SYSANALYST:
		return enums.SectionSysanalyst
	case pb.Section_SECTION_PRODUCT_ANALYST:
		return enums.SectionProductAnalyst
	case pb.Section_SECTION_QA:
		return enums.SectionQA
	case pb.Section_SECTION_DEVOPS:
		return enums.SectionDevOps
	case pb.Section_SECTION_ML_ENG:
		return enums.SectionMLEng
	case pb.Section_SECTION_ML_SYSTEM_DESIGN:
		return enums.SectionMLSystemDesign
	case pb.Section_SECTION_ML_CODING:
		return enums.SectionMLCoding
	case pb.Section_SECTION_ML_THEORY:
		return enums.SectionMLTheory
	}
	return ""
}

func difficultyToProtoMock(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	}
	return pb.Difficulty_DIFFICULTY_UNSPECIFIED
}

func difficultyFromProtoMock(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	}
	return ""
}

func mockStatusToProto(s enums.MockStatus) pb.MockStatus {
	switch s {
	case enums.MockStatusCreated:
		return pb.MockStatus_MOCK_STATUS_CREATED
	case enums.MockStatusInProgress:
		return pb.MockStatus_MOCK_STATUS_IN_PROGRESS
	case enums.MockStatusFinished:
		return pb.MockStatus_MOCK_STATUS_FINISHED
	case enums.MockStatusAbandoned:
		return pb.MockStatus_MOCK_STATUS_ABANDONED
	}
	return pb.MockStatus_MOCK_STATUS_UNSPECIFIED
}

func messageRoleToProto(r enums.MessageRole) pb.MessageRole {
	switch r {
	case enums.MessageRoleSystem:
		return pb.MessageRole_MESSAGE_ROLE_SYSTEM
	case enums.MessageRoleUser:
		return pb.MessageRole_MESSAGE_ROLE_USER
	case enums.MessageRoleAssistant:
		return pb.MessageRole_MESSAGE_ROLE_ASSISTANT
	}
	return pb.MessageRole_MESSAGE_ROLE_UNSPECIFIED
}

func llmModelFromProto(m pb.LLMModel) enums.LLMModel {
	switch m {
	case pb.LLMModel_LLM_MODEL_GPT_4O_MINI:
		return enums.LLMModelGPT4oMini
	case pb.LLMModel_LLM_MODEL_GPT_4O:
		return enums.LLMModelGPT4o
	case pb.LLMModel_LLM_MODEL_CLAUDE_SONNET_4:
		return enums.LLMModelClaudeSonnet4
	case pb.LLMModel_LLM_MODEL_GEMINI_PRO:
		return enums.LLMModelGeminiPro
	case pb.LLMModel_LLM_MODEL_MISTRAL_7B:
		return enums.LLMModelMistral7B
	}
	return ""
}

func editorEventTypeFromProto(t pb.EditorEventType) domain.EditorEventType {
	switch t {
	case pb.EditorEventType_EDITOR_EVENT_TYPE_PAUSE:
		return domain.EditorEventPause
	case pb.EditorEventType_EDITOR_EVENT_TYPE_BACKSPACE_BURST:
		return domain.EditorEventBackspaceBurst
	case pb.EditorEventType_EDITOR_EVENT_TYPE_CHAOTIC_EDIT:
		return domain.EditorEventChaoticEdit
	case pb.EditorEventType_EDITOR_EVENT_TYPE_PASTE_ATTEMPT:
		return domain.EditorEventPasteAttempt
	case pb.EditorEventType_EDITOR_EVENT_TYPE_IDLE:
		return domain.EditorEventIdle
	}
	return ""
}
