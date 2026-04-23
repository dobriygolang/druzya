package domain

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
)

// TelegramCodeAlphabet — Crockford-base32 minus visually ambiguous chars
// (I, L, O, 0, 1) plus we drop a couple more to land on a clean 32-char set.
// 8 characters from this alphabet give us ~40 bits of entropy — well above
// the brute-force budget for a 5-minute TTL with rate-limited polling.
const TelegramCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// TelegramCodeLength is the number of characters in a generated deep-link code.
const TelegramCodeLength = 8

// ErrCodeNotFound — поле под этим кодом нет в Redis (истёк или никогда не было).
var ErrCodeNotFound = errors.New("auth: telegram code not found or expired")

// ErrCodeAlreadyExists — крайне редкая коллизия при SetNX.
var ErrCodeAlreadyExists = errors.New("auth: telegram code already exists")

// ErrCodePending — код ещё не подтверждён ботом (фронт должен продолжать polling).
var ErrCodePending = errors.New("auth: telegram code pending")

// TelegramCodeRepo управляет жизненным циклом кодов deep-link авторизации.
// Реализация — в infra (Redis, ключи `auth:tg:code:<code>`).
type TelegramCodeRepo interface {
	// SetPending создаёт ключ с пустым payload и TTL.
	SetPending(ctx context.Context, code string) error
	// Fill записывает верифицированный payload в существующий ключ (KEEPTTL).
	Fill(ctx context.Context, code string, payload TelegramPayload) error
	// Get возвращает payload + filled флаг + ошибку. filled=false при пустом
	// ключе, error = ErrCodeNotFound когда ключ исчез.
	Get(ctx context.Context, code string) (payload TelegramPayload, filled bool, err error)
	// Delete снимает ключ — single-use гарантия.
	Delete(ctx context.Context, code string) error
}

// GenerateTelegramCode возвращает крипто-случайную строку из TelegramCodeAlphabet
// длины TelegramCodeLength. Использует crypto/rand.
func GenerateTelegramCode() (string, error) {
	buf := make([]byte, TelegramCodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("auth.GenerateTelegramCode: read random: %w", err)
	}
	out := make([]byte, TelegramCodeLength)
	n := byte(len(TelegramCodeAlphabet))
	for i, b := range buf {
		out[i] = TelegramCodeAlphabet[b%n]
	}
	return string(out), nil
}

// IsValidTelegramCode проверяет что строка — ровно TelegramCodeLength символов
// из TelegramCodeAlphabet. Используется в bot-handler /start <code>.
func IsValidTelegramCode(s string) bool {
	if len(s) != TelegramCodeLength {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		// Линейный поиск по 32-символьному алфавиту дешевле map[byte]bool.
		ok := false
		for j := 0; j < len(TelegramCodeAlphabet); j++ {
			if TelegramCodeAlphabet[j] == c {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}
