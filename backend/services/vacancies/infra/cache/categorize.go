// categorize.go — source-aware mapper from a parsed Vacancy onto the
// domain.Category enum.
//
// We classify on the cheapest signal each parser preserves:
//
//   - WB:      regex over RawJSON's direction_title + direction_role_title
//   - VK:      RawJSON's prof_area.name + specialty.name
//   - Yandex:  keyword scan of title + public_service.name (in RawJSON)
//   - Ozon:    RawJSON's professionalRoles[].title
//   - MTS:     scan title (Strapi schema lacks a category field)
//
// Anti-fallback: anything we can't confidently classify falls into
// CategoryOther — never to a guessed bucket. A new keyword goes into the
// rule table below; mis-classification is preferable only over silent
// lying.
package cache

import (
	"encoding/json"
	"strings"

	"druz9/vacancies/domain"
)

// Categorize is the public entry point — picks the source-specific mapper
// then falls back to the title-keyword scan if RawJSON is missing or the
// source is unknown.
func Categorize(v domain.Vacancy) domain.Category {
	switch v.Source {
	case domain.SourceWildberries:
		if c := categorizeWB(v); c != "" {
			return c
		}
	case domain.SourceVK:
		if c := categorizeVK(v); c != "" {
			return c
		}
	case domain.SourceOzon, domain.SourceOzonTech:
		if c := categorizeOzon(v); c != "" {
			return c
		}
	case domain.SourceYandex:
		if c := categorizeYandex(v); c != "" {
			return c
		}
	case domain.SourceMTS:
		// MTS Strapi schema currently has no category field — fall through
		// to the title-keyword scan below.
	case domain.SourceTinkoff, domain.SourceSber, domain.SourceAvito,
		domain.SourceKaspersky, domain.SourceJetBrains, domain.SourceLamoda:
		// Sources without a verified parser yet — categorise by title only.
	}
	if c := classifyByText(v.Title); c != "" {
		return c
	}
	return domain.CategoryOther
}

// classifyByText runs the keyword table over an arbitrary string. Order
// matters — earlier rules win on conflicts (mobile before backend so
// "Android Developer" doesn't end up in backend).
func classifyByText(s string) domain.Category {
	if s == "" {
		return ""
	}
	s = strings.ToLower(s)
	rules := []struct {
		needles []string
		out     domain.Category
	}{
		{[]string{"qa", "тест", "tester", "автотест"}, domain.CategoryQA},
		{[]string{"devops", "sre", "platform engineer", "infrastructure"}, domain.CategoryDevOps},
		{[]string{"android", "ios", "mobile", "flutter", "react native", "kotlin developer", "swift developer", "мобильн"}, domain.CategoryMobile},
		{[]string{"frontend", "front-end", "front end", "react developer", "vue developer", "верстал", "фронт"}, domain.CategoryFrontend},
		{[]string{"data engineer", "data scientist", "ml engineer", "machine learning", "ai engineer", "дата-инжен", "дата инжен", "ml-инжен"}, domain.CategoryData},
		{[]string{"analyst", "analytics", "bi", "аналитик"}, domain.CategoryAnalytics},
		{[]string{"product manager", "product owner", "продакт", "продукт"}, domain.CategoryProduct},
		{[]string{"designer", "ux", "ui", "дизайн"}, domain.CategoryDesign},
		{[]string{"manager", "lead", "head", "менеджер", "руководит", "тимлид"}, domain.CategoryManagement},
		{[]string{"backend", "back-end", "back end", "go developer", "java developer", "python developer", "node.js", "бэкенд", "бекенд", "разработчик"}, domain.CategoryBackend},
	}
	for _, r := range rules {
		for _, n := range r.needles {
			if strings.Contains(s, n) {
				return r.out
			}
		}
	}
	return ""
}

// ── source-specific paths ─────────────────────────────────────────────────

type wbRaw struct {
	DirectionTitle     string `json:"direction_title"`
	DirectionRoleTitle string `json:"direction_role_title"`
}

func categorizeWB(v domain.Vacancy) domain.Category {
	if len(v.RawJSON) == 0 {
		return ""
	}
	var r wbRaw
	if err := json.Unmarshal(v.RawJSON, &r); err != nil {
		return ""
	}
	combo := r.DirectionTitle + " " + r.DirectionRoleTitle
	return classifyByText(combo)
}

type vkRaw struct {
	ProfArea  struct{ Name string } `json:"prof_area"`
	Specialty struct{ Name string } `json:"specialty"`
}

func categorizeVK(v domain.Vacancy) domain.Category {
	if len(v.RawJSON) == 0 {
		return ""
	}
	var r vkRaw
	if err := json.Unmarshal(v.RawJSON, &r); err != nil {
		return ""
	}
	return classifyByText(r.ProfArea.Name + " " + r.Specialty.Name)
}

type ozonRaw struct {
	ProfessionalRoles []struct {
		Title string `json:"title"`
	} `json:"professionalRoles"`
}

func categorizeOzon(v domain.Vacancy) domain.Category {
	if len(v.RawJSON) == 0 {
		return ""
	}
	var r ozonRaw
	if err := json.Unmarshal(v.RawJSON, &r); err != nil {
		return ""
	}
	parts := make([]string, 0, len(r.ProfessionalRoles))
	for _, x := range r.ProfessionalRoles {
		parts = append(parts, x.Title)
	}
	return classifyByText(strings.Join(parts, " "))
}

type yandexRaw struct {
	PublicService struct {
		Name string `json:"name"`
	} `json:"public_service"`
}

func categorizeYandex(v domain.Vacancy) domain.Category {
	if len(v.RawJSON) == 0 {
		return classifyByText(v.Title)
	}
	var r yandexRaw
	if err := json.Unmarshal(v.RawJSON, &r); err != nil {
		return classifyByText(v.Title)
	}
	return classifyByText(v.Title + " " + r.PublicService.Name)
}

// CategoryRussianLabel is the UI-facing Russian label table. Frontend has
// its own copy (sidebar checkboxes); keeping a backend version too lets
// admin tooling render the same strings without duplicating the table.
func CategoryRussianLabel(c domain.Category) string {
	switch c {
	case domain.CategoryBackend:
		return "Бэкенд"
	case domain.CategoryFrontend:
		return "Фронтенд"
	case domain.CategoryMobile:
		return "Мобильная разработка"
	case domain.CategoryData:
		return "Данные"
	case domain.CategoryDevOps:
		return "DevOps"
	case domain.CategoryQA:
		return "QA"
	case domain.CategoryAnalytics:
		return "Аналитика"
	case domain.CategoryProduct:
		return "Продакт"
	case domain.CategoryDesign:
		return "Дизайн"
	case domain.CategoryManagement:
		return "Менеджмент"
	case domain.CategoryOther:
		return "Прочее"
	}
	return string(c)
}
