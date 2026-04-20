package enums

type Language string

const (
	LanguageGo         Language = "go"
	LanguagePython     Language = "python"
	LanguageJavaScript Language = "javascript"
	LanguageTypeScript Language = "typescript"
	LanguageSQL        Language = "sql"
)

func (l Language) IsValid() bool {
	switch l {
	case LanguageGo, LanguagePython, LanguageJavaScript, LanguageTypeScript, LanguageSQL:
		return true
	}
	return false
}

func (l Language) String() string { return string(l) }
