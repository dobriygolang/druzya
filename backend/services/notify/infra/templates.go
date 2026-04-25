package infra

import (
	"bytes"
	"fmt"
	"strings"
	"text/template"

	"druz9/notify/domain"
	"druz9/shared/enums"
)

// Templates is an in-memory TemplateStore keyed by (type, locale).
//
// Russian is the primary locale per bible §3.1. English variants are stubs
// that mirror the Russian copy — the product team will iterate on them later.
type Templates struct {
	// compiled[type][locale] = parsed text/template.
	compiled map[enums.NotificationType]map[string]*template.Template
}

// NewTemplates compiles the built-in catalogue. Returns an error if any
// template fails to parse (should never happen for the hard-coded strings).
func NewTemplates() (*Templates, error) {
	t := &Templates{
		compiled: make(map[enums.NotificationType]map[string]*template.Template),
	}
	for typ, byLocale := range rawTemplates {
		t.compiled[typ] = make(map[string]*template.Template, len(byLocale))
		for locale, raw := range byLocale {
			tpl, err := template.New(string(typ) + ":" + locale).Parse(raw)
			if err != nil {
				return nil, fmt.Errorf("templates: parse %s/%s: %w", typ, locale, err)
			}
			t.compiled[typ][locale] = tpl
		}
	}
	return t, nil
}

// Render implements domain.TemplateStore.
func (t *Templates) Render(typ enums.NotificationType, locale string, payload map[string]any) (domain.Template, error) {
	byLocale, ok := t.compiled[typ]
	if !ok {
		return domain.Template{}, fmt.Errorf("templates: no template for type %q", typ)
	}
	tpl, ok := byLocale[locale]
	if !ok {
		// Fall back to Russian (primary locale) if requested locale missing.
		tpl, ok = byLocale["ru"]
		if !ok {
			return domain.Template{}, fmt.Errorf("templates: no fallback for %q", typ)
		}
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, payload); err != nil {
		return domain.Template{}, fmt.Errorf("templates: execute %s: %w", typ, err)
	}
	return domain.Template{Text: strings.TrimSpace(buf.String())}, nil
}

// Compile-time assertion.
var _ domain.TemplateStore = (*Templates)(nil)

// rawTemplates is the copy catalogue. Keep user-facing strings out of Go code
// elsewhere — use this map. When product iterates on tone, only this file
// changes.
//
// Payload contract per type is documented alongside each entry.
var rawTemplates = map[enums.NotificationType]map[string]string{
	// payload: {Streak:int, XP:int, Milestone:string optional}
	enums.NotificationTypeDailyKata: {
		"ru": `{{if .MissedStreak}}❄️ Пропустил Kata — streak сгорит в полночь. Использовать freeze-токен?{{else}}✨ Streak {{.Streak}} дней! +{{.XP}} XP.{{if .Milestone}} {{.Milestone}}{{end}}{{end}}`,
		"en": `{{if .MissedStreak}}❄️ Missed today's Kata — streak burns at midnight. Use a freeze token?{{else}}✨ Streak {{.Streak}} days! +{{.XP}} XP.{{if .Milestone}} {{.Milestone}}{{end}}{{end}}`,
	},
	// payload: {Section:string, EloDelta:int, Won:bool}
	enums.NotificationTypeMatchResult: {
		"ru": `{{if .Won}}⚔ Победа в арене · {{.Section}} · +{{.EloDelta}} ELO{{else}}Защита не удалась · {{.Section}} · {{.EloDelta}} ELO{{end}}`,
		"en": `{{if .Won}}⚔ Arena victory · {{.Section}} · +{{.EloDelta}} ELO{{else}}Defense failed · {{.Section}} · {{.EloDelta}} ELO{{end}}`,
	},
	// payload: {Section:string, TaskTitle:string}
	enums.NotificationTypeMatchFound: {
		"ru": `🎯 Матч найден! {{.Section}}. Заходи быстрее — противник ждёт.`,
		"en": `🎯 Match found! {{.Section}}. Hurry — your opponent is waiting.`,
	},
	// payload: {NodeKey:string, DaysInactive:int}
	enums.NotificationTypeSkillDecay: {
		"ru": `⚠ Skill «{{.NodeKey}}» начинает угасать — {{.DaysInactive}} дн без практики.`,
		"en": `⚠ Skill «{{.NodeKey}}» is decaying — {{.DaysInactive}} days without practice.`,
	},
	// payload: {Until:string (formatted)}
	enums.NotificationTypeSeasonEnding: {
		"ru": `⏳ Сезон заканчивается {{.Until}}. Успей получить награды!`,
		"en": `⏳ Season ends {{.Until}}. Don't miss your rewards!`,
	},
	// payload: {StartsAt:string, Interviewer:string}
	enums.NotificationTypeSlotReminder: {
		"ru": `📅 Слот забронирован на {{.StartsAt}} с {{.Interviewer}}.`,
		"en": `📅 Slot booked for {{.StartsAt}} with {{.Interviewer}}.`,
	},
	// payload: {Summary:string, Period:string}
	enums.NotificationTypeWeeklyReport: {
		"ru": `📊 Еженедельный отчёт ({{.Period}}):\n{{.Summary}}`,
		"en": `📊 Weekly report ({{.Period}}):\n{{.Summary}}`,
	},
}

// SubscriptionActivatedTemplate and UserRegisteredTemplate are reused via
// the {Won:bool} flag. Additional free-form templates used by the bot command
// dispatcher (welcome message, etc.) live in bot_text.go.
