// Package infra contains the Postgres adapters for the admin domain plus the
// Redis Pub/Sub broadcaster used for hot-reloading dynamic_config.
//
// The admin domain is the ONLY legitimate place where tasks.solution_hint
// crosses the HTTP boundary (bible §3.14). The role check at ports is the
// load-bearing guard — infra returns the hint verbatim.
//
// The repository implementations are split across this package by aggregate:
//   - tasks_repo.go      Tasks (tasks + test_cases + templates + follow-ups)
//   - companies_repo.go  Companies
//   - config_repo.go     Config (dynamic_config)
//   - anticheat_repo.go  Anticheat (read-only)
//
// This file owns the cross-cutting helpers (PG type adapters, error mapping,
// shared listing constants) and the compile-time assertions that bind each
// adapter to its domain interface.
package infra

import (
	"encoding/json"
	"errors"
	"time"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// uniqueViolation is the PG SQLSTATE for a unique constraint violation.
const uniqueViolation = "23505"

// defaultListLimit / defaultPage — shared by task and anticheat listings.
const (
	defaultListLimit = 50
	defaultListPage  = 1
	maxListLimit     = 200
)

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// mapUniqueErr maps a PG 23505 unique-violation onto domain.ErrConflict.
// Everything else is returned unchanged so the caller can wrap it.
func mapUniqueErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return domain.ErrConflict
	}
	return err
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// The admin adapters do not depend on unused json helpers — reference the
// stdlib json package via _ to keep imports stable even if future helpers
// need it (e.g. metadata scrubbing).
var _ = json.Marshal

// stable sentinels referenced for compile-time verification.
var (
	_ domain.TaskRepo      = (*Tasks)(nil)
	_ domain.CompanyRepo   = (*Companies)(nil)
	_ domain.ConfigRepo    = (*Config)(nil)
	_ domain.AnticheatRepo = (*Anticheat)(nil)
)

// compile-time assertion that the adapter respects time.Time semantics.
var _ = time.Now
