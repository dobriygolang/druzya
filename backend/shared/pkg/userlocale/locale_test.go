package userlocale

import (
	"strings"
	"testing"
)

func TestDirectiveFor_UserLocaleRU(t *testing.T) {
	got := DirectiveFor(PolicyUserLocale, "ru")
	if !strings.Contains(got, "по-русски") {
		t.Fatalf("ru directive missing 'по-русски': %q", got)
	}
}

func TestDirectiveFor_UserLocaleEN(t *testing.T) {
	got := DirectiveFor(PolicyUserLocale, "en")
	if !strings.Contains(got, "in English") {
		t.Fatalf("en directive missing 'in English': %q", got)
	}
}

func TestDirectiveFor_EmptyLocaleDefaultsRU(t *testing.T) {
	got := DirectiveFor(PolicyUserLocale, "")
	if !strings.Contains(got, "по-русски") {
		t.Fatalf("empty locale should default to ru: %q", got)
	}
}

func TestDirectiveFor_InvalidLocaleDefaultsRU(t *testing.T) {
	got := DirectiveFor(PolicyUserLocale, "xx")
	if !strings.Contains(got, "по-русски") {
		t.Fatalf("unknown locale should default to ru: %q", got)
	}
}

func TestDirectiveFor_ForceEnglishOverridesUserLocale(t *testing.T) {
	got := DirectiveFor(PolicyForceEnglish, "ru")
	if !strings.Contains(got, "English only") {
		t.Fatalf("force-en should override ru locale: %q", got)
	}
}

func TestDirectiveFor_ForceRussianOverridesUserLocale(t *testing.T) {
	got := DirectiveFor(PolicyForceRussian, "en")
	if !strings.Contains(got, "по-русски") {
		t.Fatalf("force-ru should override en locale: %q", got)
	}
}

func TestNormalize(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"ru", "ru"},
		{"en", "en"},
		{"", "ru"},
		{"RU", "ru"},
		{"xx", "ru"},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q; want %q", c.in, got, c.want)
		}
	}
}

func TestStaticReader(t *testing.T) {
	if v := StaticReader("en").Get(nil, [16]byte{}); v != "en" {
		t.Errorf("StaticReader(en).Get = %q; want en", v)
	}
	if v := StaticReader("ru").Get(nil, [16]byte{}); v != "ru" {
		t.Errorf("StaticReader(ru).Get = %q; want ru", v)
	}
	if v := StaticReader("").Get(nil, [16]byte{}); v != "ru" {
		t.Errorf("StaticReader('').Get = %q; want ru", v)
	}
}
