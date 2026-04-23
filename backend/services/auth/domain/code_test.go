package domain

import (
	"strings"
	"testing"
)

func TestGenerateTelegramCode_LengthAndAlphabet(t *testing.T) {
	t.Parallel()
	for i := 0; i < 200; i++ {
		got, err := GenerateTelegramCode()
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != TelegramCodeLength {
			t.Fatalf("got len %d, want %d (%q)", len(got), TelegramCodeLength, got)
		}
		for _, r := range got {
			if !strings.ContainsRune(TelegramCodeAlphabet, r) {
				t.Fatalf("char %q from %q not in alphabet", r, got)
			}
		}
	}
}

func TestGenerateTelegramCode_NoBannedChars(t *testing.T) {
	t.Parallel()
	// Verify the alphabet itself excludes the visually-ambiguous chars
	// (I, O, 0, 1) and is exactly 32 distinct chars.
	for _, banned := range []rune{'I', 'O', '0', '1'} {
		if strings.ContainsRune(TelegramCodeAlphabet, banned) {
			t.Fatalf("alphabet contains banned char %q", banned)
		}
	}
	// Distinct chars only.
	seen := map[rune]bool{}
	for _, r := range TelegramCodeAlphabet {
		if seen[r] {
			t.Fatalf("alphabet has duplicate %q", r)
		}
		seen[r] = true
	}
	if len(TelegramCodeAlphabet) != 32 {
		t.Fatalf("alphabet len %d, want 32", len(TelegramCodeAlphabet))
	}
}

func TestIsValidTelegramCode(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		"":          false,
		"ABCDEF":    false, // too short
		"ABCDEFGHJ": false, // too long
		"ABCDEFGH":  true,
		"abcdefgh":  false, // lower-case rejected
		"ABCDEF0H":  false, // zero not in alphabet
		"ABCDEF1H":  false, // one not in alphabet
		"23456789":  true,  // boundary chars
		"ZZZZZZZZ":  true,  // all-Z
	}
	for in, want := range cases {
		if got := IsValidTelegramCode(in); got != want {
			t.Errorf("IsValidTelegramCode(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestYandexAvatarURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   YandexUserInfo
		want string
	}{
		{"empty id", YandexUserInfo{DefaultAvatarID: ""}, ""},
		{"empty marker", YandexUserInfo{DefaultAvatarID: "abc", IsAvatarEmpty: true}, ""},
		{"happy", YandexUserInfo{DefaultAvatarID: "abc"}, "https://avatars.yandex.net/get-yapic/abc/islands-200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := YandexAvatarURL(tc.in); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
