// templates_test.go — sanity for the static template catalogue.
//
// Тонкий smoke-test: что каждый Type рендерится с минимальным payload
// без template-runtime ошибок (typo в имени поля etc). Не проверяет copy
// — это политика продукта, не unit-теста.

package infra

import (
	"strings"
	"testing"

	"druz9/shared/enums"
)

func TestTemplatesRender(t *testing.T) {
	store, err := NewTemplates()
	if err != nil {
		t.Fatalf("NewTemplates: %v", err)
	}

	cases := []struct {
		name    string
		typ     enums.NotificationType
		locale  string
		payload map[string]any
		want    string // substring assertion
	}{
		{
			name:    "trial_expiring_ru",
			typ:     enums.NotificationTypeTrialExpiring,
			locale:  "ru",
			payload: map[string]any{"Hours": 23, "UpgradeURL": "https://druz9.online/upgrade"},
			want:    "23ч",
		},
		{
			name:    "trial_expiring_en",
			typ:     enums.NotificationTypeTrialExpiring,
			locale:  "en",
			payload: map[string]any{"Hours": 5, "UpgradeURL": "https://druz9.online/upgrade"},
			want:    "5h",
		},
		{
			name:    "trial_expiring_unknown_locale_fallback_ru",
			typ:     enums.NotificationTypeTrialExpiring,
			locale:  "de",
			payload: map[string]any{"Hours": 12, "UpgradeURL": "https://druz9.online/upgrade"},
			want:    "Trial Pro",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := store.Render(tc.typ, tc.locale, tc.payload)
			if err != nil {
				t.Fatalf("Render: %v", err)
			}
			if !strings.Contains(out.Text, tc.want) {
				t.Fatalf("want substring %q in %q", tc.want, out.Text)
			}
			if !strings.Contains(out.Text, "druz9.online/upgrade") {
				t.Fatalf("want upgrade URL in %q", out.Text)
			}
		})
	}
}
