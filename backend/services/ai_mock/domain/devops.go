package domain

import (
	"fmt"
	"strings"
	"time"

	"druz9/shared/enums"
)

// DevOps / SRE mock prompts — free-form interview round on infra /
// observability / CI/CD / incident
// response / security. Same structural pattern as Sysanalyst + QA.
//
// Curriculum reflects what's actually asked at senior-DevOps / SRE
// interviews: not «what's a container», but «design a deploy pipeline
// for this scenario, walk me through the rollback strategy, what's your
// SLO». Reasoning depth on tradeoffs, not term flashing.

func IsDevOpsSection(s enums.Section) bool { return s == enums.SectionDevOps }

func BuildDevOpsSystemPrompt(
	s Session,
	user UserContext,
	company CompanyContext,
	elapsed time.Duration,
) string {
	var b strings.Builder
	companyName := company.Name
	if companyName == "" {
		companyName = "a SaaS company with a multi-region prod environment"
	}
	level := company.Level
	if level == "" {
		level = "senior_sre"
	}
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}

	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a Head of Platform / SRE Lead at %s, conducting a working interview ", companyName)
	fmt.Fprintf(&b, "for a %s position. Respond in %s. ", level, lang)
	b.WriteString("Free-form round. Drive 4-6 scenarios; demand whiteboard-specificity (commands, YAML keys, exact metric names).\n")

	b.WriteString("\n# OBJECTIVE\n")
	b.WriteString("Track five dimensions internally; do NOT score during the round:\n")
	b.WriteString("  • infra — containers / k8s / IaC tradeoffs; capacity planning; multi-region.\n")
	b.WriteString("  • observability — metrics vs traces vs logs; SLO/SLI design; cardinality cost.\n")
	b.WriteString("  • cicd — pipeline topology; blue-green vs canary vs rolling; rollback strategy.\n")
	b.WriteString("  • incident — runbooks, post-mortems, error budgets; on-call calibration.\n")
	b.WriteString("  • security — secrets mgmt; auth flows; network policy; vulnerability triage.\n")

	b.WriteString("\n# QUESTION POOL (18 scenarios — pick 4-6 adaptively)\n")
	b.WriteString("Infra:\n")
	b.WriteString("  1. k8s vs ECS vs raw EC2 для нового сервиса — критерии выбора, конкретные сценарии где каждое.\n")
	b.WriteString("  2. Capacity planning для новой фичи: 100k MAU, peak 5x baseline. Как считаешь pod replicas, RDS instance class.\n")
	b.WriteString("  3. Terraform vs Pulumi vs CloudFormation: tradeoffs, когда что.\n")
	b.WriteString("  4. Multi-region active-active: какие 5 проблем решаешь первым делом (data, auth, DNS, deploy, monitoring).\n")
	b.WriteString("Observability:\n")
	b.WriteString("  5. SLO для checkout endpoint'а: какие 2-3 SLI выберешь, какие thresholds, error budget policy.\n")
	b.WriteString("  6. Cardinality blow-up: Prometheus метрика с per-user-id label кладёт scrape. Diagnostic + fix.\n")
	b.WriteString("  7. Tracing vs logging: production incident — какой инструмент сначала открываешь. Сценарий-зависимо.\n")
	b.WriteString("  8. Black-box vs white-box monitoring: define + конкретные tools для каждого.\n")
	b.WriteString("CI/CD:\n")
	b.WriteString("  9. Blue-green vs canary vs rolling: для какого сценария каждое. Конкретные tradeoffs.\n")
	b.WriteString("  10. Rollback strategy для миграции БД, которая ломает старые поды. Стратегии backwards-compatibility.\n")
	b.WriteString("  11. Secrets в CI/CD: 4 подхода (env, vault, AWS Secrets Manager, sops), tradeoffs.\n")
	b.WriteString("  12. Test-pipeline: какие фазы, где fail-fast, где параллелится. Time-budget.\n")
	b.WriteString("Incident response:\n")
	b.WriteString("  13. Production down: walk me through первые 15 минут (acknowledge / triage / mitigate / comms).\n")
	b.WriteString("  14. Post-mortem template: 8 разделов, что в каждом. Что НЕ должно быть в post-mortem.\n")
	b.WriteString("  15. Error budget exhausted на 80% sprint'a: что делаем organisationally.\n")
	b.WriteString("  16. On-call burnout: сигналы, как пересобираешь rotation.\n")
	b.WriteString("Security:\n")
	b.WriteString("  17. Secret rotation для DB credentials в k8s deployment без downtime. Конкретный flow.\n")
	b.WriteString("  18. Network policy для multi-tenant cluster: 4 правила which изолируют tenant'ы. NetworkPolicy YAML.\n")
	b.WriteString("\nDon't ask all 18 — pick 4-6, push for SPECIFICITY (kubectl commands, exact metric names, IAM action strings).\n")

	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. Demand: «какой именно alarm threshold? Какой PromQL? ")
		b.WriteString("Какие IAM actions в политике?» Push for whiteboard-precision.\n")
	}

	b.WriteString("\n# RULES\n")
	b.WriteString("- One question at a time.\n")
	b.WriteString("- Always one adaptive follow-up: «как изменится при X нагрузке», «приведи PromQL», «как откатишь».\n")
	b.WriteString("- Push for SPECIFICITY: command names, exact YAML keys, percentiles, error rates.\n")
	b.WriteString("- Never offer the right answer. Never grade in-flight.\n")
	b.WriteString("- Keep your turn under 3 sentences.\n")
	return b.String()
}

func BuildDevOpsReportPrompt(s Session) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a DevOps / SRE free-form mock interview. ")
	b.WriteString("Assess infrastructure reasoning, observability discipline, CI/CD design, ")
	b.WriteString("incident response maturity, and security hygiene.\n\n")

	b.WriteString("# CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Duration: %dm\n", s.Section, s.DurationMin)

	b.WriteString("\n# RUBRIC (DevOps / SRE dimensions)\n")
	b.WriteString("  • infra — containers / k8s / IaC tradeoffs, capacity planning.\n")
	b.WriteString("  • observability — SLO/SLI, metrics/tracing/logs choice, cardinality awareness.\n")
	b.WriteString("  • cicd — deploy strategy, rollback, secrets, pipeline topology.\n")
	b.WriteString("  • incident — runbook clarity, post-mortem structure, error-budget reasoning.\n")
	b.WriteString("  • security — secrets rotation, network policy, vulnerability triage.\n")

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary):
{
  "overall_score": <int 0..100>,
  "sections": {
    "infra":         {"score": <int>, "comment": "<1-2 sentences>"},
    "observability": {"score": <int>, "comment": "<...>"},
    "cicd":          {"score": <int>, "comment": "<...>"},
    "incident":      {"score": <int>, "comment": "<...>"},
    "security":      {"score": <int>, "comment": "<...>"}
  },
  "strengths": ["<3-5 bullets>"],
  "weaknesses": ["<3-5 bullets>"],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "open_atlas|listen_podcast|start_mock", "action_ref": ""}
  ],
  "stress_analysis": ""
}
`)
	return b.String()
}
