// app_installs_repo.go — Phase J / X1 (P0) install-tracking storage.
//
// Hand-rolled pgx (not sqlc) until the next gen-cycle picks up the new
// queries in queries/profile.sql. The shape mirrors UpsertAppInstall +
// ListAppInstalls verbatim so the migration to generated code is a
// drop-in field-name swap.
//
// Idempotency: ON CONFLICT (user_id, app) DO UPDATE SET last_seen_at =
// now(). The RETURNING list includes a synthesised `inserted` boolean
// derived from `xmax = 0` — Postgres semantics make xmax zero on the
// freshly-inserted row and non-zero on a row that was UPDATEd in the
// same statement, so the UC layer can distinguish "brand new install"
// from "heartbeat" without a follow-up SELECT.
//
// The COUNT-before query exists to drive the trial-Pro grant gate:
// «is this the very first install row for this user across all 3
// surfaces». Two-step (count + upsert) instead of CTE'd-everything so
// SAME-transaction semantics are obvious — the trial grant runs in a
// best-effort follow-up call from the UC layer, not from SQL.

package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// UpsertAppInstall implements domain.ProfileRepo.
func (p *Postgres) UpsertAppInstall(
	ctx context.Context,
	userID uuid.UUID,
	app domain.AppSurface,
	appVersion string,
) (domain.AppInstall, bool, int64, error) {
	if !app.IsValid() {
		return domain.AppInstall{}, false, 0, fmt.Errorf("profile.UpsertAppInstall: invalid app %q", app)
	}

	// Count rows BEFORE the upsert so the trial-grant gate sees the
	// state the caller is about to mutate. Same connection — no race
	// with concurrent heartbeats from the same user; worst case we
	// double-issue a trial which the subscription layer idempotently
	// no-ops (already-Pro guard).
	var before int64
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_app_installs WHERE user_id = $1`,
		sharedpg.UUID(userID),
	).Scan(&before); err != nil {
		return domain.AppInstall{}, false, 0, fmt.Errorf("profile.UpsertAppInstall: count: %w", err)
	}

	row := p.pool.QueryRow(ctx, `
		INSERT INTO user_app_installs(user_id, app, app_version)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, app) DO UPDATE
		   SET last_seen_at = now(),
		       app_version  = CASE WHEN EXCLUDED.app_version <> ''
		                           THEN EXCLUDED.app_version
		                           ELSE user_app_installs.app_version END
		RETURNING app, first_seen_at, last_seen_at, app_version, (xmax = 0) AS inserted
	`, sharedpg.UUID(userID), string(app), appVersion)

	var (
		out      domain.AppInstall
		appStr   string
		inserted bool
	)
	if err := row.Scan(&appStr, &out.FirstSeenAt, &out.LastSeenAt, &out.AppVersion, &inserted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AppInstall{}, false, 0, fmt.Errorf("profile.UpsertAppInstall: %w", domain.ErrNotFound)
		}
		return domain.AppInstall{}, false, 0, fmt.Errorf("profile.UpsertAppInstall: upsert: %w", err)
	}
	out.App = domain.AppSurface(appStr)
	return out, inserted, before, nil
}

// ListAppInstalls implements domain.ProfileRepo.
func (p *Postgres) ListAppInstalls(
	ctx context.Context,
	userID uuid.UUID,
) ([]domain.AppInstall, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT app, first_seen_at, last_seen_at, app_version
		  FROM user_app_installs
		 WHERE user_id = $1
		 ORDER BY first_seen_at ASC
	`, sharedpg.UUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.ListAppInstalls: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AppInstall, 0, 3)
	for rows.Next() {
		var (
			it     domain.AppInstall
			appStr string
		)
		if err := rows.Scan(&appStr, &it.FirstSeenAt, &it.LastSeenAt, &it.AppVersion); err != nil {
			return nil, fmt.Errorf("profile.ListAppInstalls: scan: %w", err)
		}
		it.App = domain.AppSurface(appStr)
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.ListAppInstalls: rows: %w", err)
	}
	return out, nil
}
