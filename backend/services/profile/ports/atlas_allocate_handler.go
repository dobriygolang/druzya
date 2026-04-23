// atlas_allocate_handler.go — chi-direct handler for
// POST /api/v1/profile/me/atlas/allocate.
//
// Lives outside the Connect/transcoder mux because the route is a small
// REST-only operation tied to the frontend Atlas page; adding a proto RPC
// would force a regen across every service binary for negligible upside
// (mirrors the rationale in atlas_admin_handler.go).
//
// Request body:
//
//	{ "skill_id": "two-pointers" }
//
// Responses:
//
//	200 — { skill node JSON }       (happy path; idempotent on re-allocate)
//	400 — empty / missing skill_id
//	404 — skill_id is not a known atlas node
//	500 — unexpected repo failure (wrapped error logged)
package ports

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"druz9/profile/app"
	"druz9/profile/domain"
	sharedMw "druz9/shared/pkg/middleware"
)

// AtlasAllocateHandler exposes POST /profile/me/atlas/allocate.
type AtlasAllocateHandler struct {
	UC  *app.AllocateAtlasNode
	Log *slog.Logger
}

// NewAtlasAllocateHandler validates deps. Anti-fallback: nil panics.
func NewAtlasAllocateHandler(uc *app.AllocateAtlasNode, log *slog.Logger) *AtlasAllocateHandler {
	if uc == nil {
		panic("profile.NewAtlasAllocateHandler: use case is required")
	}
	if log == nil {
		panic("profile.NewAtlasAllocateHandler: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	return &AtlasAllocateHandler{UC: uc, Log: log}
}

type allocateRequest struct {
	SkillID string `json:"skill_id"`
}

type allocateResponseNode struct {
	Key        string `json:"key"`
	Progress   int    `json:"progress"`
	Unlocked   bool   `json:"unlocked"`
	UnlockedAt string `json:"unlocked_at,omitempty"`
	UpdatedAt  string `json:"updated_at,omitempty"`
}

// Handle implements POST /profile/me/atlas/allocate.
func (h *AtlasAllocateHandler) Handle(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONErrAtlas(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var body allocateRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErrAtlas(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	out, err := h.UC.Do(r.Context(), uid, body.SkillID)
	if err != nil {
		switch {
		case errors.Is(err, app.ErrInvalid):
			writeJSONErrAtlas(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, domain.ErrNotFound):
			writeJSONErrAtlas(w, http.StatusNotFound, "skill_id not found in atlas catalogue")
		default:
			h.Log.Error("profile.atlas-allocate: unexpected error", slog.Any("err", err))
			writeJSONErrAtlas(w, http.StatusInternalServerError, "atlas allocate failure")
		}
		return
	}
	resp := allocateResponseNode{
		Key:      out.NodeKey,
		Progress: out.Progress,
		Unlocked: out.UnlockedAt != nil,
	}
	if out.UnlockedAt != nil {
		resp.UnlockedAt = out.UnlockedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	if !out.UpdatedAt.IsZero() {
		resp.UpdatedAt = out.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	writeJSONOK(w, resp)
}
