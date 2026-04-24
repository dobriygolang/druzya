// postgres_support.go — реализация SupportRepo через прямой pgx (без sqlc,
// чтобы не плодить query-файл для одной таблицы).
//
// Отдельная struct SupportPostgres (не методы на Postgres) — у Postgres уже
// есть Get/List от других интерфейсов, конфликт имён.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/notify/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SupportPostgres реализует domain.SupportRepo.
type SupportPostgres struct {
	pool *pgxpool.Pool
}

// NewSupportPostgres конструктор.
func NewSupportPostgres(pool *pgxpool.Pool) *SupportPostgres {
	return &SupportPostgres{pool: pool}
}

// Create вставляет новый ticket. ID/CreatedAt берутся из домена (генерятся
// handler'ом), здесь просто пишем как есть.
func (p *SupportPostgres) Create(ctx context.Context, t *domain.SupportTicket) error {
	var userID any
	if t.UserID != nil {
		userID = sharedpg.UUID(*t.UserID)
	}
	row := p.pool.QueryRow(ctx, `
		INSERT INTO support_tickets
		    (id, user_id, contact_kind, contact_value, subject, message, status, created_at)
		VALUES
		    ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at, updated_at
	`,
		t.ID, userID, t.ContactKind, t.ContactValue, t.Subject, t.Message, t.Status, t.CreatedAt,
	)
	if err := row.Scan(&t.CreatedAt, &t.UpdatedAt); err != nil {
		return fmt.Errorf("notify.pg.CreateSupportTicket: %w", err)
	}
	return nil
}

// Get загружает ticket по id.
func (p *SupportPostgres) Get(ctx context.Context, id uuid.UUID) (domain.SupportTicket, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT id, user_id, contact_kind, contact_value, subject, message,
		       status, internal_note, created_at, updated_at, resolved_at
		  FROM support_tickets
		 WHERE id = $1
	`, id)
	t, err := scanSupportTicket(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SupportTicket{}, domain.ErrNotFound
		}
		return domain.SupportTicket{}, fmt.Errorf("notify.pg.GetSupportTicket: %w", err)
	}
	return t, nil
}

// List возвращает страницу ticket'ов с DESC сортировкой по created_at.
func (p *SupportPostgres) List(
	ctx context.Context,
	statusFilter domain.SupportStatus,
	limit, offset int,
) ([]domain.SupportTicket, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := p.pool.Query(ctx, `
		SELECT id, user_id, contact_kind, contact_value, subject, message,
		       status, internal_note, created_at, updated_at, resolved_at
		  FROM support_tickets
		 WHERE ($1::text = '' OR status = $1)
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2 OFFSET $3
	`, statusFilter, int32(limit), int32(offset))
	if err != nil {
		return nil, fmt.Errorf("notify.pg.ListSupportTickets: %w", err)
	}
	defer rows.Close()

	out := make([]domain.SupportTicket, 0, limit)
	for rows.Next() {
		t, err := scanSupportTicket(rows)
		if err != nil {
			return nil, fmt.Errorf("notify.pg.ListSupportTickets: scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notify.pg.ListSupportTickets: rows: %w", err)
	}
	return out, nil
}

// UpdateStatus меняет статус и опционально добавляет internal_note.
// Если status == resolved — стампит resolved_at.
func (p *SupportPostgres) UpdateStatus(
	ctx context.Context,
	id uuid.UUID,
	status domain.SupportStatus,
	internalNote string,
) error {
	var resolvedAt any
	if status == domain.SupportStatusResolved {
		resolvedAt = time.Now().UTC()
	}
	tag, err := p.pool.Exec(ctx, `
		UPDATE support_tickets
		   SET status        = $2,
		       internal_note = COALESCE(NULLIF($3, ''), internal_note),
		       resolved_at   = COALESCE($4, resolved_at),
		       updated_at    = now()
		 WHERE id = $1
	`, id, status, internalNote, resolvedAt)
	if err != nil {
		return fmt.Errorf("notify.pg.UpdateSupportStatus: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// scanSupportTicket — общий ряд-сканнер для SELECT * ... FROM support_tickets.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSupportTicket(r rowScanner) (domain.SupportTicket, error) {
	var (
		t          domain.SupportTicket
		userID     pgxNullableUUID
		resolvedAt pgxNullableTime
	)
	if err := r.Scan(
		&t.ID,
		&userID,
		&t.ContactKind,
		&t.ContactValue,
		&t.Subject,
		&t.Message,
		&t.Status,
		&t.InternalNote,
		&t.CreatedAt,
		&t.UpdatedAt,
		&resolvedAt,
	); err != nil {
		return domain.SupportTicket{}, fmt.Errorf("scan support_ticket: %w", err)
	}
	if userID.Valid {
		uid := userID.UUID
		t.UserID = &uid
	}
	if resolvedAt.Valid {
		t.ResolvedAt = &resolvedAt.Time
	}
	return t, nil
}

// pgxNullableUUID — обёртка вокруг pgtype.UUID, которая знает как стать
// *uuid.UUID. Лежит здесь, не в общем helpers, т.к. больше нигде в notify
// не используется.
type pgxNullableUUID struct {
	UUID  uuid.UUID
	Valid bool
}

func (n *pgxNullableUUID) Scan(src any) error {
	if src == nil {
		n.Valid = false
		return nil
	}
	switch v := src.(type) {
	case [16]byte:
		n.UUID = uuid.UUID(v)
		n.Valid = true
	case string:
		u, err := uuid.Parse(v)
		if err != nil {
			return fmt.Errorf("scan UUID: %w", err)
		}
		n.UUID = u
		n.Valid = true
	default:
		return fmt.Errorf("scan UUID: unsupported type %T", src)
	}
	return nil
}

type pgxNullableTime struct {
	Time  time.Time
	Valid bool
}

func (n *pgxNullableTime) Scan(src any) error {
	if src == nil {
		n.Valid = false
		return nil
	}
	switch v := src.(type) {
	case time.Time:
		n.Time = v.UTC()
		n.Valid = true
	default:
		return fmt.Errorf("scan time: unsupported type %T", src)
	}
	return nil
}
