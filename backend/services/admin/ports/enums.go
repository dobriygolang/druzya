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

func dungeonTierToProto(t enums.DungeonTier) pb.DungeonTier {
	switch t {
	case enums.DungeonTierNormal:
		return pb.DungeonTier_DUNGEON_TIER_NORMAL
	case enums.DungeonTierHard:
		return pb.DungeonTier_DUNGEON_TIER_HARD
	case enums.DungeonTierBoss:
		return pb.DungeonTier_DUNGEON_TIER_BOSS
	default:
		return pb.DungeonTier_DUNGEON_TIER_UNSPECIFIED
	}
}

func dungeonTierFromProto(t pb.DungeonTier) enums.DungeonTier {
	switch t {
	case pb.DungeonTier_DUNGEON_TIER_UNSPECIFIED:
		return ""
	case pb.DungeonTier_DUNGEON_TIER_NORMAL:
		return enums.DungeonTierNormal
	case pb.DungeonTier_DUNGEON_TIER_HARD:
		return enums.DungeonTierHard
	case pb.DungeonTier_DUNGEON_TIER_BOSS:
		return enums.DungeonTierBoss
	default:
		return ""
	}
}

func severityToProto(s enums.SeverityLevel) pb.SeverityLevel {
	switch s {
	case enums.SeverityLow:
		return pb.SeverityLevel_SEVERITY_LEVEL_LOW
	case enums.SeverityMedium:
		return pb.SeverityLevel_SEVERITY_LEVEL_MEDIUM
	case enums.SeverityHigh:
		return pb.SeverityLevel_SEVERITY_LEVEL_HIGH
	default:
		return pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED
	}
}

func severityFromProto(s pb.SeverityLevel) enums.SeverityLevel {
	switch s {
	case pb.SeverityLevel_SEVERITY_LEVEL_UNSPECIFIED:
		return ""
	case pb.SeverityLevel_SEVERITY_LEVEL_LOW:
		return enums.SeverityLow
	case pb.SeverityLevel_SEVERITY_LEVEL_MEDIUM:
		return enums.SeverityMedium
	case pb.SeverityLevel_SEVERITY_LEVEL_HIGH:
		return enums.SeverityHigh
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
