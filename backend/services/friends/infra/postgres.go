// Package infra — Postgres + Redis-кеш для friends.
//
// Прямой pgx (без sqlc) — не плодим sqlc.yaml для двух таблиц.
package infra

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/friends/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres реализует domain.FriendRepo.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres конструктор.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

// Add создаёт pending request от requester к addressee.
// Если уже есть строка в любом направлении (accepted/pending/blocked) —
// возвращает её, ErrAlreadyExists.
func (p *Postgres) Add(ctx context.Context, requester, addressee uuid.UUID) (domain.Friendship, error) {
	if requester == addressee {
		return domain.Friendship{}, domain.ErrSelfFriendship
	}
	// Сначала проверяем встречную строку (addressee → requester).
	var existing domain.Friendship
	row := p.pool.QueryRow(ctx, `
		SELECT id, requester_id, addressee_id, status, created_at, accepted_at
		  FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2)
		    OR (requester_id = $2 AND addressee_id = $1)
		 LIMIT 1
	`, requester, addressee)
	var acceptedAt nullableTime
	if err := row.Scan(&existing.ID, &existing.RequesterID, &existing.AddresseeID,
		&existing.Status, &existing.CreatedAt, &acceptedAt); err == nil {
		if acceptedAt.Valid {
			t := acceptedAt.Time
			existing.AcceptedAt = &t
		}
		return existing, domain.ErrAlreadyExists
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return domain.Friendship{}, fmt.Errorf("friends.pg.Add.lookup: %w", err)
	}
	row = p.pool.QueryRow(ctx, `
		INSERT INTO friendships (requester_id, addressee_id, status)
		VALUES ($1, $2, 'pending')
		RETURNING id, requester_id, addressee_id, status, created_at, accepted_at
	`, requester, addressee)
	var f domain.Friendship
	if err := row.Scan(&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &acceptedAt); err != nil {
		return domain.Friendship{}, fmt.Errorf("friends.pg.Add.insert: %w", err)
	}
	if acceptedAt.Valid {
		t := acceptedAt.Time
		f.AcceptedAt = &t
	}
	return f, nil
}

// Accept выставляет status='accepted', accepted_at=now() — только если byUser
// — addressee. RowsAffected == 0 → ErrNotFound (или строка не для этого юзера).
func (p *Postgres) Accept(ctx context.Context, id int64, byUser uuid.UUID) (domain.Friendship, error) {
	row := p.pool.QueryRow(ctx, `
		UPDATE friendships
		   SET status = 'accepted', accepted_at = now()
		 WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
		RETURNING id, requester_id, addressee_id, status, created_at, accepted_at
	`, id, byUser)
	var (
		f          domain.Friendship
		acceptedAt nullableTime
	)
	if err := row.Scan(&f.ID, &f.RequesterID, &f.AddresseeID, &f.Status, &f.CreatedAt, &acceptedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Friendship{}, domain.ErrNotFound
		}
		return domain.Friendship{}, fmt.Errorf("friends.pg.Accept: %w", err)
	}
	if acceptedAt.Valid {
		t := acceptedAt.Time
		f.AcceptedAt = &t
	}
	return f, nil
}

