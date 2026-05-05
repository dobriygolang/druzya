package ports

import (
	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
)

// ─────────────────────────────────────────────────────────────────────────
// Enum adapters
// ─────────────────────────────────────────────────────────────────────────

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
