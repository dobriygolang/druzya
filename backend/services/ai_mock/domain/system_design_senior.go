package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// Senior System Design mock prompts (Wave 3.2 of docs/feature/plan.md).
// Distinct from the engineering SECTION_SYSTEM_DESIGN flow:
//
//   • SECTION_SYSTEM_DESIGN — task-paired ("design URL shortener with
//     these throughput / latency requirements"); LLM grades a specific
//     diagram via TaskSysDesignCritique.
//
//   • SECTION_SYSTEM_DESIGN_SENIOR — free-form architectural pushback
//     at staff/principal level. AI plays a senior interviewer who
//     probes failure modes, forces tradeoff articulation, and refuses
//     to accept "we'd just add a cache" answers. No task to grade —
//     the rubric measures the *conversation*.
//
// We re-use the same Session struct (no DB column changes); branching
// happens at the prompt-dispatcher and at the task-skip step, mirroring
// the English HR pattern.

// IsSystemDesignSeniorSection is the centralised dispatch helper.
// Used by BuildSystemPrompt / BuildReportPrompt and by callers that
// need to skip task-pick (CreateSession / loadContext / worker).
func IsSystemDesignSeniorSection(s enums.Section) bool {
	return s == enums.SectionSystemDesignSenior
}

// BuildSystemDesignSeniorSystemPrompt is the in-session system message.
// Mirrors BuildSystemPrompt's structure (ROLE / OBJECTIVE / FOCUS /
// STATE / RULES). company.Level pads the seniority anchor when it's
// blank — without it the LLM defaults to "middle" framing and stops
// pushing back hard enough.
func BuildSystemDesignSeniorSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "a high-scale tech company"
	}
	level := company.Level
	if level == "" {
		level = "staff"
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a %s-level system design interviewer at %s. ", level, companyName)
	fmt.Fprintf(&b, "Respond in %s. ", lang)
	b.WriteString("This is a free-form architectural conversation — there is NO concrete task ")
	b.WriteString("to design. Instead, probe the candidate's reasoning depth across one or two ")
	b.WriteString("architectural domains (distributed systems, real-time / streaming, ML systems, ")
	b.WriteString("security, observability) chosen by their first answer.\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Drive the candidate through a senior-level discussion. Track four dimensions ")
	b.WriteString("internally; do NOT score during the conversation:\n")
	b.WriteString("  • depth — how far the candidate goes past the first-order answer\n")
	b.WriteString("  • tradeoffs — does the candidate articulate explicit costs/benefits, or just propose?\n")
	b.WriteString("  • failure_modes — does the candidate volunteer how the design breaks under partial failure?\n")
	b.WriteString("  • pragmatism — does the candidate ground choices in concrete numbers (RPS, latency budgets, $) ")
	b.WriteString("or float in handwave-land?\n")

	b.WriteString("\n# FOCUS (pick one based on the opening turn, then drill)\n")
	b.WriteString("  - distributed: consistency, sharding, replication, consensus, split-brain\n")
	b.WriteString("  - realtime: pub/sub, Kafka, WebSocket fan-out, backpressure, ordering\n")
	b.WriteString("  - ml: feature stores, online inference, drift, training/serving skew\n")
	b.WriteString("  - security: auth flows, secret mgmt, SSRF, prompt-injection in user-data paths\n")
	b.WriteString("  - observability: metrics vs traces, SLO/SLI, on-call ergonomics\n")
	b.WriteString("Stay on one or two focuses for the round — bouncing between five = shallow.\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Adversarial — challenge every choice, refuse soft ")
		b.WriteString("answers, force the candidate to defend each tradeoff explicitly.\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One push at a time. Wait for the candidate's answer before stacking another.\n")
	b.WriteString("- After every claim, ask exactly one of: «what's the failure mode?», «what's the cost?», ")
	b.WriteString("«at what scale does this break?». Don't accept «add a cache» without follow-up.\n")
	b.WriteString("- If the candidate handwaves («we'd use Redis»), demand a number — RPS, capacity, eviction policy.\n")
	b.WriteString("- Never propose the answer yourself. Never grade in-flight; grading is end-of-round only.\n")
	b.WriteString("- Keep your turn concise — 2–3 sentences, interview pace, not lecture pace.\n")
	return b.String()
}

// BuildSystemDesignSeniorReportPrompt is the grader prompt. Returns
// strict JSON in the same envelope as BuildReportPrompt + the english
// HR variant, but with senior-SD-specific section keys.
func BuildSystemDesignSeniorReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a senior-level system design mock interview that just ")
	b.WriteString("finished. Produce an objective rubric assessment of the candidate's reasoning ")
	b.WriteString("depth and tradeoff articulation.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)
	b.WriteString("This was a free-form architectural discussion — no specific task to design. ")
	b.WriteString("Grade the candidate's *reasoning*, not the correctness of any single proposal.\n")

	b.WriteString("\n# RUBRIC (senior SD dimensions)\n")
	b.WriteString("  • depth — did the candidate go past the first-order answer? Did they reach for ")
	b.WriteString("specific failure-mode reasoning, not just «we'd use a queue»?\n")
	b.WriteString("  • tradeoffs — were costs/benefits made explicit? Did the candidate name what ")
	b.WriteString("they were giving up at each choice?\n")
	b.WriteString("  • failure_modes — did the candidate volunteer how the design breaks under network ")
	b.WriteString("partition / partial failure / 100x scale, or did they have to be prompted?\n")
	b.WriteString("  • pragmatism — did the candidate ground claims in numbers (RPS, p99 latency, ")
	b.WriteString("storage cost), or stay in handwave-land?\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary) with this exact shape:
{
  "overall_score": <int 0..100>,
  "sections": {
    "depth":         {"score": <int>, "comment": "<string, 1-2 sentences citing one concrete moment>"},
    "tradeoffs":     {"score": <int>, "comment": "<string, name what was articulated and what was missed>"},
    "failure_modes": {"score": <int>, "comment": "<string, were they volunteered or only prompted?>"},
    "pragmatism":    {"score": <int>, "comment": "<string, were numbers used or handwaved?>"}
  },
  "strengths": ["<3-5 bullets, each pointing to a specific moment>"],
  "weaknesses": ["<3-5 bullets, each actionable>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
Score honestly — senior SD candidates need calibrated feedback, not encouragement.
`)
	return b.String()
}
