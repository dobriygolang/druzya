// atlas_allocate.go — POST /profile/me/atlas/allocate use case.
//
// Frontend Atlas page lets the user "spend a point" on a skill node. The
// backend persists this as a row in skill_nodes (user_id, node_key) with a
// small starter progress (=5%) so the node renders as `active` rather than
// `not_started` immediately, and the existing GetAtlas reachability BFS
// can decide whether neighbours become unlock-eligible on next read.
//
// Anti-fallback:
//   - empty skill_id ⇒ ErrInvalid (400 in ports)
//   - unknown skill_id ⇒ domain.ErrNotFound (404 in ports)
//   - re-allocating same skill is a no-op (idempotent): repo upsert keeps
//     existing progress via GREATEST(stored, incoming) so we never regress
//     a node that the user has already advanced past 5%.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// AtlasAllocateStarterProgress is the small starter signal written into
// skill_nodes.progress when a user allocates a fresh node. Picked at 5 so
// the frontend's `progress < 1 ⇒ not_started, else active` heuristic
// flips to `active` immediately, while still leaving 95 points of headroom
// for actual practice to fill.
const AtlasAllocateStarterProgress = 5

// ErrInvalid is the validation sentinel raised by app-layer use cases.
// Ports map it to HTTP 400 / connect.CodeInvalidArgument.
var ErrInvalid = errors.New("profile: invalid argument")

// AllocateAtlasNode upserts a starter skill_nodes row for the given user.
// Idempotent: re-allocating the same node returns the current row without
// regressing progress.
type AllocateAtlasNode struct {
	Repo domain.ProfileRepo
	Log  *slog.Logger
}

// NewAllocateAtlasNode validates dependencies. Anti-fallback: nil repo /
// nil logger panic at wiring time so a misconfigured monolith binary
// fails fast rather than silently no-op'ing every allocation.
func NewAllocateAtlasNode(repo domain.ProfileRepo, log *slog.Logger) *AllocateAtlasNode {
	if repo == nil {
		panic("profile.NewAllocateAtlasNode: repo is required")
	}
	if log == nil {
		panic("profile.NewAllocateAtlasNode: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &AllocateAtlasNode{Repo: repo, Log: log}
}

// Do validates skill_id, then upserts via the repo.
func (uc *AllocateAtlasNode) Do(ctx context.Context, userID uuid.UUID, skillID string) (domain.SkillNode, error) {
	skillID = strings.TrimSpace(skillID)
	if skillID == "" {
		return domain.SkillNode{}, fmt.Errorf("profile.AllocateAtlasNode: %w: skill_id is required", ErrInvalid)
	}
	out, err := uc.Repo.UpsertSkillNode(ctx, userID, skillID, AtlasAllocateStarterProgress)
	if err != nil {
		return domain.SkillNode{}, fmt.Errorf("profile.AllocateAtlasNode: %w", err)
	}
	uc.Log.InfoContext(ctx, "profile: atlas node allocated",
		slog.Any("user_id", userID),
		slog.String("skill_id", skillID),
		slog.Int("progress", out.Progress))
	return out, nil
}
