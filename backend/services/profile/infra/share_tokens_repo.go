package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"druz9/profile/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// IssueShareToken — INSERT в weekly_share_tokens с TTL 30d. Token —
// 32-байтовый hex (64 chars).
func (p *Postgres) IssueShareToken(ctx context.Context, userID uuid.UUID, weekISO string) (domain.ShareToken, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return domain.ShareToken{}, fmt.Errorf("profile.Postgres.IssueShareToken: rand: %w", err)
	}
	tok := hex.EncodeToString(buf[:])
	expires := time.Now().UTC().Add(30 * 24 * time.Hour)
	const q = `
		INSERT INTO weekly_share_tokens(user_id, week_iso, token, expires_at)
		VALUES ($1, $2, $3, $4)`
	if _, err := p.pool.Exec(ctx, q, sharedpg.UUID(userID), weekISO, tok, expires); err != nil {
		return domain.ShareToken{}, fmt.Errorf("profile.Postgres.IssueShareToken: insert: %w", err)
	}
	return domain.ShareToken{
		Token:     tok,
		WeekISO:   weekISO,
		ExpiresAt: expires,
	}, nil
}

// ResolveShareToken — атомарно SELECT + UPDATE views_count. Возвращает
// ErrNotFound если токен протух или не существует.
func (p *Postgres) ResolveShareToken(ctx context.Context, token string) (domain.ShareResolution, error) {
	const q = `
		UPDATE weekly_share_tokens
		   SET views_count = views_count + 1
		 WHERE token = $1 AND expires_at > now()
		 RETURNING user_id, week_iso`
	var uid pgtype.UUID
	var weekISO string
	if err := p.pool.QueryRow(ctx, q, token).Scan(&uid, &weekISO); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ShareResolution{}, fmt.Errorf("profile.Postgres.ResolveShareToken: %w", domain.ErrNotFound)
		}
		return domain.ShareResolution{}, fmt.Errorf("profile.Postgres.ResolveShareToken: %w", err)
	}
	return domain.ShareResolution{
		UserID:  sharedpg.UUIDFrom(uid),
		WeekISO: weekISO,
	}, nil
}
