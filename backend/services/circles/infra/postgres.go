// Package infra — hand-rolled pgx adapters for circles.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/circles/domain"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Circles struct {
	pool *pgxpool.Pool
}

func NewCircles(pool *pgxpool.Pool) *Circles { return &Circles{pool: pool} }

func (r *Circles) Create(ctx context.Context, c domain.Circle) (domain.Circle, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`INSERT INTO circles (id, name, description, owner_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(c.ID), c.Name, c.Description, sharedpg.UUID(c.OwnerID),
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Circle{}, fmt.Errorf("circles.Circles.Create: %w", err)
	}
	out := c
	out.ID = sharedpg.UUIDFrom(id)
	out.CreatedAt = createdAt
	out.UpdatedAt = updatedAt
	return out, nil
}

func (r *Circles) Get(ctx context.Context, id uuid.UUID) (domain.Circle, error) {
	var (
		rowID     pgtype.UUID
		name      string
		desc      string
		ownerID   pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, description, owner_id, created_at, updated_at
		   FROM circles WHERE id=$1`,
		sharedpg.UUID(id),
	).Scan(&rowID, &name, &desc, &ownerID, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Circle{}, domain.ErrNotFound
		}
		return domain.Circle{}, fmt.Errorf("circles.Circles.Get: %w", err)
	}
	return domain.Circle{
		ID:          sharedpg.UUIDFrom(rowID),
		Name:        name,
		Description: desc,
		OwnerID:     sharedpg.UUIDFrom(ownerID),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}, nil
}

func (r *Circles) ListByMember(ctx context.Context, userID uuid.UUID) ([]domain.Circle, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT c.id, c.name, c.description, c.owner_id, c.created_at, c.updated_at
		   FROM circles c
		   JOIN circle_members m ON m.circle_id = c.id
		  WHERE m.user_id = $1
		  ORDER BY c.updated_at DESC
		  LIMIT 200`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("circles.Circles.ListByMember: %w", err)
	}
	defer rows.Close()
	var out []domain.Circle
	for rows.Next() {
		var (
			rowID     pgtype.UUID
			name      string
			desc      string
			ownerID   pgtype.UUID
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&rowID, &name, &desc, &ownerID, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("circles.Circles.ListByMember scan: %w", err)
		}
		out = append(out, domain.Circle{
			ID:          sharedpg.UUIDFrom(rowID),
			Name:        name,
			Description: desc,
			OwnerID:     sharedpg.UUIDFrom(ownerID),
			CreatedAt:   createdAt,
			UpdatedAt:   updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("circles.Circles.ListByMember rows: %w", err)
	}
	return out, nil
}

func (r *Circles) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM circles WHERE id=$1`, sharedpg.UUID(id))
	if err != nil {
		return fmt.Errorf("circles.Circles.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *Circles) CountMembers(ctx context.Context, circleID uuid.UUID) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM circle_members WHERE circle_id=$1`,
		sharedpg.UUID(circleID),
	).Scan(&n); err != nil {
		return 0, fmt.Errorf("circles.Circles.CountMembers: %w", err)
	}
	return n, nil
}

type Members struct {
	pool *pgxpool.Pool
}

func NewMembers(pool *pgxpool.Pool) *Members { return &Members{pool: pool} }

func (r *Members) Add(ctx context.Context, in domain.Member) (domain.Member, error) {
	if !in.Role.Valid() {
		return domain.Member{}, fmt.Errorf("invalid role %q: %w", in.Role, domain.ErrConflict)
	}
	var joinedAt time.Time
	err := r.pool.QueryRow(ctx,
		`INSERT INTO circle_members (circle_id, user_id, role, joined_at)
		 VALUES ($1, $2, $3, COALESCE(NULLIF($4, '0001-01-01 00:00:00+00'::timestamptz), now()))
		 ON CONFLICT (circle_id, user_id) DO UPDATE SET role = EXCLUDED.role
		 RETURNING joined_at`,
		sharedpg.UUID(in.CircleID), sharedpg.UUID(in.UserID), string(in.Role),
		pgtype.Timestamptz{Time: in.JoinedAt, Valid: !in.JoinedAt.IsZero()},
	).Scan(&joinedAt)
	if err != nil {
		return domain.Member{}, fmt.Errorf("circles.Members.Add: %w", err)
	}
	out := in
	out.JoinedAt = joinedAt
	return out, nil
}

func (r *Members) Remove(ctx context.Context, circleID, userID uuid.UUID) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM circle_members WHERE circle_id=$1 AND user_id=$2`,
		sharedpg.UUID(circleID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("circles.Members.Remove: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *Members) GetRole(ctx context.Context, circleID, userID uuid.UUID) (domain.Role, error) {
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role FROM circle_members WHERE circle_id=$1 AND user_id=$2`,
		sharedpg.UUID(circleID), sharedpg.UUID(userID),
	).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("circles.Members.GetRole: %w", err)
	}
	r2 := domain.Role(role)
	if !r2.Valid() {
		return "", fmt.Errorf("invalid role %q from db", role)
	}
	return r2, nil
}

func (r *Members) List(ctx context.Context, circleID uuid.UUID) ([]domain.MemberWithUsername, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT m.circle_id, m.user_id, m.role, m.joined_at, COALESCE(u.username,'')
		   FROM circle_members m
		   LEFT JOIN users u ON u.id = m.user_id
		  WHERE m.circle_id=$1
		  ORDER BY m.joined_at ASC`,
		sharedpg.UUID(circleID),
	)
	if err != nil {
		return nil, fmt.Errorf("circles.Members.List: %w", err)
	}
	defer rows.Close()
	var out []domain.MemberWithUsername
	for rows.Next() {
		var (
			cID      pgtype.UUID
			uID      pgtype.UUID
			role     string
			joinedAt time.Time
			username string
		)
		if err := rows.Scan(&cID, &uID, &role, &joinedAt, &username); err != nil {
			return nil, fmt.Errorf("circles.Members.List scan: %w", err)
		}
		out = append(out, domain.MemberWithUsername{
			Member: domain.Member{
				CircleID: sharedpg.UUIDFrom(cID),
				UserID:   sharedpg.UUIDFrom(uID),
				Role:     domain.Role(role),
				JoinedAt: joinedAt,
			},
			Username: username,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("circles.Members.List rows: %w", err)
	}
	return out, nil
}

var (
	_ domain.CircleRepo = (*Circles)(nil)
	_ domain.MemberRepo = (*Members)(nil)
)
