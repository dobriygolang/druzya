// notification_templates_repo.go — Admin Phase 2: pg adapter.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NotificationTemplates persistence adapter.
type NotificationTemplates struct {
	pool *pgxpool.Pool
}

// NewNotificationTemplates wraps a pool.
func NewNotificationTemplates(pool *pgxpool.Pool) *NotificationTemplates {
	return &NotificationTemplates{pool: pool}
}

// Compile-time check.
var _ domain.NotificationTemplateRepo = (*NotificationTemplates)(nil)

const notifTemplateColumns = `id, slug, channel, subject_template, body_template, variables, description, is_active, created_by, created_at, updated_at`

// List supports optional channel filter + activeOnly.
func (r *NotificationTemplates) List(ctx context.Context, channel string, activeOnly bool) ([]domain.NotificationTemplate, error) {
	q := `SELECT ` + notifTemplateColumns + ` FROM notification_templates WHERE 1=1`
	args := []any{}
	idx := 1
	if channel != "" {
		q += fmt.Sprintf(` AND channel = $%d`, idx)
		args = append(args, channel)
		idx++
	}
	if activeOnly {
		q += ` AND is_active = TRUE`
	}
	q += ` ORDER BY channel ASC, slug ASC`

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("notification_templates.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.NotificationTemplate, 0, 8)
	for rows.Next() {
		t, err := scanNotificationTemplate(rows)
		if err != nil {
			return nil, fmt.Errorf("notification_templates.List.scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notification_templates.List.rows: %w", err)
	}
	return out, nil
}

// GetByID returns one template; ErrNotFound when missing.
func (r *NotificationTemplates) GetByID(ctx context.Context, id uuid.UUID) (domain.NotificationTemplate, error) {
	q := `SELECT ` + notifTemplateColumns + ` FROM notification_templates WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	out, err := scanNotificationTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NotificationTemplate{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.GetByID: %w", err)
	}
	return out, nil
}

// Create — INSERT + RETURNING.
func (r *NotificationTemplates) Create(ctx context.Context, in domain.NotificationTemplateUpsert) (domain.NotificationTemplate, error) {
	vars := in.Variables
	if vars == nil {
		vars = []string{}
	}
	varsJSON, err := json.Marshal(vars)
	if err != nil {
		return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.Create.marshal: %w", err)
	}
	q := `
		INSERT INTO notification_templates (
			slug, channel, subject_template, body_template, variables, description, is_active, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING ` + notifTemplateColumns

	row := r.pool.QueryRow(ctx, q,
		in.Slug, in.Channel, in.SubjectTemplate, in.BodyTemplate, varsJSON,
		in.Description, in.IsActive, in.CreatedBy,
	)
	out, err := scanNotificationTemplate(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.NotificationTemplate{}, fmt.Errorf("%w: slug taken", domain.ErrConflict)
		}
		return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.Create: %w", err)
	}
	return out, nil
}

// Update — dynamic SET.
func (r *NotificationTemplates) Update(ctx context.Context, id uuid.UUID, in domain.NotificationTemplatePatch) (domain.NotificationTemplate, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	idx := 1
	add := func(col string, val any) {
		sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
		args = append(args, val)
		idx++
	}
	if in.Channel != nil {
		add("channel", *in.Channel)
	}
	if in.SubjectTemplate != nil {
		add("subject_template", *in.SubjectTemplate)
	}
	if in.BodyTemplate != nil {
		add("body_template", *in.BodyTemplate)
	}
	if in.Variables != nil {
		vars := *in.Variables
		if vars == nil {
			vars = []string{}
		}
		raw, err := json.Marshal(vars)
		if err != nil {
			return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.Update.marshal: %w", err)
		}
		add("variables", raw)
	}
	if in.Description != nil {
		add("description", *in.Description)
	}
	if in.IsActive != nil {
		add("is_active", *in.IsActive)
	}

	args = append(args, id)
	q := fmt.Sprintf(
		`UPDATE notification_templates SET %s WHERE id = $%d RETURNING %s`,
		strings.Join(sets, ", "), idx, notifTemplateColumns,
	)

	row := r.pool.QueryRow(ctx, q, args...)
	out, err := scanNotificationTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NotificationTemplate{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.Update: %w", err)
	}
	return out, nil
}

// Deactivate — soft delete.
func (r *NotificationTemplates) Deactivate(ctx context.Context, id uuid.UUID) error {
	const q = `UPDATE notification_templates SET is_active = FALSE, updated_at = now() WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("notification_templates.Deactivate: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func scanNotificationTemplate(row scannable) (domain.NotificationTemplate, error) {
	var (
		out     domain.NotificationTemplate
		raw     []byte
		creator *uuid.UUID
	)
	err := row.Scan(
		&out.ID, &out.Slug, &out.Channel, &out.SubjectTemplate, &out.BodyTemplate,
		&raw, &out.Description, &out.IsActive, &creator,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return domain.NotificationTemplate{}, err
	}
	out.CreatedBy = creator
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out.Variables); err != nil {
			return domain.NotificationTemplate{}, fmt.Errorf("notification_templates.scan.variables: %w", err)
		}
	}
	if out.Variables == nil {
		out.Variables = []string{}
	}
	return out, nil
}
