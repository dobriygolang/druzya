package services

import (
	"context"
	"errors"
	"fmt"

	authApp "druz9/auth/app"
	authDomain "druz9/auth/domain"
	honeDomain "druz9/hone/domain"
	notifyDomain "druz9/notify/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Three near-identical adapters bridge the auth package's TokenIssuer to
// each WS hub's TokenVerifier port. They differ only in method name —
// arena uses `VerifyAccess`, ai_mock and editor use `Verify` — which keeps
// each domain free of an auth-package import.

// arenaTokenVerifier satisfies druz9/arena/ports.TokenVerifier.
type arenaTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a arenaTokenVerifier) VerifyAccess(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

// mockTokenVerifier satisfies druz9/ai_mock/domain.TokenVerifier.
type mockTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a mockTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

// editorTokenVerifier satisfies druz9/editor/domain.TokenVerifier.
type editorTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a editorTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

func parseSubject(issuer *authApp.TokenIssuer, raw string) (uuid.UUID, error) {
	claims, err := issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	return uid, nil
}

// telegramCodeFillerAdapter bridges notify.domain.CodeFiller (the bot's
// abstraction) onto auth.domain.TelegramCodeRepo (the Redis-backed store).
// It also translates the cross-domain payload type. Errors are mapped to
// notify.ErrNotFound so the bot's reply branching stays uniform.
type telegramCodeFillerAdapter struct{ repo authDomain.TelegramCodeRepo }

// NewTelegramCodeFillerAdapter exposes the adapter for monolith wiring.
func NewTelegramCodeFillerAdapter(repo authDomain.TelegramCodeRepo) notifyDomain.CodeFiller {
	return telegramCodeFillerAdapter{repo: repo}
}

// Fill implements notify.domain.CodeFiller.
func (a telegramCodeFillerAdapter) Fill(ctx context.Context, code string, p notifyDomain.TelegramAuthPayload) error {
	if err := a.repo.Fill(ctx, code, authDomain.TelegramPayload{
		ID:        p.ID,
		FirstName: p.FirstName,
		LastName:  p.LastName,
		Username:  p.Username,
		PhotoURL:  p.PhotoURL,
		AuthDate:  p.AuthDate,
		Hash:      p.Hash,
	}); err != nil {
		// Translate the auth-domain sentinel into the notify-domain one so
		// the bot dispatcher can keep its single check on notifyDomain.ErrNotFound.
		if errors.Is(err, authDomain.ErrCodeNotFound) {
			return notifyDomain.ErrNotFound
		}
		return fmt.Errorf("monolith.telegramCodeFillerAdapter: %w", err)
	}
	return nil
}

// ─── Hone → profile skill-atlas shim ──────────────────────────────────────

// honeSkillAtlasAdapter bridges hone.domain.SkillAtlasReader to the profile
// service's `skill_nodes` + `atlas_nodes` tables via a direct pgx query.
//
// Why hand-rolled (not via profile.ProfileRepo.ListSkillNodes + per-node
// title lookup):
//   - The N+1 pattern (list user nodes → per-node atlas lookup) is wasteful
//     when we only want the bottom 5 by progress.
//   - The profile package owns the full-atlas query; a "weakest-N" view is
//     hone-specific and belongs at the adapter layer, not in the profile
//     domain interface.
//   - Cross-domain boundary is preserved: hone never imports profile; the
//     adapter speaks raw SQL against tables that are public by virtue of
//     living in the shared Postgres instance.
//
// Priority derivation: progress < 30 → high, 30-60 → medium, 60+ → low.
// Anti-fallback: when the user has no skill_nodes rows (brand new), we
// return an empty slice. Hone's plan synthesiser explicitly handles the
// "no weak nodes known" case with a generic-plan prompt.
type honeSkillAtlasAdapter struct {
	pool *pgxpool.Pool
}

// NewHoneSkillAtlasAdapter exposes the adapter for monolith wiring.
func NewHoneSkillAtlasAdapter(pool *pgxpool.Pool) honeDomain.SkillAtlasReader {
	return &honeSkillAtlasAdapter{pool: pool}
}

// WeakestNodes queries the bottom-N by progress, joined with atlas_nodes.title.
func (a *honeSkillAtlasAdapter) WeakestNodes(ctx context.Context, userID uuid.UUID, limit int) ([]honeDomain.WeakNode, error) {
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	rows, err := a.pool.Query(ctx,
		`SELECT sn.node_key, COALESCE(an.title, sn.node_key), sn.progress
		   FROM skill_nodes sn
		   LEFT JOIN atlas_nodes an ON an.id = sn.node_key AND an.is_active = TRUE
		  WHERE sn.user_id = $1
		  ORDER BY sn.progress ASC, sn.updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), int32(limit),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("monolith.honeSkillAtlasAdapter.WeakestNodes: %w", err)
	}
	defer rows.Close()
	out := make([]honeDomain.WeakNode, 0, limit)
	for rows.Next() {
		var (
			nodeKey  string
			title    string
			progress int32
		)
		if err := rows.Scan(&nodeKey, &title, &progress); err != nil {
			return nil, fmt.Errorf("monolith.honeSkillAtlasAdapter.WeakestNodes: scan: %w", err)
		}
		out = append(out, honeDomain.WeakNode{
			NodeKey:     nodeKey,
			DisplayName: title,
			Progress:    int(progress),
			Priority:    priorityForProgress(int(progress)),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("monolith.honeSkillAtlasAdapter.WeakestNodes: rows: %w", err)
	}
	return out, nil
}

func priorityForProgress(p int) string {
	switch {
	case p < 30:
		return "high"
	case p < 60:
		return "medium"
	default:
		return "low"
	}
}
