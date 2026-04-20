package enums

type MockStatus string

const (
	MockStatusCreated    MockStatus = "created"
	MockStatusInProgress MockStatus = "in_progress"
	MockStatusFinished   MockStatus = "finished"
	MockStatusAbandoned  MockStatus = "abandoned"
)

func (s MockStatus) IsValid() bool {
	switch s {
	case MockStatusCreated, MockStatusInProgress, MockStatusFinished, MockStatusAbandoned:
		return true
	}
	return false
}

func (s MockStatus) String() string { return string(s) }

type MessageRole string

const (
	MessageRoleSystem    MessageRole = "system"
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
)

func (r MessageRole) IsValid() bool {
	switch r {
	case MessageRoleSystem, MessageRoleUser, MessageRoleAssistant:
		return true
	}
	return false
}

func (r MessageRole) String() string { return string(r) }

type ProvenanceKind string

const (
	ProvenanceKindAIGenerated      ProvenanceKind = "ai_generated"
	ProvenanceKindHumanWritten     ProvenanceKind = "human_written"
	ProvenanceKindAIRevisedByHuman ProvenanceKind = "ai_revised_by_human"
	ProvenanceKindAIRejected       ProvenanceKind = "ai_rejected"
)

func (k ProvenanceKind) IsValid() bool {
	switch k {
	case ProvenanceKindAIGenerated, ProvenanceKindHumanWritten,
		ProvenanceKindAIRevisedByHuman, ProvenanceKindAIRejected:
		return true
	}
	return false
}

func (k ProvenanceKind) String() string { return string(k) }
