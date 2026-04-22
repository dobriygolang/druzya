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

// ErrInvalidTelegramHash возвращается, когда HMAC-подпись Telegram не совпадает
// с тем, что мы вычисляем по bot token. Никогда не логируйте присланный hash.
var ErrInvalidTelegramHash = errors.New("auth: invalid telegram hash")

// ErrTelegramAuthExpired возвращается, когда auth_date старше допустимого окна
// (24ч по докам Telegram). Защищает от replay.
var ErrTelegramAuthExpired = errors.New("auth: telegram auth expired")

// TelegramAuthMaxAge — жёсткий потолок устаревания auth_date.
const TelegramAuthMaxAge = 24 * time.Hour

// TelegramPayload — то, что приходит из callback Telegram Login Widget.
// Поля — нетипизированные строки, чтобы можно было сериализовать их буквально для HMAC.
type TelegramPayload struct {
	ID        int64
	FirstName string
	LastName  string
	Username  string
	PhotoURL  string
	AuthDate  int64
	Hash      string
}

// VerifyTelegramHash проверяет подпись HMAC-SHA256, которую Telegram добавляет
// к callback'ам Login Widget, согласно https://core.telegram.org/widgets/login#checking-authorization.
//
// Алгоритм:
//  1. собрать data_check_string = отсортированные строки "key=value" через \n,
//     исключив само поле hash и пустые поля;
//  2. secret_key = SHA256(bot_token);
//  3. computed = HMAC_SHA256(secret_key, data_check_string);
//  4. hex(computed) должен равняться присланному hash (constant-time сравнение).
//
// Возвращаемый TelegramProfile повторяет проверенные поля payload.
// Если botToken пуст — возвращает ошибку, а не молча принимает.
func VerifyTelegramHash(p TelegramPayload, botToken string, now time.Time) (TelegramProfile, error) {
	if strings.TrimSpace(botToken) == "" {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: empty bot token")
	}
	if p.Hash == "" {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrInvalidTelegramHash)
	}
	// Проверка свежести (bible §9: auth_date должен быть недавним).
	if p.AuthDate <= 0 {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrInvalidTelegramHash)
	}
	if delta := now.Sub(time.Unix(p.AuthDate, 0)); delta < 0 || delta > TelegramAuthMaxAge {
		return TelegramProfile{}, fmt.Errorf("auth.VerifyTelegramHash: %w", ErrTelegramAuthExpired)
	}

	// Собираем непустые поля, исключая hash.
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

// NormaliseUsername убирает `@`, приводит к нижнему регистру и заменяет любые
// неподдерживаемые символы на `_`, чтобы всегда получать валидного кандидата
// в username. Уникальность здесь НЕ гарантируется — это задача репозитория при upsert.
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
