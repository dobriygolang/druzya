package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// helper: compute the HMAC Telegram expects us to verify.
func signTelegram(botToken string, fields map[string]string) string {
	keys := make([]string, 0, len(fields))
	for k, v := range fields {
		if v == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, k+"="+fields[k])
	}
	dataCheck := strings.Join(lines, "\n")
	secretSum := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secretSum[:])
	mac.Write([]byte(dataCheck))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyTelegramHash_Happy(t *testing.T) {
	t.Parallel()
	const bot = "123456:ABCDEF-test-bot-token"
	now := time.Unix(1_700_000_000, 0)
	payload := TelegramPayload{
		ID:        987654321,
		FirstName: "Sergey",
		Username:  "sedorofeevd",
		AuthDate:  now.Unix() - 60,
	}
	payload.Hash = signTelegram(bot, map[string]string{
		"id":         strconv.FormatInt(payload.ID, 10),
		"first_name": payload.FirstName,
		"username":   payload.Username,
		"auth_date":  strconv.FormatInt(payload.AuthDate, 10),
	})

	prof, err := VerifyTelegramHash(payload, bot, now)
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if prof.ID != payload.ID || prof.Username != payload.Username {
		t.Fatalf("unexpected profile: %+v", prof)
	}
}

func TestVerifyTelegramHash_Tampered(t *testing.T) {
	t.Parallel()
	const bot = "bot-token"
	now := time.Now()
	payload := TelegramPayload{
		ID:       1,
		AuthDate: now.Unix(),
		Hash:     strings.Repeat("a", 64),
	}
	_, err := VerifyTelegramHash(payload, bot, now)
	if !errors.Is(err, ErrInvalidTelegramHash) {
		t.Fatalf("expected ErrInvalidTelegramHash, got %v", err)
	}
}

func TestVerifyTelegramHash_Expired(t *testing.T) {
	t.Parallel()
	const bot = "bot-token"
	now := time.Now()
	payload := TelegramPayload{
		ID:        1,
		FirstName: "X",
		AuthDate:  now.Add(-48 * time.Hour).Unix(),
	}
	payload.Hash = signTelegram(bot, map[string]string{
		"id":         strconv.FormatInt(payload.ID, 10),
		"first_name": payload.FirstName,
		"auth_date":  strconv.FormatInt(payload.AuthDate, 10),
	})
	_, err := VerifyTelegramHash(payload, bot, now)
	if !errors.Is(err, ErrTelegramAuthExpired) {
		t.Fatalf("expected ErrTelegramAuthExpired, got %v", err)
	}
}

func TestVerifyTelegramHash_EmptyBotToken(t *testing.T) {
	t.Parallel()
	_, err := VerifyTelegramHash(TelegramPayload{Hash: "x", AuthDate: time.Now().Unix()}, "", time.Now())
	if err == nil {
		t.Fatal("expected error for empty bot token")
	}
}

func TestNormaliseUsername(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"@Alex":        "alex",
		"  Alex.Iva ":  "alex.iva",
		"Кирилл":       "______", // 6 non-ASCII runes → 6 underscores
		"":             "",
		"good_login-1": "good_login-1",
	}
	for in, want := range cases {
		if got := NormaliseUsername(in); got != want {
			t.Errorf("NormaliseUsername(%q) = %q, want %q", in, got, want)
		}
	}
}
