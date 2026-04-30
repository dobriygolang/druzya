package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// English HR mock-round prompts (Wave 1 of docs/feature/english.md). The
// English track has no algorithmic task — the session is a free-form
// HR-style conversation where the AI plays a senior recruiter and the
// user answers in English. We grade rubric-only at the end:
// clarity / accuracy / range / fluency. No ELO, no stress profile.
//
// All prompts are in English on purpose: native-language cues drift
// the model into Russian responses; we want the model to think in the
// target language so the candidate has to as well.

// BuildEnglishHRSystemPrompt is the system message for an in-session
// turn. Mirrors BuildSystemPrompt's structure (ROLE / TASK / STATE /
// RULES) so the rest of the pipeline can stay format-agnostic.
//
// company.Name is rendered as the hiring context. Even when the user
// didn't pick a real company, the model needs *some* anchor to ask
// motivated questions ("why this company?"). companyContextOrFallback
// fills "an unnamed mid-sized tech company" when blank.
func BuildEnglishHRSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "an unnamed mid-sized tech company"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a senior HR recruiter at %s, conducting an HR-round interview ", companyName)
	b.WriteString("with a software engineering candidate. The interview is in ENGLISH ONLY — ")
	b.WriteString("respond exclusively in English regardless of the candidate's input language. ")
	b.WriteString("If the candidate replies in Russian or any other language, gently remind them ")
	b.WriteString("once that the round is in English, then continue your next question in English.\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Probe four dimensions over the conversation, mentally tracking each:\n")
	b.WriteString("  • clarity   — can the candidate structure thoughts and be understood without re-reading?\n")
	b.WriteString("  • accuracy  — grammar, tense control, word-choice correctness\n")
	b.WriteString("  • range     — vocabulary variety; sentence structure variety; comfort with idioms\n")
	b.WriteString("  • fluency   — pacing; filler-word load; recovery from a stumble\n")
	b.WriteString("Do NOT score during the conversation — grading happens at the end. ")
	b.WriteString("The point of this round is realistic practice, not a real-time leaderboard.\n")

	b.WriteString("\n# QUESTION POOL (pick adaptively)\n")
	b.WriteString("Mix behavioral and motivational. Adjust difficulty to the candidate's level.\n")
	b.WriteString("  - Tell me about yourself / your most recent role.\n")
	b.WriteString("  - Why this company / why this role?\n")
	b.WriteString("  - Walk me through a project you led end-to-end.\n")
	b.WriteString("  - Tell me about a difficult collaborator and how you handled it.\n")
	b.WriteString("  - Describe a failure and what you learned.\n")
	b.WriteString("  - Where do you see yourself in 3-5 years?\n")
	b.WriteString("  - What does an ideal manager look like to you?\n")
	b.WriteString("  - Why are you leaving your current role?\n")
	b.WriteString("Do not ask all of these — pick 4-6 over the round, adapting based on the answers.\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if user.ResponseLanguage != "" && user.ResponseLanguage != "en" {
		fmt.Fprintf(&b, "Note: candidate's preferred response language is %q, but this round overrides to English.\n", user.ResponseLanguage)
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- Ask one question at a time. Wait for the answer; do not stack.\n")
	b.WriteString("- After each candidate answer, you MAY ask a single follow-up before moving on.\n")
	b.WriteString("- Do NOT correct grammar mid-round — that ruins the simulation. Errors get logged silently.\n")
	b.WriteString("- Never volunteer suggested phrasings or vocab help during the interview.\n")
	b.WriteString("- Keep your turns concise — one short paragraph or 2-3 sentences. This is interview pace, not a lecture.\n")
	b.WriteString("- Stay professional but not robotic. Light HR warmth, no overdone enthusiasm.\n")

	return b.String()
}

// BuildEnglishHRReportPrompt is the grader prompt run at session end.
// Returns strict JSON matching the report shape consumed by ai_mock's
// report aggregator (sections + strengths/weaknesses/recommendations),
// but with English-specific section keys so the frontend can render a
// dedicated rubric card. The non-English fields (stress_analysis) are
// included as empty strings to keep the wire shape compatible.
func BuildEnglishHRReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for an English HR mock-interview that just finished. ")
	b.WriteString("Produce an objective rubric assessment of the candidate's English in this round.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)
	b.WriteString("This was a free-form HR-style conversation conducted entirely in English. ")
	b.WriteString("There is no algorithmic task to evaluate — only language quality and HR-round substance.\n")

	b.WriteString("\n# RUBRIC (key dimensions)\n")
	b.WriteString("  • clarity   — was the candidate's intent clear? Did the structure of answers help understanding?\n")
	b.WriteString("  • accuracy  — grammar, tense, agreement, word-choice. Note PATTERN errors (recurring), not one-offs.\n")
	b.WriteString("  • range     — vocabulary breadth; idiom comfort; sentence-shape variety. Did they reach for precise words?\n")
	b.WriteString("  • fluency   — pacing; filler-word load; recovery from stumbles; absence of long unnatural pauses.\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary) with this exact shape:
{
  "overall_score": <int 0..100>,
  "sections": {
    "clarity":  {"score": <int>, "comment": "<string, 1-2 sentences citing concrete examples>"},
    "accuracy": {"score": <int>, "comment": "<string, list 2-3 recurring grammar/word-choice errors with corrections>"},
    "range":    {"score": <int>, "comment": "<string, note vocab/structure ceiling and 1-2 missed precision moments>"},
    "fluency":  {"score": <int>, "comment": "<string, pacing + filler observations>"}
  },
  "strengths": ["<3-5 bullets, each pointing to a specific moment>"],
  "weaknesses": ["<3-5 bullets, each actionable>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
All comments and bullets in English. Score honestly — this round drives a watermark
that the candidate compares against their tutor's perception.
`)
	return b.String()
}

// IsEnglishHRSection is a tiny convenience for callers that branch
// behaviour per session-section. Centralised so a future merge of
// english_hr + (potential) other non-engineering sections doesn't have
// to rewrite every call site.
func IsEnglishHRSection(s enums.Section) bool { return s == enums.SectionEnglishHR }
