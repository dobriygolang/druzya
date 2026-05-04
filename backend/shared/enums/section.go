package enums

type Section string

const (
	SectionAlgorithms   Section = "algorithms"
	SectionSQL          Section = "sql"
	SectionGo           Section = "go"
	SectionSystemDesign Section = "system_design"
	SectionBehavioral   Section = "behavioral"
	// SectionEnglishHR — Wave 1 of docs/feature/english.md. Used only by
	// ai_mock for English HR-rounds; engineering-only tables (ratings,
	// elo_snapshots, tasks, arena_matches, slots) reject this value at
	// the CHECK-constraint layer, see migrations/00001_baseline.sql.
	SectionEnglishHR Section = "english_hr"
	// SectionSystemDesignSenior — Wave 3.2 of docs/feature/plan.md.
	// Free-form architectural discussion (distributed / real-time / ML /
	// observability), no algorithmic task. Distinct from
	// SectionSystemDesign — that one is task-paired ("design URL
	// shortener with these constraints"); this is interview-style
	// pushback at staff/principal level. Engineering-by-context (counts
	// toward dev_senior track) but doesn't gate ELO/tasks (no rating).
	SectionSystemDesignSenior Section = "system_design_senior"
	// SectionTechLeadEM — Wave 3.4 of docs/feature/plan.md. Free-form
	// STAR-style behavioral round at Tech Lead / Engineering Manager
	// level: people scenarios (1:1s, conflict, hiring, tech-debt
	// defense). Distinct from SectionBehavioral — that one pairs with
	// concrete behavioral tasks/templates; this is open conversation
	// where the AI plays a hiring panel and adapts questions to
	// candidate's answers.
	SectionTechLeadEM Section = "tech_lead_em"
	// SectionSysanalyst — Wave 7 of docs/feature/plan.md. Free-form
	// interview round для системного аналитика — requirements
	// engineering, UML/BPMN modeling, integration patterns
	// (REST/SOAP/Kafka/sagas/idempotency), SQL data design, process
	// (Agile/BABOK basics). Non-engineering surface (don't gate ELO);
	// non-task-based (no `tasks` table pick at session create).
	SectionSysanalyst Section = "sysanalyst"
	// SectionProductAnalyst — Wave 8. Product analyst track — metrics
	// (DAU/retention/funnel/NSM), SQL для analytics, A/B testing
	// fundamentals (sample size / MDE / CUPED), prioritisation
	// frameworks (RICE/JTBD), insight communication. Same gating as
	// SectionSysanalyst — non-engineering, non-task-based.
	SectionProductAnalyst Section = "product_analyst"
	// SectionQA — Wave 9.2 of docs/feature/plan.md. QA / тестировщик
	// free-form interview: test design, API testing, automation, bug
	// analysis, process. Same gating as Sysanalyst — non-engineering,
	// non-task-based.
	SectionQA Section = "qa"
	// SectionDevOps — Wave 9.3. DevOps / SRE free-form interview:
	// infra, observability, CI/CD, incident response, security.
	SectionDevOps Section = "devops"
	// SectionMLEng — pivot 2026-05-01. ML engineering free-form interview
	// для middle/senior ML позиций: classical ML basics, deep learning
	// fundamentals (backprop, CNN/RNN/transformers), LLM/GenAI (RAG,
	// fine-tuning, embeddings), MLOps (registry, A/B serving, observa-
	// bility), evaluation + production awareness. Non-engineering
	// gate (как остальные free-form), non-task-based (нет codetest).
	SectionMLEng Section = "ml_eng"
	// SectionDE — Phase 1c (learning-companion 2026-05-04). Data
	// engineering free-form interview под senior DE-роли: ETL/ELT
	// pipelines, warehouses, streaming (Kafka/exactly-once), SQL
	// optimization, dimensional modeling, Spark/distributed compute,
	// data quality, orchestration, governance. Same gating как другие
	// free-form: non-engineering (no ELO/rating), non-task-based.
	SectionDE Section = "de"
)

func (s Section) IsValid() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral,
		SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM,
		SectionSysanalyst, SectionProductAnalyst,
		SectionQA, SectionDevOps, SectionMLEng, SectionDE:
		return true
	}
	return false
}

// IsEngineering reports whether the section gates engineering tables
// (ratings, ELO, tasks, arena, slots). English HR + senior SD + Tech
// Lead/EM + Sysanalyst + Product analyst — non-engineering — no ELO
// or rating data flows into those tables for these sections.
// Callers that touch those tables should branch on this method.
func (s Section) IsEngineering() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral:
		return true
	case SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM,
		SectionSysanalyst, SectionProductAnalyst,
		SectionQA, SectionDevOps, SectionMLEng, SectionDE:
		return false
	}
	return false
}

// IsTaskBased reports whether sessions in this section pair with a
// concrete task from the `tasks` table. Free-form sections (English HR,
// senior SD, Tech Lead/EM, Sysanalyst, Product analyst) skip the
// task-pick step at session creation. Stricter check than IsEngineering
// — senior SD is engineering yet free-form, so call sites that gate
// task lookup must use IsTaskBased instead.
func (s Section) IsTaskBased() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral:
		return true
	case SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM,
		SectionSysanalyst, SectionProductAnalyst,
		SectionQA, SectionDevOps, SectionMLEng, SectionDE:
		return false
	}
	return false
}

func (s Section) String() string { return string(s) }

func AllSections() []Section {
	return []Section{
		SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral,
		SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM,
		SectionSysanalyst, SectionProductAnalyst,
		SectionQA, SectionDevOps, SectionMLEng, SectionDE,
	}
}
