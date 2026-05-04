package ports

import (
	"druz9/admin/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
)

// ─────────────────────────────────────────────────────────────────────────
// Enum adapters
// ─────────────────────────────────────────────────────────────────────────

func sectionToProtoAdmin(s enums.Section) pb.Section {
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
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func sectionFromProtoAdmin(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
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
	default:
		return ""
	}
}

func difficultyToProtoAdmin(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	default:
		return pb.Difficulty_DIFFICULTY_UNSPECIFIED
	}
}

func difficultyFromProtoAdmin(d pb.Difficulty) enums.Difficulty {
	switch d {
	case pb.Difficulty_DIFFICULTY_UNSPECIFIED:
		return ""
	case pb.Difficulty_DIFFICULTY_EASY:
		return enums.DifficultyEasy
	case pb.Difficulty_DIFFICULTY_MEDIUM:
		return enums.DifficultyMedium
	case pb.Difficulty_DIFFICULTY_HARD:
		return enums.DifficultyHard
	default:
		return ""
	}
}

func configTypeToProto(t domain.ConfigType) pb.ConfigEntryType {
	switch t {
	case domain.ConfigTypeInt:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_INT
	case domain.ConfigTypeFloat:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_FLOAT
	case domain.ConfigTypeString:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_STRING
	case domain.ConfigTypeBool:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_BOOL
	case domain.ConfigTypeJSON:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_JSON
	default:
		return pb.ConfigEntryType_CONFIG_ENTRY_TYPE_UNSPECIFIED
	}
}