// Decline удаляет pending-строку (только addressee).
func (p *Postgres) Decline(ctx context.Context, id int64, byUser uuid.UUID) error {
	tag, err := p.pool.Exec(ctx, `
		DELETE FROM friendships
		 WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
	`, id, byUser)
	if err != nil {
		return fmt.Errorf("friends.pg.Decline: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Block: upsert (byUser → target) status='blocked'. Сносит обратную/любую другую
// строку в этом направлении.
func (p *Postgres) Block(ctx context.Context, byUser, target uuid.UUID) error {
	if byUser == target {
		return domain.ErrSelfFriendship
	}
	// чистим обратное направление, чтобы не было «accepted vs blocked».
	if _, err := p.pool.Exec(ctx, `
		DELETE FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2 AND status <> 'blocked')
		    OR (requester_id = $2 AND addressee_id = $1)
	`, byUser, target); err != nil {
		return fmt.Errorf("friends.pg.Block.cleanup: %w", err)
	}
	if _, err := p.pool.Exec(ctx, `
		INSERT INTO friendships (requester_id, addressee_id, status)
		VALUES ($1, $2, 'blocked')
		ON CONFLICT (requester_id, addressee_id) DO UPDATE
		   SET status = 'blocked', accepted_at = NULL
	`, byUser, target); err != nil {
		return fmt.Errorf("friends.pg.Block.insert: %w", err)
	}
	return nil
}

// Unblock удаляет blocked-строку (byUser → target).
func (p *Postgres) Unblock(ctx context.Context, byUser, target uuid.UUID) error {
	tag, err := p.pool.Exec(ctx, `
		DELETE FROM friendships
		 WHERE requester_id = $1 AND addressee_id = $2 AND status = 'blocked'
	`, byUser, target)
	if err != nil {
		return fmt.Errorf("friends.pg.Unblock: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Remove удаляет accepted/pending-строку в любом направлении (byUser ↔ friend).
func (p *Postgres) Remove(ctx context.Context, byUser, friend uuid.UUID) error {
	tag, err := p.pool.Exec(ctx, `
		DELETE FROM friendships
		 WHERE ((requester_id = $1 AND addressee_id = $2)
		     OR (requester_id = $2 AND addressee_id = $1))
		   AND status IN ('accepted','pending')
	`, byUser, friend)
	if err != nil {
		return fmt.Errorf("friends.pg.Remove: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ListAccepted возвращает обогащённых друзей одного uid'а.
//
// Берём «другую сторону» каждой строки (CASE), джойним users + лучшую секцию
// в ratings (LEFT JOIN, выбираем макс. ELO). Last_match_at — из ratings
// (last_match_at в любой секции).
func (p *Postgres) ListAccepted(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	return p.listJoined(ctx, uid, `
		SELECT
		  CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS friend_id
		  FROM friendships f
		 WHERE f.status = 'accepted'
		   AND (f.requester_id = $1 OR f.addressee_id = $1)
	`)
}

// ListIncoming — pending где uid — addressee.
func (p *Postgres) ListIncoming(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	return p.listJoined(ctx, uid, `
		SELECT f.requester_id AS friend_id, f.id AS friendship_id
		  FROM friendships f
		 WHERE f.status = 'pending' AND f.addressee_id = $1
	`)
}

// ListOutgoing — pending где uid — requester.
func (p *Postgres) ListOutgoing(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	return p.listJoined(ctx, uid, `
		SELECT f.addressee_id AS friend_id, f.id AS friendship_id
		  FROM friendships f
		 WHERE f.status = 'pending' AND f.requester_id = $1
	`)
}

// ListBlocked — blocked где uid — requester (заблокированные мной).
func (p *Postgres) ListBlocked(ctx context.Context, uid uuid.UUID) ([]domain.FriendListEntry, error) {
	return p.listJoined(ctx, uid, `
		SELECT f.addressee_id AS friend_id
		  FROM friendships f
		 WHERE f.status = 'blocked' AND f.requester_id = $1
	`)
}

// listJoined общий path для всех list-методов. cteSQL должен возвращать
// колонку friend_id (UUID); дальше джойним users + ratings.
func (p *Postgres) listJoined(ctx context.Context, uid uuid.UUID, cteSQL string) ([]domain.FriendListEntry, error) {
	q := fmt.Sprintf(`
		WITH ids AS (%s)
		SELECT
		   u.id,
		   u.username,
		   COALESCE(u.display_name, ''),
		   COALESCE(p.avatar_frame, ''),
		   COALESCE(top_section.section, ''),
		   COALESCE(top_section.elo, 0),
		   top_section.last_match_at
		  FROM ids
		  JOIN users u ON u.id = ids.friend_id
		  LEFT JOIN profiles p ON p.user_id = u.id
		  LEFT JOIN LATERAL (
		       SELECT r.section, r.elo, r.last_match_at
		         FROM ratings r
		        WHERE r.user_id = u.id
		        ORDER BY r.elo DESC
		        LIMIT 1
		  ) top_section ON TRUE
		 ORDER BY top_section.last_match_at DESC NULLS LAST, u.username
		 LIMIT 200
	`, cteSQL)
	rows, err := p.pool.Query(ctx, q, uid)
	if err != nil {
		return nil, fmt.Errorf("friends.pg.list: %w", err)
	}
	defer rows.Close()
	out := make([]domain.FriendListEntry, 0)
	for rows.Next() {
		var (
			e           domain.FriendListEntry
			section     string
			elo         int
			lastMatchAt nullableTime
		)
		if err := rows.Scan(&e.UserID, &e.Username, &e.DisplayName, &e.AvatarFrame,
			&section, &elo, &lastMatchAt); err != nil {
			return nil, fmt.Errorf("friends.pg.list: scan: %w", err)
		}
		if section != "" {
			e.Tier = fmt.Sprintf("%s · %d ELO", section, elo)
		}
		if lastMatchAt.Valid {
			t := lastMatchAt.Time
			e.LastMatchAt = &t
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("friends.pg.list: rows: %w", err)
	}
	return out, nil
}

// GetIDByPair находит friendship.id по любому из двух направлений.
func (p *Postgres) GetIDByPair(ctx context.Context, a, b uuid.UUID) (int64, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id FROM friendships
		 WHERE (requester_id = $1 AND addressee_id = $2)
		    OR (requester_id = $2 AND addressee_id = $1)
		 LIMIT 1
	`, a, b)
	var id int64
	if err := row.Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domain.ErrNotFound
		}
		return 0, fmt.Errorf("friends.pg.GetIDByPair: %w", err)
	}
	return id, nil
}

// Suggestions — простой baseline: пользователи с ближайшим ELO в секции, у
// которых нет любой строки friendships с uid (любой статус). Filter:
// ELO bucket ±300, исключая самого uid и существующих/blocked.
func (p *Postgres) Suggestions(ctx context.Context, uid uuid.UUID, limit int) ([]domain.FriendListEntry, error) {
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	rows, err := p.pool.Query(ctx, `
		WITH my_top AS (
		   SELECT section, elo
		     FROM ratings
		    WHERE user_id = $1
		    ORDER BY elo DESC
		    LIMIT 1
		), candidates AS (
		   SELECT r.user_id, r.section, r.elo, r.last_match_at,
		          ABS(r.elo - my_top.elo) AS dist
		     FROM ratings r, my_top
		    WHERE r.section = my_top.section
		      AND r.user_id <> $1
		      AND ABS(r.elo - my_top.elo) <= 300
		      AND NOT EXISTS (
		            SELECT 1 FROM friendships f
		             WHERE (f.requester_id = $1 AND f.addressee_id = r.user_id)
		                OR (f.requester_id = r.user_id AND f.addressee_id = $1)
		      )
		    ORDER BY dist ASC, r.last_match_at DESC NULLS LAST
		    LIMIT $2
		)
		SELECT
		   u.id, u.username, COALESCE(u.display_name, ''),
		   COALESCE(p.avatar_frame, ''),
		   c.section, c.elo, c.last_match_at
		  FROM candidates c
		  JOIN users u ON u.id = c.user_id
		  LEFT JOIN profiles p ON p.user_id = u.id
		 ORDER BY c.dist ASC
	`, uid, int32(limit))
	if err != nil {
		return nil, fmt.Errorf("friends.pg.Suggestions: %w", err)
	}
	defer rows.Close()
	out := make([]domain.FriendListEntry, 0, limit)
	for rows.Next() {
		var (
			e           domain.FriendListEntry
			section     string
			elo         int
			lastMatchAt nullableTime
		)
		if err := rows.Scan(&e.UserID, &e.Username, &e.DisplayName, &e.AvatarFrame,
			&section, &elo, &lastMatchAt); err != nil {
			return nil, fmt.Errorf("friends.pg.Suggestions: scan: %w", err)
		}
		if section != "" {
			e.Tier = fmt.Sprintf("%s · %d ELO", section, elo)
		}
		if lastMatchAt.Valid {
			t := lastMatchAt.Time
			e.LastMatchAt = &t
		}
		out = append(out, e)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.FriendRepo = (*Postgres)(nil)

// ── FriendCodes ─────────────────────────────────────────────────────────────

// CodePostgres реализует domain.FriendCodeRepo.
type CodePostgres struct {
	pool *pgxpool.Pool
	ttl  time.Duration
}

// DefaultCodeTTL — 30 дней.
const DefaultCodeTTL = 30 * 24 * time.Hour

// NewCodePostgres конструктор.
func NewCodePostgres(pool *pgxpool.Pool, ttl time.Duration) *CodePostgres {
	if ttl <= 0 {
		ttl = DefaultCodeTTL
	}
	return &CodePostgres{pool: pool, ttl: ttl}
}

// Generate возвращает существующий не-истёкший код, иначе создаёт новый.
func (c *CodePostgres) Generate(ctx context.Context, uid uuid.UUID) (domain.FriendCode, error) {
	// сначала пробуем достать существующий
	row := c.pool.QueryRow(ctx, `
		SELECT user_id, code, expires_at
		  FROM friend_codes
		 WHERE user_id = $1
	`, uid)
	var (
		fc        domain.FriendCode
		expiresAt time.Time
	)
	if err := row.Scan(&fc.UserID, &fc.Code, &expiresAt); err == nil {
		fc.ExpiresAt = expiresAt.UTC()
		if !fc.IsExpired(time.Now().UTC()) {
			return fc, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return domain.FriendCode{}, fmt.Errorf("friends.pg.Generate.lookup: %w", err)
	}
	// генерим новый
	for attempt := 0; attempt < 5; attempt++ {
		code := newFriendCode()
		exp := time.Now().UTC().Add(c.ttl)
		_, err := c.pool.Exec(ctx, `
			INSERT INTO friend_codes (user_id, code, expires_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE
			   SET code = EXCLUDED.code,
			       expires_at = EXCLUDED.expires_at
		`, uid, code, exp)
		if err != nil {
			// возможен конфликт по UNIQUE(code) — пробуем снова.
			if attempt == 4 {
				return domain.FriendCode{}, fmt.Errorf("friends.pg.Generate.insert: %w", err)
			}
			continue
		}
		return domain.FriendCode{UserID: uid, Code: code, ExpiresAt: exp}, nil
	}
	return domain.FriendCode{}, fmt.Errorf("friends.pg.Generate: collision retries exhausted")
}

// Resolve возвращает (uid, nil) либо ErrNotFound / ErrCodeExpired.
func (c *CodePostgres) Resolve(ctx context.Context, code string) (uuid.UUID, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT user_id, expires_at
		  FROM friend_codes
		 WHERE code = $1
	`, normaliseCode(code))
	var (
		uid       uuid.UUID
		expiresAt time.Time
	)
	if err := row.Scan(&uid, &expiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, domain.ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("friends.pg.Resolve: %w", err)
	}
	if expiresAt.Before(time.Now().UTC()) {
		return uuid.Nil, domain.ErrCodeExpired
	}
	return uid, nil
}

// newFriendCode — DRUZ9-XXXX-XXX, base32 (no padding).
//
// 7 символов рандома → 35 бит → ~34 миллиарда — уникально с запасом.
func newFriendCode() string {
	var raw [5]byte
	_, _ = rand.Read(raw[:])
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:])
	enc = strings.ToUpper(enc)
	if len(enc) < 7 {
		enc = strings.Repeat("X", 7-len(enc)) + enc
	}
	return fmt.Sprintf("DRUZ9-%s-%s", enc[:4], enc[4:7])
}

// normaliseCode чистит ввод от пробелов / lowercase.
func normaliseCode(in string) string {
	out := strings.ToUpper(strings.TrimSpace(in))
	out = strings.ReplaceAll(out, " ", "")
	return out
}

// Compile-time guard.
var _ domain.FriendCodeRepo = (*CodePostgres)(nil)

// ── helpers ────────────────────────────────────────────────────────────────

type nullableTime struct {
	Time  time.Time
	Valid bool
}

func (n *nullableTime) Scan(src any) error {
	if src == nil {
		n.Valid = false
		return nil
	}
	switch v := src.(type) {
	case time.Time:
		n.Time = v.UTC()
		n.Valid = true
	default:
		return fmt.Errorf("friends.scan time: unsupported type %T", src)
	}
	return nil
}
