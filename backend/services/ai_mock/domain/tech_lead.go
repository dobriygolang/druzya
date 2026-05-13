package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// Tech Lead / EM mock prompts. Behavioral STAR-style round at TL/EM
// level — people scenarios, not algorithms or system design.
//
// Distinct from SectionBehavioral (engineering-flow with concrete
// behavioral tasks pulled from the tasks table) — this is FREE-FORM
// conversation where the AI plays a hiring panel and adapts questions
// to the candidate's previous answers. No task pick at session create
// (gated by Section.IsTaskBased() returning false).
//
// Why STAR matters: at TL/EM level, the rubric isn't "did you say the
// right thing" but "did you structure your answer credibly". STAR
// (Situation / Task / Action / Result) is the industry default for
// senior behavioral evaluation — and graders trained on STAR are
// orders of magnitude more consistent than free-form scoring.

// IsTechLeadEMSection is the centralised dispatch helper for callers
// that branch behaviour per section (BuildSystemPrompt /
// BuildReportPrompt / future TL-only widgets). Keeps the equality
// check in one place so a future merge with another behavioral persona
// is a single-line change.
func IsTechLeadEMSection(s enums.Section) bool {
	return s == enums.SectionTechLeadEM
}

// BuildTechLeadSystemPrompt is the in-session system message. The 15
// STAR scenarios live here (not in the DB) — they're prompt content,
// not catalogue rows: the AI picks 4-5 across a round and adapts
// follow-ups, so persisting them as discrete records would force a
// rigid quiz UX we explicitly don't want.
func BuildTechLeadSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "a high-growth tech company"
	}
	level := company.Level
	if level == "" {
		level = "tech_lead" // covers both TL and EM tracks; rubric same
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a hiring panel for a %s position at %s. ", level, companyName)
	fmt.Fprintf(&b, "Respond in %s. ", lang)
	b.WriteString("This is a free-form behavioral round — there's NO algorithmic task. ")
	b.WriteString("Drive the conversation by picking 4-5 STAR scenarios across the round, ")
	b.WriteString("asking adaptive follow-ups based on the candidate's answers.\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track four dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • structure — did the candidate frame the answer as Situation / Task / Action / Result, ")
	b.WriteString("or did it bleed into a generic story?\n")
	b.WriteString("  • ownership — did the candidate own the situation, or attribute outcomes to «the team», ")
	b.WriteString("«process», or «leadership above me»?\n")
	b.WriteString("  • impact — was the result quantified (sprint cycle 14d → 8d, attrition halved, ARR +X)? ")
	b.WriteString("vague «things got better» = pattern weakness.\n")
	b.WriteString("  • learning — did the candidate volunteer a transferable lesson, or stop at the outcome?\n")

	b.WriteString("\n# QUESTION POOL (15 STAR scenarios — pick 4-5 adaptively)\n")
	b.WriteString("People management:\n")
	b.WriteString("  1. 1:1 с underperformer'ом — как ставил expectations, что предпринял, итог через 90 дней.\n")
	b.WriteString("  2. Конфликт между двумя сильными разработчиками: subjective tech-disagreement про архитектуру.\n")
	b.WriteString("  3. Hiring decision: junior + готов к ramp-up vs senior + дороже + рискует уйти через год.\n")
	b.WriteString("  4. Сотрудник просит promotion на сеньора, ты считаешь — рано. Conversation flow.\n")
	b.WriteString("  5. Кросс-функциональный конфликт: PM vs lead-engineer о deadline. Как fasilit'нул.\n")
	b.WriteString("Strategic / tradeoffs:\n")
	b.WriteString("  6. Tech-debt vs feature: как защитил refactor budget перед stakeholder'ами.\n")
	b.WriteString("  7. Ситуация когда ты сказал «нет» руководству. Что делал когда они настаивали.\n")
	b.WriteString("  8. Migration: convince team, что 6-месячный rewrite оправдан. Как продал idea.\n")
	b.WriteString("  9. Failure: project, который ты вёл, провалился. Что узнал, что повторил бы / нет.\n")
	b.WriteString("  10. Inherited team в кризисе (low morale + missed deadlines). Первые 30/60/90 дней.\n")
	b.WriteString("Operational:\n")
	b.WriteString("  11. Production incident: твой код положил прод. Action timeline + post-mortem.\n")
	b.WriteString("  12. On-call rotation, которая выгорает. Как реструктурировал.\n")
	b.WriteString("  13. Code review pushback: junior отказывается принимать твой review. Resolution.\n")
	b.WriteString("Self-development:\n")
	b.WriteString("  14. Skill, который освоил вне работы за последний год. Why + how.\n")
	b.WriteString("  15. Mentorship: ситуация когда ты выводил кого-то от middle к senior. Intervention'ы.\n")
	b.WriteString("\nDon't ask all 15 — pick 4-5, adapt follow-ups, push for STAR structure when it slips.\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Refuse generic answers. Demand: «What was the metric? ")
		b.WriteString("By how much? In how long? Who else was involved?» Push for specificity.\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One question at a time. Wait for the full answer; do not stack.\n")
	b.WriteString("- Always one adaptive follow-up: «what was the metric?», «what would you do differently?», ")
	b.WriteString("«who else was involved?» — based on what was vague in the answer.\n")
	b.WriteString("- If the candidate answers «we» without specifying their personal action, ")
	b.WriteString("ask «what specifically was YOUR action».\n")
	b.WriteString("- Never offer the «right answer». Never grade in-flight. Never affirm («great example!»).\n")
	b.WriteString("- Keep your turn under 3 sentences. Hiring-panel pace, not lecture.\n")
	return b.String()
}

