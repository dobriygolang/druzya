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
)

func (s Section) IsValid() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral,
		SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM:
		return true
	}
	return false
}

// IsEngineering reports whether the section gates engineering tables
// (ratings, ELO, tasks, arena, slots). English HR + senior SD + Tech
// Lead/EM — non-engineering — нет ELO или rating data.
// Callers that touch those tables should branch on this method.
func (s Section) IsEngineering() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral:
		return true
	case SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM:
		return false
	}
	return false
}

// IsTaskBased reports whether sessions in this section pair with a
// concrete task from the `tasks` table. Free-form sections (English HR,
// senior SD, Tech Lead/EM) skip the task-pick step at session creation.
// This is a stricter check than IsEngineering — они used to coincide,
// но senior SD is engineering yet free-form, так что call sites which
// gate task lookup must use IsTaskBased instead.
func (s Section) IsTaskBased() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral:
		return true
	case SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM:
		return false
	}
	return false
}

func (s Section) String() string { return string(s) }

func AllSections() []Section {
	return []Section{
		SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral,
		SectionEnglishHR, SectionSystemDesignSenior, SectionTechLeadEM,
	}
}
