// Package infra — Postgres adapter for the Custom-Lobby bounded context.
//
// Implements druz9/lobby/domain.Repo with pgx/v5. Extracted verbatim from
// cmd/monolith/services/circles/lobby.go so the wiring in monolith stays
// thin (handlers + cross-context arena adapter only). SQL queries are
// preserved 1:1 — no schema or behavior changes here.
package infra

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	lobbyDomain "druz9/lobby/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LobbyPostgres is a hand-rolled pgx adapter for lobbyDomain.Repo.
type LobbyPostgres struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewLobbyPostgres wires the adapter. Both deps are required — nil pool or
// nil log panic at construction so misconfiguration surfaces immediately at
// boot rather than under traffic.
func NewLobbyPostgres(pool *pgxpool.Pool, log *slog.Logger) *LobbyPostgres {
	if log == nil {
		panic("circles/infra.NewLobbyPostgres: nil logger")
	}
	if pool == nil {
		panic("circles/infra.NewLobbyPostgres: nil pool")
	}
	return &LobbyPostgres{pool: pool, log: log}
}

// isLobbyUniqueViolationErr — SQLSTATE 23505 sniff.
func isLobbyUniqueViolationErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

func lobPgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func lobFromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

// generateLobbyCode returns a fresh 4-letter A-Z code. Uses crypto/rand so
// codes are not predictable — guessing-rate attacks against private lobbies
// stay at 26^4 ≈ 457k expected tries.
func generateLobbyCode() (string, error) {
	var buf [lobbyDomain.CodeLength]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("lobby.code: rand: %w", err)
	}
	out := make([]byte, lobbyDomain.CodeLength)
	for i, b := range buf {
		out[i] = 'A' + (b % 26)
	}
	return string(out), nil
}

// Create inserts the lobby row + owner membership atomically. Generates the
// lobby code with retry-on-UNIQUE-collision up to MaxCodeRetries.
func (p *LobbyPostgres) Create(ctx context.Context, l lobbyDomain.Lobby) (lobbyDomain.Lobby, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertLobby = `
		INSERT INTO lobbies(
			id, code, owner_id, mode, section, difficulty, visibility,
			max_members, ai_allowed, time_limit_min, status,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		RETURNING code, created_at, updated_at`

	var (
		out      lobbyDomain.Lobby = l
		gotCode  string
		created  time.Time
		updated  time.Time
		attempts int
	)
	for attempts = 0; attempts < lobbyDomain.MaxCodeRetries; attempts++ {
		code, cerr := generateLobbyCode()
		if cerr != nil {
			return lobbyDomain.Lobby{}, cerr
		}
		err = tx.QueryRow(ctx, insertLobby,
			lobPgUUID(l.ID), code, lobPgUUID(l.OwnerID),
			string(l.Mode), l.Section, l.Difficulty, string(l.Visibility),
			int16(l.MaxMembers), l.AIAllowed, int16(l.TimeLimitMin), string(l.Status),
			l.CreatedAt,
		).Scan(&gotCode, &created, &updated)
		if err == nil {
			out.Code = gotCode
			out.CreatedAt = created
			out.UpdatedAt = updated
			break
		}
		if isLobbyUniqueViolationErr(err) {
			p.log.WarnContext(ctx, "lobby.pg.Create: code collision, retrying", slog.String("code", code))
			continue
		}
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: insert: %w", err)
	}
	if attempts == lobbyDomain.MaxCodeRetries {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: %w", lobbyDomain.ErrCodeExhausted)
	}

	// Owner membership row (team=1).
	if _, err := tx.Exec(ctx,
		`INSERT INTO lobby_members(lobby_id, user_id, role, team)
		 VALUES ($1,$2,'owner',1)`,
		lobPgUUID(out.ID), lobPgUUID(out.OwnerID),
	); err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: owner member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: commit: %w", err)
	}
	return out, nil
}

func (p *LobbyPostgres) Get(ctx context.Context, id uuid.UUID) (lobbyDomain.Lobby, error) {
	const q = `SELECT id, code, owner_id, mode, section, difficulty, visibility,
		              max_members, ai_allowed, time_limit_min, status, match_id,
		              created_at, updated_at
		         FROM lobbies WHERE id = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, lobPgUUID(id)))
}

func (p *LobbyPostgres) GetByCode(ctx context.Context, code string) (lobbyDomain.Lobby, error) {
	const q = `SELECT id, code, owner_id, mode, section, difficulty, visibility,
		              max_members, ai_allowed, time_limit_min, status, match_id,
		              created_at, updated_at
		         FROM lobbies WHERE code = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, strings.ToUpper(code)))
}

type lobbyRow interface {
	Scan(dest ...any) error
}

func (p *LobbyPostgres) scanOne(row lobbyRow) (lobbyDomain.Lobby, error) {
	var (
		id, owner                      pgtype.UUID
		matchID                        pgtype.UUID
		code, mode, sec, diff, vis, st string
		maxMembers, timeLimit          int16
		aiAllowed                      bool
		created, updated               time.Time
	)
	if err := row.Scan(&id, &code, &owner, &mode, &sec, &diff, &vis,
		&maxMembers, &aiAllowed, &timeLimit, &st, &matchID, &created, &updated); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return lobbyDomain.Lobby{}, lobbyDomain.ErrNotFound
		}
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.scan: %w", err)
	}
	out := lobbyDomain.Lobby{
		ID: lobFromPgUUID(id), Code: code, OwnerID: lobFromPgUUID(owner),
		Mode: lobbyDomain.Mode(mode), Section: sec, Difficulty: diff,
		Visibility: lobbyDomain.Visibility(vis),
		MaxMembers: int(maxMembers), AIAllowed: aiAllowed,
		TimeLimitMin: int(timeLimit), Status: lobbyDomain.Status(st),
		CreatedAt: created, UpdatedAt: updated,
	}
	if matchID.Valid {
		mid := lobFromPgUUID(matchID)
		out.MatchID = &mid
	}
	return out, nil
}