// BuildTechLeadReportPrompt is the grader prompt. JSON envelope mirrors
// the engineering / English HR / senior SD shapes; section keys are
// TL-specific (structure / ownership / impact / learning).
func BuildTechLeadReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a Tech Lead / EM behavioral mock interview that just ")
	b.WriteString("finished. Produce an objective rubric assessment of the candidate's STAR storytelling ")
	b.WriteString("and people-leadership reasoning.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)
	b.WriteString("This was a free-form behavioral round at Tech Lead / EM level — 4-5 STAR scenarios ")
	b.WriteString("across people management, strategic tradeoffs, operational and self-development domains. ")
	b.WriteString("Grade the *storytelling discipline*, not the cleverness of any single decision.\n")

	b.WriteString("\n# RUBRIC (TL/EM dimensions)\n")
	b.WriteString("  • structure — did the candidate frame answers as Situation / Task / Action / Result? ")
	b.WriteString("Did stories have a clear beginning-middle-end, or trail off?\n")
	b.WriteString("  • ownership — did the candidate own outcomes? Or attribute them to «the team», «process», ")
	b.WriteString("«leadership above» without specifying their action?\n")
	b.WriteString("  • impact — were results QUANTIFIED (timeline, % change, $/sprint, attrition)? ")
	b.WriteString("Or stayed in «things got better» land?\n")
	b.WriteString("  • learning — did the candidate volunteer a transferable lesson per story, or stop at the outcome?\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary) with this exact shape:
{
  "overall_score": <int 0..100>,
  "sections": {
    "structure": {"score": <int>, "comment": "<string, 1-2 sentences naming a story that nailed STAR vs one that bled>"},
    "ownership": {"score": <int>, "comment": "<string, cite a moment where YOU vs WE was clear/unclear>"},
    "impact":    {"score": <int>, "comment": "<string, list 1-2 quantified wins + 1-2 vague answers>"},
    "learning":  {"score": <int>, "comment": "<string, were lessons volunteered or had to be prompted?>"}
  },
  "strengths": ["<3-5 bullets, each pointing to a specific story>"],
  "weaknesses": ["<3-5 bullets, each actionable>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
Score honestly — TL/EM candidates need calibrated feedback for hiring-panel reality, not encouragement.
`)
	return b.String()
}
