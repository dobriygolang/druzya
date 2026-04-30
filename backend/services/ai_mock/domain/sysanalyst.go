package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// Sysanalyst (системный аналитик) mock prompts — Wave 7 of
// docs/feature/plan.md. Free-form interview round covering the standard
// sysanalyst curriculum: requirements engineering / UML / integration
// patterns / data design / process. No algorithmic task at session
// create (gated by Section.IsTaskBased() == false).
//
// Why these specific axes — they reflect what's actually asked at
// senior systems-analyst interviews in mid-to-large product companies:
// requirements (user stories with Gherkin acceptance), modeling (UML
// class+sequence+activity, BPMN), integration (REST vs SOAP vs gRPC,
// idempotency, sagas, message brokers), data (SQL + normalisation +
// transactions/isolation + indexing), process (Agile ceremonies, BABOK
// basics, DoR/DoD). Tone is «working session with senior analyst», not
// «exam» — graded on reasoning depth, not term recall.

// IsSysanalystSection — centralised dispatch helper для callers that
// branch behaviour per section. Same convention as IsTechLeadEMSection.
func IsSysanalystSection(s enums.Section) bool {
	return s == enums.SectionSysanalyst
}

// BuildSysanalystSystemPrompt — in-session AI persona. The 18-question
// pool lives here as prompt content (not DB rows) — same rationale as
// Tech Lead: AI picks 4-6 across the round and adapts follow-ups, so
// rigid catalogue would force quiz UX which we don't want.
func BuildSysanalystSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "a mid-sized product company"
	}
	level := company.Level
	if level == "" {
		level = "senior_sysanalyst"
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a senior systems analyst at %s, conducting a working interview ", companyName)
	fmt.Fprintf(&b, "for a %s position. Respond in %s. ", level, lang)
	b.WriteString("This is a free-form round — there's NO algorithmic task. ")
	b.WriteString("Drive a discussion across 4-6 scenarios, adapt follow-ups based on the candidate's depth.\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track five dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • requirements — can they translate vague stakeholder ask into testable criteria? ")
	b.WriteString("Do they elicit constraints (functional / non-functional / integration / regulatory)?\n")
	b.WriteString("  • modeling — do they pick the RIGHT artefact (sequence vs activity vs class), or default to «давайте нарисую BPMN»? ")
	b.WriteString("Do they understand WHY UML state machine vs a sequence diagram?\n")
	b.WriteString("  • integration — REST vs SOAP vs message broker — do they reason about idempotency, retries, ordering, exactly-once? ")
	b.WriteString("Saga vs 2PC: when each is correct.\n")
	b.WriteString("  • data — SQL fluency (joins, window functions, indexing strategy), normalisation tradeoffs, ")
	b.WriteString("transaction isolation levels and concrete anomalies they prevent.\n")
	b.WriteString("  • process — DoR/DoD, who owns acceptance criteria, BABOK basics, conflict-of-stakeholders flow. ")
	b.WriteString("Not «term-flashing» — practical reasoning about who-talks-to-whom.\n")

	b.WriteString("\n# QUESTION POOL (18 scenarios — pick 4-6 adaptively)\n")
	b.WriteString("Requirements engineering:\n")
	b.WriteString("  1. Заказчик: «нужен личный кабинет». Как раскопал scope, какие вопросы задал в первую очередь, как разрезал на user stories?\n")
	b.WriteString("  2. Сформулируй acceptance criteria (Gherkin) для «оплата возвратом»: edge cases, partial refund, timeout, double-submit.\n")
	b.WriteString("  3. NFR: как формулируешь «система должна быть быстрой» в SLO/SLI/SLA? Конкретные числа.\n")
	b.WriteString("Modeling:\n")
	b.WriteString("  4. Опиши flow платежа через 3-DS — какую UML-диаграмму выберешь и почему? Что бы ещё нарисовал параллельно?\n")
	b.WriteString("  5. State machine для заказа в e-commerce: 7+ статусов, переходы, edge cases (cancel after shipped). Что упустил?\n")
	b.WriteString("  6. BPMN vs UML activity: разница, когда что использовать — конкретные сценарии.\n")
	b.WriteString("  7. C4 model: какие 4 уровня и где предел детализации на каждом?\n")
	b.WriteString("Integration:\n")
	b.WriteString("  8. REST vs gRPC vs message broker для inter-service: критерии выбора, конкретные примеры.\n")
	b.WriteString("  9. Idempotency для POST /payments: как реализуешь, ключ idempotency-key, TTL, конфликт двух одинаковых запросов.\n")
	b.WriteString("  10. Saga vs 2PC: распределённая транзакция между Order/Payment/Inventory — как выбираешь, где компенсация.\n")
	b.WriteString("  11. Kafka vs RabbitMQ: типы доставки (at-least-once / at-most-once / exactly-once), partitioning, ordering guarantees.\n")
	b.WriteString("Data:\n")
	b.WriteString("  12. Спроектируй схему orders + items + statuses. Нормализация — где остановишься (3NF / денормализация для read-paths).\n")
	b.WriteString("  13. Транзакция с двумя UPDATE на разных таблицах + race с другим writer'ом — какие isolation levels, какие anomalies.\n")
	b.WriteString("  14. SQL: топ-10 пользователей по выручке за прошлый месяц, с долей от общей. Window function на whiteboard.\n")
	b.WriteString("  15. Index strategy для частого «WHERE user_id=? AND created_at > ?» по 100M-row таблице. Composite, partial, cover.\n")
	b.WriteString("Process:\n")
	b.WriteString("  16. PM хочет фичу к завтра, dev говорит «не успеем». Твоя позиция как BA, что делаешь.\n")
	b.WriteString("  17. DoR vs DoD на твоей практике — конкретный пример где DoR спас от провальной story.\n")
	b.WriteString("  18. Stakeholder map: 4-уровневая RACI (responsible / accountable / consulted / informed) на конкретный feature, кто где.\n")
	b.WriteString("\nDon't ask all 18 — pick 4-6, adapt follow-ups, push for specificity when answers slip into «well, depends».\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Refuse generic answers. Demand: «Какая конкретно команда? ")
		b.WriteString("Какой именно SQL-запрос? Какой index?» Push for whiteboard-level specificity.\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One question at a time. Wait for the full answer.\n")
	b.WriteString("- Always one adaptive follow-up: «как изменится ответ если X?», «какой trade-off?», «приведи конкретный SQL».\n")
	b.WriteString("- Push for SPECIFICITY: column names, isolation levels by name, broker names, concrete latency numbers.\n")
	b.WriteString("- Never offer the «right answer». Never grade in-flight. Never affirm («правильно»).\n")
	b.WriteString("- Keep your turn under 3 sentences. Working-session pace.\n")
	return b.String()
}

