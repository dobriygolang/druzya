package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ErrInvalidTelegramHash is returned when Telegram's HMAC signature does not
// match what we compute with the bot token. Never log the supplied hash.
var ErrInvalidTelegramHash = errors.New("auth: invalid telegram hash")

// ErrTelegramAuthExpired is returned when auth_date is older than the allowed
// window (24h per Telegram docs). Protects against replay.
var ErrTelegramAuthExpired = errors.New("auth: telegram auth expired")

// TelegramAuthMaxAge is the hard cap on how stale auth_date can be.
const TelegramAuthMaxAge = 24 * time.Hour

// TelegramPayload is what arrives from the Telegram Login Widget callback.
// Fields are untyped strings so we can serialise verbatim for HMAC.
type TelegramPayload struct {
	ID        int64
	FirstName string
	LastName  string
	Username  string
	PhotoURL  string
	AuthDate  int64
	Hash      string
}

// VerifyTelegramHash checks the HMAC-SHA256 signature that Telegram appends
// to Login Widget callbacks, per https://core.telegram.org/widgets/login#checking-authorization.
//
// Algorithm:
//  1. build data_check_string = sorted "key=value" lines joined by \n,
//     excluding the hash field itself and any empty fields;
//  2. secret_key = SHA256(bot_token);
//  3. computed = HMAC_SHA256(secret_key, data_check_string);
//  4. hex(computed) must equal the provided hash (constant-time compare).
//
// The returned TelegramProfile mirrors the verified payload fields.
// If botToken is empty this returns an error rather than silently accepting.
func VerifyTelegramHash(p TelegramPayload, botToken string, now time.Time) (TelegramProfile, error) {
	if strings.TrimSpace(botToken) == "" {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: empty bot token")
	}
	if p.Hash == "" {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrInvalidTelegramHash)
	}
	// Expiry check (bible §9: auth_date must be recent).
	if p.AuthDate <= 0 {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrInvalidTelegramHash)
	}
	if delta := now.Sub(time.Unix(p.AuthDate, 0)); delta < 0 || delta > TelegramAuthMaxAge {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrTelegramAuthExpired)
	}

	// Collect non-empty fields, excluding hash.
	kv := map[string]string{
		"id":         strconv.FormatInt(p.ID, 10),
		"auth_date":  strconv.FormatInt(p.AuthDate, 10),
		"first_name": p.FirstName,
		"last_name":  p.LastName,
		"username":   p.Username,
		"photo_url":  p.PhotoURL,
	}
	keys := make([]string, 0, len(kv))
	for k, v := range kv {
		if v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, k+"="+kv[k])
	}
	dataCheckString := strings.Join(lines, "\n")

	// secret_key = SHA256(bot_token).
	secretSum := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secretSum[:])
	mac.Write([]byte(dataCheckString))
	expected := mac.Sum(nil)

	got, err := hex.DecodeString(p.Hash)
	if err != nil {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: decode hash: %w", ErrInvalidTelegramHash)
	}
	if !hmac.Equal(expected, got) {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrInvalidTelegramHash)
	}

	return TelegramProfile{
		ID:        p.ID,
		FirstName: p.FirstName,
		LastName:  p.LastName,
		Username:  p.Username,
		PhotoURL:  p.PhotoURL,
		AuthDate:  p.AuthDate,
	}, nil
}

// NormaliseUsername strips the `@`, lowercases, and replaces any unsupported
// chars with `_` so we always land on a valid username candidate. We do NOT
// guarantee uniqueness here — that is the repository's job on upsert.
func NormaliseUsername(raw string) string {
	raw = strings.TrimPrefix(strings.TrimSpace(raw), "@")
	raw = strings.ToLower(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(raw))
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '.', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}
