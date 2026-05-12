package app

import "regexp"

// PII patterns — best-effort guard. Не perfect (free-form text может
// содержать что угодно), но catches typical leaks.
//
// Email RFC compliant subset (covers 99%+ practical emails).
// Phone: international format + russian inland (+7/8/9...).
// Token-like: длинные строки base64/hex (api keys, jwt, etc).
var (
	emailRe = regexp.MustCompile(`(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}`)
	phoneRe = regexp.MustCompile(`(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2,4}`)
	tokenRe = regexp.MustCompile(`[A-Za-z0-9_-]{40,}`)
)

// redactPII заменяет email/phone/token-like substrings на [redacted].
// Идемпотентно — re-redact на already-redacted noop.
func redactPII(v string) string {
	if v == "" {
		return v
	}
	v = emailRe.ReplaceAllString(v, "[redacted]")
	v = phoneRe.ReplaceAllString(v, "[redacted]")
	v = tokenRe.ReplaceAllString(v, "[redacted]")
	return v
}
