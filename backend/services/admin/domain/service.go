package domain

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// Task validation
//
// Rules:
//   - slug must be non-empty, slug-friendly (ASCII lowercase + digits + '-').
//   - titles / descriptions must be non-empty for both locales.
//   - section + difficulty must be known enum values.
//   - limits must be positive and within sane ceilings.
//   - test_cases must carry at least MinOpenTestCases open (is_hidden=false)
//     AND MinHiddenTestCases hidden (is_hidden=true) — bible §3.14.
// ─────────────────────────────────────────────────────────────────────────

const (
	// MinOpenTestCases is the floor on visible-to-user examples per task.
	MinOpenTestCases = 3
	// MinHiddenTestCases is the floor on judge-only test cases per task.
	MinHiddenTestCases = 2

	// MaxTimeLimitSec ceiling — Judge0 default sandbox cap.
	MaxTimeLimitSec = 30
	// MaxMemoryLimitMB ceiling — matches Judge0 container budget.
	MaxMemoryLimitMB = 1024
)

// ValidateTaskUpsert returns nil if the upsert payload is a well-formed
// candidate for CREATE/UPDATE. It does NOT hit the DB — uniqueness on slug is
// delegated to the repo which maps the PG unique-violation onto ErrConflict.
func ValidateTaskUpsert(in TaskUpsert) error {
	if !isValidSlug(in.Slug) {
		return fmt.Errorf("%w: slug %q must be non-empty, ascii lowercase, digits or '-'", ErrInvalidInput, in.Slug)
	}
	if strings.TrimSpace(in.TitleRU) == "" || strings.TrimSpace(in.TitleEN) == "" {
		return fmt.Errorf("%w: title_ru and title_en are required", ErrInvalidInput)
	}
	if strings.TrimSpace(in.DescriptionRU) == "" || strings.TrimSpace(in.DescriptionEN) == "" {
		return fmt.Errorf("%w: description_ru and description_en are required", ErrInvalidInput)
	}
	if !in.Section.IsValid() {
		return fmt.Errorf("%w: invalid section %q", ErrInvalidInput, in.Section)
	}
	if !in.Difficulty.IsValid() {
		return fmt.Errorf("%w: invalid difficulty %q", ErrInvalidInput, in.Difficulty)
	}
	if in.TimeLimitSec <= 0 || in.TimeLimitSec > MaxTimeLimitSec {
		return fmt.Errorf("%w: time_limit_sec must be in (0, %d]", ErrInvalidInput, MaxTimeLimitSec)
	}
	if in.MemoryLimitMB <= 0 || in.MemoryLimitMB > MaxMemoryLimitMB {
		return fmt.Errorf("%w: memory_limit_mb must be in (0, %d]", ErrInvalidInput, MaxMemoryLimitMB)
	}
	if err := ValidateTestCases(in.TestCases); err != nil {
		return err
	}
	for i, t := range in.Templates {
		if !t.Language.IsValid() {
			return fmt.Errorf("%w: templates[%d].language %q", ErrInvalidInput, i, t.Language)
		}
	}
	return nil
}

// ValidateTestCases enforces the MinOpenTestCases / MinHiddenTestCases floors.
func ValidateTestCases(cases []TestCase) error {
	var open, hidden int
	for _, c := range cases {
		if c.IsHidden {
			hidden++
		} else {
			open++
		}
	}
	if open < MinOpenTestCases {
		return fmt.Errorf("%w: need at least %d open test cases (got %d)", ErrInvalidInput, MinOpenTestCases, open)
	}
	if hidden < MinHiddenTestCases {
		return fmt.Errorf("%w: need at least %d hidden test cases (got %d)", ErrInvalidInput, MinHiddenTestCases, hidden)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Company validation
// ─────────────────────────────────────────────────────────────────────────

// ValidateCompanyUpsert checks the POST /admin/companies payload. slug must
// be URL-safe, name non-empty and difficulty one of the DungeonTier values.
func ValidateCompanyUpsert(in CompanyUpsert) error {
	if !isValidSlug(in.Slug) {
		return fmt.Errorf("%w: slug %q must be ascii lowercase, digits or '-'", ErrInvalidInput, in.Slug)
	}
	if strings.TrimSpace(in.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidInput)
	}
	if !in.Difficulty.IsValid() {
		return fmt.Errorf("%w: invalid difficulty %q", ErrInvalidInput, in.Difficulty)
	}
	if in.MinLevelRequired < 0 {
		return fmt.Errorf("%w: min_level_required must be non-negative", ErrInvalidInput)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Config validation
//
// The update endpoint receives a free-form JSON scalar/object. The config
// row's declared type discriminates which shapes are acceptable: int / float
// / string / bool / json. Invariants:
//
//   - int  → JSON number that round-trips through strconv.ParseInt.
//   - float → JSON number.
//   - string → JSON string.
//   - bool → JSON boolean.
//   - json → any JSON-decodable value (object / array / scalar).
// ─────────────────────────────────────────────────────────────────────────

// ValidateConfigValue returns nil if `value` (raw JSON payload) conforms to
// the declared ConfigType.
//
// `key` is included only for error messages; this function does not verify
// key naming rules — uniqueness + existence is the repo's concern.
func ValidateConfigValue(key string, value []byte, t ConfigType) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("%w: key is required", ErrInvalidInput)
	}
	if !t.IsValid() {
		return fmt.Errorf("%w: invalid config type %q", ErrInvalidInput, t)
	}
	if len(value) == 0 {
		return fmt.Errorf("%w: value payload is empty", ErrInvalidInput)
	}
	// Decode into a permissive shape so we can introspect the JSON kind.
	var raw any
	if err := json.Unmarshal(value, &raw); err != nil {
		return fmt.Errorf("%w: malformed json value: %v", ErrInvalidInput, err)
	}
	switch t {
	case ConfigTypeInt:
		// json.Unmarshal into `any` yields float64 for numbers — we re-parse the
		// raw bytes via strconv to ensure the value is an integer literal.
		s := strings.TrimSpace(string(value))
		if _, err := strconv.ParseInt(s, 10, 64); err != nil {
			return fmt.Errorf("%w: value for type=int must be an integer literal: %v", ErrInvalidInput, err)
		}
	case ConfigTypeFloat:
		if _, ok := raw.(float64); !ok {
			return fmt.Errorf("%w: value for type=float must be a number", ErrInvalidInput)
		}
	case ConfigTypeString:
		if _, ok := raw.(string); !ok {
			return fmt.Errorf("%w: value for type=string must be a string", ErrInvalidInput)
		}
	case ConfigTypeBool:
		if _, ok := raw.(bool); !ok {
			return fmt.Errorf("%w: value for type=bool must be a boolean", ErrInvalidInput)
		}
	case ConfigTypeJSON:
		// Anything that parses is acceptable — `raw` is non-nil by construction.
		_ = raw
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// isValidSlug is a narrow slug validator: ASCII lowercase letters, digits,
// '-'. Non-empty. Rejects trailing/leading '-' and consecutive dashes to keep
// URL paths clean.
func isValidSlug(s string) bool {
	if s == "" {
		return false
	}
	if s[0] == '-' || s[len(s)-1] == '-' {
		return false
	}
	prevDash := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			prevDash = false
		case c == '-':
			if prevDash {
				return false
			}
			prevDash = true
		default:
			return false
		}
	}
	return true
}

// allSections / allDifficulties are helpers kept here so the service layer
// does not import shared/enums directly in every call site.
var (
	_ = enums.AllSections
)
