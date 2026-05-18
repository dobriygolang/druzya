// Package userlocale exposes the user's preferred response language to LLM
// callsites. Single source of truth is users.locale ("ru" or "en"). Service
// code reads via the Reader interface and prepends a language directive as
// the first system message in each LLM call so 8B-class free-tier models
// (groq, cerebras) reliably honour the user's language even when the rest
// of the prompt happens to be in a different language.
//
// The directive lives in its own system message slot — not appended to the
// core prompt — so callers can compose with Lingua/English-HR overrides
// (PolicyForceEnglish) without re-templating the prompt body.
package userlocale

import (
	"context"

	"github.com/google/uuid"
)

// Reader returns the user's response locale ("ru" or "en"). Implementations
// must default to "ru" on unknown user / DB miss so callers can safely
// invoke without a nil-check.
type Reader interface {
	Get(ctx context.Context, userID uuid.UUID) string
}

// ResponseLanguagePolicy controls how a specific LLM task picks its
// response language. Most tasks follow the user; Lingua and english_hr
// override to English regardless of user preference.
type ResponseLanguagePolicy int

const (
	// PolicyUserLocale — respond in the user's preferred locale (default).
	PolicyUserLocale ResponseLanguagePolicy = iota
	// PolicyForceEnglish — always respond in English (Lingua Writing/Speaking,
	// english_hr mock round).
	PolicyForceEnglish
	// PolicyForceRussian — always respond in Russian. Reserved; no callers today.
	PolicyForceRussian
)

const (
	directiveRU = "Отвечай по-русски. Используй естественный русский; не переключайся на английский, " +
		"даже если пользователь смешал языки."
	directiveEN = "Respond in English. Use natural English; do not switch to Russian even if the " +
		"user mixed languages."
	directiveForceEN = "Respond in English only, regardless of user input language. This is by design " +
		"for the English-learning task."
	directiveForceRU = "Отвечай по-русски."
)

// DirectiveFor returns the system message text to insert as slot 0 in an
// LLM call. policy overrides the user locale where applicable.
func DirectiveFor(policy ResponseLanguagePolicy, userLocale string) string {
	if policy == PolicyForceEnglish {
		return directiveForceEN
	}
	if policy == PolicyForceRussian {
		return directiveForceRU
	}
	return LanguageDirective(userLocale)
}

// LanguageDirective returns the user-locale directive without policy override.
// Unknown / empty locale falls back to Russian (matches DB default).
func LanguageDirective(locale string) string {
	if locale == "en" {
		return directiveEN
	}
	return directiveRU
}

// Normalize canonicalises a locale value to "ru" or "en". Unknown or empty
// values become "ru" (matches DB default).
func Normalize(locale string) string {
	if locale == "en" {
		return "en"
	}
	return "ru"
}
