package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

// Config is the persistence adapter for the dynamic_config table.
type Config struct {
	q *admindb.Queries
}

// NewConfig wraps a pool.
func NewConfig(pool *pgxpool.Pool) *Config {
	return &Config{q: admindb.New(pool)}
}

// List returns every config entry, ordered by key.
func (c *Config) List(ctx context.Context) ([]domain.ConfigEntry, error) {
	rows, err := c.q.ListDynamicConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.Config.List: %w", err)
	}
	out := make([]domain.ConfigEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, configFromRow(r))
	}
	return out, nil
}

// Get returns the entry at `key` or ErrNotFound.
func (c *Config) Get(ctx context.Context, key string) (domain.ConfigEntry, error) {
	row, err := c.q.GetDynamicConfig(ctx, key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ConfigEntry{}, domain.ErrNotFound
		}
		return domain.ConfigEntry{}, fmt.Errorf("admin.Config.Get: %w", err)
	}
	return configFromRow(row), nil
}

// Upsert creates or refreshes a config entry, stamping updated_at=now() and
// updated_by from the caller.
func (c *Config) Upsert(ctx context.Context, entry domain.ConfigEntry, updatedBy *uuid.UUID) (domain.ConfigEntry, error) {
	var by pgtype.UUID
	if updatedBy != nil {
		by = pgUUID(*updatedBy)
	}
	row, err := c.q.UpsertDynamicConfig(ctx, admindb.UpsertDynamicConfigParams{
		Key:         entry.Key,
		Value:       entry.Value,
		Type:        string(entry.Type),
		Description: pgText(entry.Description),
		UpdatedBy:   by,
	})
	if err != nil {
		return domain.ConfigEntry{}, fmt.Errorf("admin.Config.Upsert: %w", err)
	}
	return configFromRow(row), nil
}

func configFromRow(r admindb.DynamicConfig) domain.ConfigEntry {
	out := domain.ConfigEntry{
		Key:         r.Key,
		Value:       append([]byte(nil), r.Value...),
		Type:        domain.ConfigType(r.Type),
		Description: r.Description.String,
		UpdatedAt:   r.UpdatedAt.Time,
	}
	if r.UpdatedBy.Valid {
		u := fromPgUUID(r.UpdatedBy)
		out.UpdatedBy = &u
	}
	return out
}

// pool is unused here today but the constructor signature accepts it for
// symmetry with other repos / future use.
var _ = (*pgxpool.Pool)(nil)
