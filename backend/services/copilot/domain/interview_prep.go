// Package domain — interview-prep wizard shapes.
//
// The interview-prep wizard runs INSIDE Cue before a real interview:
//  1. user uploads CV (text or PDF — main process extracts via pdf.js);
//  2. user pastes/links JD;
//  3. backend ParseCV + ParseJD return structured shapes;
//  4. user reviews + commits → StartInterviewPrep creates an active row;
//  5. every subsequent Analyze / Chat / Suggest turn the Cue desktop fires
//     consults this row server-side and prepends a tailored system block.
//
// The shape here is the DOMAIN projection — bytes round-trip through
// jsonb in interview_prep_sessions, but use cases speak in these structs.
// Mirrors druz9.v1.ParsedCV / ParsedJD intentionally (keep proto + domain
// in lockstep so the converter is a 1:1 field copy in ports/server.go).
package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrNoActivePrep — no active interview_prep_sessions row for the user.
// Returned by InterviewPrepRepo.GetActive. The app layer maps it to a
// canonical "GetActive returns ok=false" response (NOT an error to the
// client — empty prep is the steady-state).
var ErrNoActivePrep = errors.New("copilot: no active interview prep")

// ParsedCV — what the LLM extracted from the user's résumé. Every field
// is optional; the parser leaves blanks rather than fabricating data.
// JSON tags match the jsonb column shape so the adapter is a 1:1
// json.Marshal round-trip.
type ParsedCV struct {
	Name            string   `json:"name,omitempty"`
	ExperienceYears int      `json:"experience_years,omitempty"`
	CurrentRole     string   `json:"current_role,omitempty"`
	TopSkills       []string `json:"top_skills,omitempty"`
	Summary         string   `json:"summary,omitempty"`
	Education       string   `json:"education,omitempty"`
}

// IsEmpty reports whether the parsed shape carries any usable signal.
// Used by the suggestion-injection path to skip system-prompt emit when
// the parser produced nothing.
func (p ParsedCV) IsEmpty() bool {
	return strings.TrimSpace(p.Name) == "" &&
		p.ExperienceYears == 0 &&
		strings.TrimSpace(p.CurrentRole) == "" &&
		len(p.TopSkills) == 0 &&
		strings.TrimSpace(p.Summary) == "" &&
		strings.TrimSpace(p.Education) == ""
}

// ParsedJD — what the LLM extracted from the job description.
type ParsedJD struct {
	Company            string   `json:"company,omitempty"`
	Role               string   `json:"role,omitempty"`
	Seniority          string   `json:"seniority,omitempty"`
	KeySkills          []string `json:"key_skills,omitempty"`
	DescriptionSummary string   `json:"description_summary,omitempty"`
	Language           string   `json:"language,omitempty"`
}

// IsEmpty mirrors ParsedCV.IsEmpty.
func (p ParsedJD) IsEmpty() bool {
	return strings.TrimSpace(p.Company) == "" &&
		strings.TrimSpace(p.Role) == "" &&
		strings.TrimSpace(p.Seniority) == "" &&
		len(p.KeySkills) == 0 &&
		strings.TrimSpace(p.DescriptionSummary) == "" &&
		strings.TrimSpace(p.Language) == ""
}

// InterviewPrep is the persisted row. CVText / JDText are the raw inputs
// (so a future re-parse doesn't require re-upload); ParsedCV / ParsedJD
// are the structured projections. EndedAt is nil while the row is
// active; the partial unique index in DB v108 enforces ≤1 active row
// per user.
type InterviewPrep struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	ParsedCV  ParsedCV
	ParsedJD  ParsedJD
	CVText    string
	JDText    string
	Company   string // denormalised from ParsedJD.Company for cheap reads
	Role      string // denormalised from ParsedJD.Role
	StartedAt time.Time
	EndedAt   *time.Time
}

