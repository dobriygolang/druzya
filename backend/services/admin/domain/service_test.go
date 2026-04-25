package domain

import (
	"errors"
	"strings"
	"testing"

	"druz9/shared/enums"
)

// okTask returns a TaskUpsert that satisfies every validation rule — tests
// mutate one field to exercise a specific branch.
func okTask() TaskUpsert {
	return TaskUpsert{
		Slug:          "two-sum",
		TitleRU:       "Две суммы",
		TitleEN:       "Two Sum",
		DescriptionRU: "Описание",
		DescriptionEN: "Description",
		Difficulty:    enums.DifficultyEasy,
		Section:       enums.SectionAlgorithms,
		TimeLimitSec:  5,
		MemoryLimitMB: 256,
		IsActive:      true,
		TestCases: []TestCase{
			{Input: "a", ExpectedOutput: "A", IsHidden: false, OrderNum: 0},
			{Input: "b", ExpectedOutput: "B", IsHidden: false, OrderNum: 1},
			{Input: "c", ExpectedOutput: "C", IsHidden: false, OrderNum: 2},
			{Input: "d", ExpectedOutput: "D", IsHidden: true, OrderNum: 3},
			{Input: "e", ExpectedOutput: "E", IsHidden: true, OrderNum: 4},
		},
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ValidateTaskUpsert
// ─────────────────────────────────────────────────────────────────────────

func TestValidateTaskUpsert_HappyPath(t *testing.T) {
	t.Parallel()
	if err := ValidateTaskUpsert(okTask()); err != nil {
		t.Fatalf("happy path must pass, got %v", err)
	}
}

func TestValidateTaskUpsert_SlugRules(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		slug string
	}{
		{"empty", ""},
		{"leading dash", "-foo"},
		{"trailing dash", "foo-"},
		{"uppercase", "TwoSum"},
		{"underscore", "two_sum"},
		{"space", "two sum"},
		{"double dash", "two--sum"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			in := okTask()
			in.Slug = c.slug
			if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("slug %q should fail, got %v", c.slug, err)
			}
		})
	}
}

func TestValidateTaskUpsert_EmptyTitleDescriptionRejected(t *testing.T) {
	t.Parallel()
	for _, mut := range []func(u *TaskUpsert){
		func(u *TaskUpsert) { u.TitleRU = "   " },
		func(u *TaskUpsert) { u.TitleEN = "" },
		func(u *TaskUpsert) { u.DescriptionRU = "" },
		func(u *TaskUpsert) { u.DescriptionEN = "\t\n" },
	} {
		in := okTask()
		mut(&in)
		if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("blank title/description must fail")
		}
	}
}

func TestValidateTaskUpsert_InvalidEnumsRejected(t *testing.T) {
	t.Parallel()
	in := okTask()
	in.Section = enums.Section("unknown")
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown section must fail")
	}

	in = okTask()
	in.Difficulty = enums.Difficulty("xxl")
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown difficulty must fail")
	}
}

func TestValidateTaskUpsert_LimitsRejected(t *testing.T) {
	t.Parallel()
	in := okTask()
	in.TimeLimitSec = 0
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("zero time limit must fail")
	}

	in = okTask()
	in.TimeLimitSec = MaxTimeLimitSec + 1
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("excess time limit must fail")
	}

	in = okTask()
	in.MemoryLimitMB = 0
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("zero memory must fail")
	}
}