func (p *LobbyPostgres) ListPublic(ctx context.Context, f lobbyDomain.ListFilter) ([]lobbyDomain.Lobby, error) {
	parts := []string{"visibility = $1", "status = 'open'"}
	args := []any{string(f.Visibility)}
	if f.Mode != "" {
		args = append(args, string(f.Mode))
		parts = append(parts, fmt.Sprintf("mode = $%d", len(args)))
	}
	if f.Section != "" {
		args = append(args, f.Section)
		parts = append(parts, fmt.Sprintf("section = $%d", len(args)))
	}
	args = append(args, f.Limit)
	q := fmt.Sprintf(`
		SELECT id, code, owner_id, mode, section, difficulty, visibility,
		       max_members, ai_allowed, time_limit_min, status, match_id,
		       created_at, updated_at
		  FROM lobbies
		 WHERE %s
		 ORDER BY created_at DESC
		 LIMIT $%d`, strings.Join(parts, " AND "), len(args))
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("lobby.pg.ListPublic: %w", err)
	}
	defer rows.Close()
	out := make([]lobbyDomain.Lobby, 0, f.Limit)
	for rows.Next() {
		l, err := p.scanOne(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

func (p *LobbyPostgres) AddMember(ctx context.Context, m lobbyDomain.Member) error {
	if _, err := p.pool.Exec(ctx,
		`INSERT INTO lobby_members(lobby_id, user_id, role, team)
		 VALUES ($1,$2,$3,$4)`,
		lobPgUUID(m.LobbyID), lobPgUUID(m.UserID), string(m.Role), int16(m.Team),
	); err != nil {
		if isLobbyUniqueViolationErr(err) {
			return lobbyDomain.ErrAlreadyMember
		}
		return fmt.Errorf("lobby.pg.AddMember: %w", err)
	}
	return nil
}

func (p *LobbyPostgres) RemoveMember(ctx context.Context, lobbyID, userID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM lobby_members WHERE lobby_id=$1 AND user_id=$2`,
		lobPgUUID(lobbyID), lobPgUUID(userID),
	); err != nil {
		return fmt.Errorf("lobby.pg.RemoveMember: %w", err)
	}
	return nil
}

func (p *LobbyPostgres) ListMembers(ctx context.Context, lobbyID uuid.UUID) ([]lobbyDomain.Member, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT lobby_id, user_id, role, team, joined_at
		   FROM lobby_members WHERE lobby_id=$1
		  ORDER BY joined_at ASC`,
		lobPgUUID(lobbyID),
	)
	if err != nil {
		return nil, fmt.Errorf("lobby.pg.ListMembers: %w", err)
	}
	defer rows.Close()
	out := make([]lobbyDomain.Member, 0, 4)
	for rows.Next() {
		var (
			lid, uid pgtype.UUID
			role     string
			team     int16
			joined   time.Time
		)
		if err := rows.Scan(&lid, &uid, &role, &team, &joined); err != nil {
			return nil, fmt.Errorf("lobby.pg.ListMembers: scan: %w", err)
		}
		out = append(out, lobbyDomain.Member{
			LobbyID: lobFromPgUUID(lid), UserID: lobFromPgUUID(uid),
			Role: lobbyDomain.Role(role), Team: int(team), JoinedAt: joined,
		})
	}
	return out, nil
}

func (p *LobbyPostgres) CountMembers(ctx context.Context, lobbyID uuid.UUID) (int, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM lobby_members WHERE lobby_id=$1`,
		lobPgUUID(lobbyID),
	).Scan(&n); err != nil {
		return 0, fmt.Errorf("lobby.pg.CountMembers: %w", err)
	}
	return n, nil
}

func (p *LobbyPostgres) HasMember(ctx context.Context, lobbyID, userID uuid.UUID) (bool, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM lobby_members WHERE lobby_id=$1 AND user_id=$2`,
		lobPgUUID(lobbyID), lobPgUUID(userID),
	).Scan(&n); err != nil {
		return false, fmt.Errorf("lobby.pg.HasMember: %w", err)
	}
	return n > 0, nil
}

func (p *LobbyPostgres) SetStatus(ctx context.Context, lobbyID uuid.UUID, status lobbyDomain.Status) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE lobbies SET status=$2, updated_at=now() WHERE id=$1`,
		lobPgUUID(lobbyID), string(status),
	); err != nil {
		return fmt.Errorf("lobby.pg.SetStatus: %w", err)
	}
	return nil
}

func (p *LobbyPostgres) SetMatchID(ctx context.Context, lobbyID uuid.UUID, matchID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE lobbies SET match_id=$2, updated_at=now() WHERE id=$1`,
		lobPgUUID(lobbyID), lobPgUUID(matchID),
	); err != nil {
		return fmt.Errorf("lobby.pg.SetMatchID: %w", err)
	}
	return nil
}

// Compile-time interface assertion.
var _ lobbyDomain.Repo = (*LobbyPostgres)(nil)
