// Package domain contains the entities, value objects and repository interfaces
// for the admin bounded context. No external framework imports here.
//
// The admin domain is a CMS/ops surface (bible §3.14). Curators manage tasks,
// companies and dynamic config; ops review anticheat signals. Read-heavy for
// dashboards, plus write for curators.
//
// solution_hint — IMPORTANT: every other domain treats tasks.solution_hint as
// a secret that MUST NEVER cross the HTTP boundary. Admin is the one
// exception: curators explicitly need to author + review the hint text. The
// role check at the ports layer is the load-bearing guard.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Tasks — full curator projection with solution_hint.
// ─────────────────────────────────────────────────────────────────────────

// AdminTask is the curator-facing task projection. Unlike TaskPublic, it
// carries SolutionHint verbatim — the role check at ports is the guard.
type AdminTask struct {
	ID            uuid.UUID
	Slug          string
	TitleRU       string
	TitleEN       string
	DescriptionRU string
	DescriptionEN string
	Difficulty    enums.Difficulty
	Section       enums.Section
	TimeLimitSec  int
	MemoryLimitMB int
	SolutionHint  string
	Version       int
	IsActive      bool
	CreatedAt     time.Time
	UpdatedAt     time.Time

	TestCases         []TestCase
	FollowUpQuestions []FollowUpQuestion
	Templates         []TaskTemplate
}

// TestCase mirrors the test_cases row.
type TestCase struct {
	ID             uuid.UUID
	Input          string
	ExpectedOutput string
	IsHidden       bool
	OrderNum       int
}

// FollowUpQuestion mirrors the follow_up_questions row.
type FollowUpQuestion struct {
	ID         uuid.UUID
	QuestionRU string
	QuestionEN string
	AnswerHint string
	OrderNum   int
}

// TaskTemplate mirrors the task_templates row — starter code per language.
type TaskTemplate struct {
	Language    enums.Language
	StarterCode string
}

// TaskUpsert is the curator-supplied payload for POST/PUT /admin/tasks. It
// excludes server-computed fields (ID, Version, timestamps).
type TaskUpsert struct {
	Slug              string
	TitleRU           string
	TitleEN           string
	DescriptionRU     string
	DescriptionEN     string
	Difficulty        enums.Difficulty
	Section           enums.Section
	TimeLimitSec      int
	MemoryLimitMB     int
	SolutionHint      string
	IsActive          bool
	TestCases         []TestCase
	FollowUpQuestions []FollowUpQuestion
	Templates         []TaskTemplate
}

// TaskFilter is the optional set of predicates on GET /admin/tasks.
type TaskFilter struct {
	Section    *enums.Section
	Difficulty *enums.Difficulty
	IsActive   *bool
	Page       int
	Limit      int
}

// TaskPage is a paginated listing result.
type TaskPage struct {
	Items []AdminTask
	Total int
	Page  int
}

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

// AdminCompany mirrors the companies row (curator projection).
type AdminCompany struct {
	ID               uuid.UUID
	Slug             string
	Name             string
	Difficulty       enums.DungeonTier
	MinLevelRequired int
	Sections         []enums.Section
	CreatedAt        time.Time
}

// CompanyUpsert is the curator-supplied payload for POST /admin/companies.
type CompanyUpsert struct {
	Slug             string
	Name             string
	Difficulty       enums.DungeonTier
	MinLevelRequired int
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

// ConfigType enumerates the valid entries in dynamic_config.type.
type ConfigType string

const (
	ConfigTypeInt    ConfigType = "int"
	ConfigTypeFloat  ConfigType = "float"
	ConfigTypeString ConfigType = "string"
	ConfigTypeBool   ConfigType = "bool"
	ConfigTypeJSON   ConfigType = "json"
)

// IsValid powers `exhaustive` switches.
func (t ConfigType) IsValid() bool {
	switch t {
	case ConfigTypeInt, ConfigTypeFloat, ConfigTypeString, ConfigTypeBool, ConfigTypeJSON:
		return true
	}
	return false
}

// String satisfies fmt.Stringer.
func (t ConfigType) String() string { return string(t) }

// ConfigEntry mirrors a dynamic_config row.
//
// Value is stored as raw JSON — the adapter marshals/unmarshals on the way in
// and out. The type discriminator keeps the on-wire shape consistent.
type ConfigEntry struct {
	Key         string
	Value       []byte
	Type        ConfigType
	Description string
	UpdatedAt   time.Time
	UpdatedBy   *uuid.UUID
}

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

// AnticheatSignal mirrors anticheat_signals joined against users for the
// username dashboard column.
type AnticheatSignal struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Username  string
	MatchID   *uuid.UUID
	Type      enums.AnticheatSignalType
	Severity  enums.SeverityLevel
	Metadata  []byte
	CreatedAt time.Time
}

// AnticheatFilter is the optional set of predicates on GET /admin/anticheat.
type AnticheatFilter struct {
	Severity *enums.SeverityLevel
	From     *time.Time
	Limit    int
}