// FormatInterviewPrepBlock assembles the system-message body Cue injects
// into the LLM call when this user has an active prep. Returns "" when
// the prep carries no usable signal (saves tokens).
//
// Block lives AFTER the cross-product UserContext block (so the LLM
// reads identity-prior first, then tailored interview prior). Ordering
// matters because LLMs anchor on the most recent system message — we
// want the interview prior to dominate.
//
// Token budget: target ~200-300 tokens. Hard caps per section keep it
// from ballooning if the LLM produces a huge ParsedCV.Summary.
func FormatInterviewPrepBlock(p InterviewPrep) string {
	if p.ParsedCV.IsEmpty() && p.ParsedJD.IsEmpty() {
		return ""
	}
	var b strings.Builder
	b.WriteString("INTERVIEW PREP CONTEXT (user uploaded CV+JD before this interview — tailor every answer to fit):\n")

	// ── JD first: the LLM should know WHAT IS BEING ASKED before WHO IS
	// ANSWERING. Reverse order means the model anchors on the
	// candidate's strengths and frames every answer from "user-centric"
	// rather than "role-required" — wrong bias for interview prep.
	if !p.ParsedJD.IsEmpty() {
		b.WriteString("Target role: ")
		b.WriteString(formatJDLine(p.ParsedJD))
		b.WriteByte('\n')
		if s := strings.TrimSpace(p.ParsedJD.DescriptionSummary); s != "" {
			b.WriteString("Role summary: ")
			b.WriteString(truncatePromptLine(s, 320))
			b.WriteByte('\n')
		}
		if len(p.ParsedJD.KeySkills) > 0 {
			b.WriteString("Required skills: ")
			b.WriteString(strings.Join(topN(p.ParsedJD.KeySkills, 10), ", "))
			b.WriteByte('\n')
		}
	}

	// ── CV next: candidate background as a system-message prior. The
	// LLM uses this to:
	//   - tailor STAR examples to the user's actual jobs;
	//   - prefer programming languages / frameworks the user actually
	//     knows over generic textbook answers;
	//   - flag mismatches ("this JD wants Rust, your CV says Go" — but
	//     ONLY when relevant, NEVER as the lead).
	if !p.ParsedCV.IsEmpty() {
		b.WriteString("Candidate: ")
		b.WriteString(formatCVLine(p.ParsedCV))
		b.WriteByte('\n')
		if s := strings.TrimSpace(p.ParsedCV.Summary); s != "" {
			b.WriteString("CV summary: ")
			b.WriteString(truncatePromptLine(s, 320))
			b.WriteByte('\n')
		}
		if len(p.ParsedCV.TopSkills) > 0 {
			b.WriteString("Top skills: ")
			b.WriteString(strings.Join(topN(p.ParsedCV.TopSkills, 10), ", "))
			b.WriteByte('\n')
		}
		if s := strings.TrimSpace(p.ParsedCV.Education); s != "" {
			b.WriteString("Education: ")
			b.WriteString(truncatePromptLine(s, 200))
			b.WriteByte('\n')
		}
	}

	// Closing guidance — keeps the LLM from over-quoting the prep
	// block. Same pattern as the cross-product UserContext block.
	b.WriteString("Prioritise answers tailored for THIS exact interview. " +
		"Reference user's real experience when it strengthens the answer. " +
		"Do NOT quote this block verbatim — use it as background only.")
	return b.String()
}

func formatJDLine(jd ParsedJD) string {
	parts := make([]string, 0, 3)
	if s := strings.TrimSpace(jd.Company); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(jd.Role); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(jd.Seniority); s != "" {
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "unspecified"
	}
	return strings.Join(parts, " · ")
}

func formatCVLine(cv ParsedCV) string {
	parts := make([]string, 0, 3)
	if s := strings.TrimSpace(cv.Name); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(cv.CurrentRole); s != "" {
		parts = append(parts, s)
	}
	if cv.ExperienceYears > 0 {
		years := "yrs"
		if cv.ExperienceYears == 1 {
			years = "yr"
		}
		parts = append(parts, itoa(cv.ExperienceYears)+" "+years+" experience")
	}
	if len(parts) == 0 {
		return "anonymous candidate"
	}
	return strings.Join(parts, " · ")
}
