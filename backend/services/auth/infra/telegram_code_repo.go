package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/auth/domain"

	"github.com/redis/go-redis/v9"
)

// RedisTelegramCodeRepo persists pending /auth/telegram/start codes under
// `auth:tg:code:<code>`. The lifecycle is:
//
//  1. Frontend POST /auth/telegram/start → SetPending (empty payload)
//  2. Telegram bot /start <code> → Fill (payload from Telegram update)
//  3. Frontend POST /auth/telegram/poll {code} → Get → on filled payload Delete
//
// All keys carry a TTL of `ttl` so abandoned flows expire cleanly.
type RedisTelegramCodeRepo struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewRedisTelegramCodeRepo wires the repo. ttl should be ~5 minutes per bible §11.
func NewRedisTelegramCodeRepo(rdb *redis.Client, ttl time.Duration) *RedisTelegramCodeRepo {
	return &RedisTelegramCodeRepo{rdb: rdb, ttl: ttl}
}

func tgCodeKey(code string) string { return "auth:tg:code:" + code }

// SetPending creates a key with the empty-payload marker. NX => fails if the
// (statistically improbable) collision happens; the use case retries with a
// fresh code in that case.
func (r *RedisTelegramCodeRepo) SetPending(ctx context.Context, code string) error {
	ok, err := r.rdb.SetNX(ctx, tgCodeKey(code), "", r.ttl).Result()
	if err != nil {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.SetPending: %w", err)
	}
	if !ok {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.SetPending: %w", domain.ErrCodeAlreadyExists)
	}
	return nil
}

// Fill writes the verified Telegram payload onto an existing pending key.
// The TTL is preserved (KEEPTTL semantics — we re-set with PX = remaining
// TTL approximated to the original budget). Returns ErrCodeNotFound if the
// pending key doesn't exist (e.g. expired before the bot got the /start).
func (r *RedisTelegramCodeRepo) Fill(ctx context.Context, code string, payload domain.TelegramPayload) error {
	key := tgCodeKey(code)
	// Confirm the key exists first; if not, the user typed an invalid or
	// expired code into the bot — no point in writing a fresh key without
	// a frontend poller waiting for it.
	exists, err := r.rdb.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.Fill: exists: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.Fill: %w", domain.ErrCodeNotFound)
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.Fill: marshal: %w", err)
	}
	// SET with KEEPTTL would be ideal but go-redis exposes it via SetArgs.
	if err := r.rdb.SetArgs(ctx, key, b, redis.SetArgs{KeepTTL: true}).Err(); err != nil {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.Fill: setargs: %w", err)
	}
	return nil
}

// Get returns the payload for a code. If the key exists but the value is
// empty, returns (zero payload, false /*filled*/, nil). If the key is gone
// (expired) returns ErrCodeNotFound. If the value is filled returns
// (payload, true, nil).
func (r *RedisTelegramCodeRepo) Get(ctx context.Context, code string) (domain.TelegramPayload, bool, error) {
	raw, err := r.rdb.Get(ctx, tgCodeKey(code)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return domain.TelegramPayload{}, false, fmt.Errorf("auth.RedisTelegramCodeRepo.Get: %w", domain.ErrCodeNotFound)
		}
		return domain.TelegramPayload{}, false, fmt.Errorf("auth.RedisTelegramCodeRepo.Get: %w", err)
	}
	if len(raw) == 0 {
		return domain.TelegramPayload{}, false, nil
	}
	var p domain.TelegramPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return domain.TelegramPayload{}, false, fmt.Errorf("auth.RedisTelegramCodeRepo.Get: unmarshal: %w", err)
	}
	return p, true, nil
}

// Delete removes the key after a successful poll → token mint. Missing keys
// are not an error.
func (r *RedisTelegramCodeRepo) Delete(ctx context.Context, code string) error {
	if err := r.rdb.Del(ctx, tgCodeKey(code)).Err(); err != nil {
		return fmt.Errorf("auth.RedisTelegramCodeRepo.Delete: %w", err)
	}
	return nil
}