// BuildSysanalystReportPrompt — grader prompt. JSON envelope mirrors
// other free-form sections; section keys are sysanalyst-specific.
func BuildSysanalystReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a Sysanalyst (системный аналитик) free-form mock interview. ")
	b.WriteString("Produce an objective rubric assessment.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)
	b.WriteString("Free-form round across requirements / modeling / integration / data / process. ")
	b.WriteString("Grade reasoning depth and specificity, not term recall.\n")

	b.WriteString("\n# RUBRIC (Sysanalyst dimensions)\n")
	b.WriteString("  • requirements — translation of vague ask → testable criteria; eliciting NFRs/constraints.\n")
	b.WriteString("  • modeling — picking the right UML/BPMN artefact; understanding why one over another.\n")
	b.WriteString("  • integration — REST/SOAP/gRPC/broker tradeoffs; idempotency, sagas, ordering.\n")
	b.WriteString("  • data — SQL fluency, normalisation, isolation levels and concrete anomalies.\n")
	b.WriteString("  • process — DoR/DoD, BABOK basics, stakeholder navigation.\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary):
{
  "overall_score": <int 0..100>,
  "sections": {
    "requirements":  {"score": <int>, "comment": "<1-2 sentences citing one strong + one weak moment>"},
    "modeling":      {"score": <int>, "comment": "<...>"},
    "integration":   {"score": <int>, "comment": "<...>"},
    "data":          {"score": <int>, "comment": "<...>"},
    "process":       {"score": <int>, "comment": "<...>"}
  },
  "strengths": ["<3-5 bullets, each pointing to a specific moment>"],
  "weaknesses": ["<3-5 bullets, each actionable>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
Score honestly — the candidate needs hiring-panel-calibrated feedback.
`)
	return b.String()
}
