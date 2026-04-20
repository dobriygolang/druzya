package enums

type Section string

const (
	SectionAlgorithms   Section = "algorithms"
	SectionSQL          Section = "sql"
	SectionGo           Section = "go"
	SectionSystemDesign Section = "system_design"
	SectionBehavioral   Section = "behavioral"
)

func (s Section) IsValid() bool {
	switch s {
	case SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral:
		return true
	}
	return false
}

func (s Section) String() string { return string(s) }

func AllSections() []Section {
	return []Section{
		SectionAlgorithms, SectionSQL, SectionGo, SectionSystemDesign, SectionBehavioral,
	}
}