func TestValidateTaskUpsert_InvalidTemplateLanguage(t *testing.T) {
	t.Parallel()
	in := okTask()
	in.Templates = []TaskTemplate{{Language: enums.Language("cobol"), StarterCode: "..."}}
	if err := ValidateTaskUpsert(in); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown template language must fail")
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ValidateTestCases
// ─────────────────────────────────────────────────────────────────────────

func TestValidateTestCases_FloorsEnforced(t *testing.T) {
	t.Parallel()
	// Missing an open case.
	cases := []TestCase{
		{IsHidden: false}, {IsHidden: false},
		{IsHidden: true}, {IsHidden: true},
	}
	if err := ValidateTestCases(cases); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("need ≥ %d open cases; should fail", MinOpenTestCases)
	}

	// Missing a hidden case.
	cases = []TestCase{
		{IsHidden: false}, {IsHidden: false}, {IsHidden: false},
		{IsHidden: true},
	}
	if err := ValidateTestCases(cases); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("need ≥ %d hidden cases; should fail", MinHiddenTestCases)
	}

	// Both floors satisfied — should pass.
	cases = []TestCase{
		{IsHidden: false}, {IsHidden: false}, {IsHidden: false},
		{IsHidden: true}, {IsHidden: true},
	}
	if err := ValidateTestCases(cases); err != nil {
		t.Fatalf("floor-exact input must pass, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ValidateCompanyUpsert
// ─────────────────────────────────────────────────────────────────────────

func TestValidateCompanyUpsert_HappyPath(t *testing.T) {
	t.Parallel()
	in := CompanyUpsert{
		Slug:        "yandex",
		Name:        "Yandex",
		Description: "Тех-собес: алгоритмы + sql + go.",
		LogoURL:     "https://cdn.druz9.online/logos/yandex.png",
		Active:      true,
	}
	if err := ValidateCompanyUpsert(in); err != nil {
		t.Fatalf("happy path must pass, got %v", err)
	}
}

func TestValidateCompanyUpsert_BadInputs(t *testing.T) {
	t.Parallel()
	longDesc := strings.Repeat("x", 2001)
	bad := []CompanyUpsert{
		{Slug: "", Name: "Y"},                                            // empty slug
		{Slug: "Yandex!", Name: "Y"},                                     // bad slug chars
		{Slug: "yandex", Name: "   "},                                    // whitespace name
		{Slug: "yandex", Name: "Y", Description: longDesc},               // description over cap
		{Slug: "yandex", Name: "Y", LogoURL: "ftp://yandex.ru/logo.png"}, // bad logo scheme
	}
	for i, in := range bad {
		if err := ValidateCompanyUpsert(in); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("case %d should fail, got %v", i, err)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ValidateConfigValue
// ─────────────────────────────────────────────────────────────────────────

func TestValidateConfigValue_TypeMatrix(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		key   string
		value string
		typ   ConfigType
		ok    bool
	}{
		{"int ok", "arena_workers", "5", ConfigTypeInt, true},
		{"int reject float", "arena_workers", "5.5", ConfigTypeInt, false},
		{"int reject string", "arena_workers", `"5"`, ConfigTypeInt, false},
		{"float ok", "weight", "0.42", ConfigTypeFloat, true},
		{"float reject string", "weight", `"0.42"`, ConfigTypeFloat, false},
		{"string ok", "greeting", `"hi"`, ConfigTypeString, true},
		{"string reject number", "greeting", "42", ConfigTypeString, false},
		{"bool ok", "flag", "true", ConfigTypeBool, true},
		{"bool reject string", "flag", `"true"`, ConfigTypeBool, false},
		{"json object ok", "payload", `{"a":1}`, ConfigTypeJSON, true},
		{"json array ok", "payload", `[1,2,3]`, ConfigTypeJSON, true},
		{"json malformed", "payload", `{not-json`, ConfigTypeJSON, false},
		{"empty key", "", "42", ConfigTypeInt, false},
		{"unknown type", "k", "1", ConfigType("xxx"), false},
		{"empty value", "k", "", ConfigTypeInt, false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			err := ValidateConfigValue(c.key, []byte(c.value), c.typ)
			if c.ok && err != nil {
				t.Fatalf("expected ok, got %v", err)
			}
			if !c.ok && err == nil {
				t.Fatalf("expected error for %s", c.name)
			}
			if !c.ok && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ConfigType.IsValid sanity (exhaustive switch surface).
// ─────────────────────────────────────────────────────────────────────────

func TestConfigType_IsValid(t *testing.T) {
	t.Parallel()
	known := []ConfigType{ConfigTypeInt, ConfigTypeFloat, ConfigTypeString, ConfigTypeBool, ConfigTypeJSON}
	for _, k := range known {
		if !k.IsValid() {
			t.Fatalf("%s should be valid", k)
		}
	}
	if ConfigType("nope").IsValid() {
		t.Fatalf("unknown type must be invalid")
	}
}
