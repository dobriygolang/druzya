// canvas_draft.go — Redis fallback store for the system-design canvas
// autosave. Frontend's primary autosave target is localStorage; this
// store only fires when the browser's quota is exhausted (huge diagrams
// with embedded images), which is rare.
//
// Lifecycle:
//   - PUT /mock/attempts/{id}/canvas-draft writes here with 24h TTL.
//   - GET /mock/attempts/{id}/canvas-draft reads it back on restore.
//   - DELETE on submit success + on pipeline Finish/Cancel.
//
// Drafts NEVER drive judging — Submit posts the freshest scene/PNG
// directly. The store is purely a tab-close safety net.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CanvasDraftMaxBytes — hard cap on the serialised draft payload. 5MB
// matches the LocalStorage typical quota and the existing PNG cap on
// SubmitCanvas. Anything bigger is rejected as ErrValidation.
const CanvasDraftMaxBytes = 5 * 1024 * 1024

// CanvasDraftTTL — Redis EXPIRE on each write. Long enough to survive
// a coffee break and a browser restart, short enough to keep the
// dataset bounded under load.
const CanvasDraftTTL = 24 * time.Hour

// CanvasDraft is the in-flight state of a sysdesign-canvas attempt.
type CanvasDraft struct {
	// SceneJSON is the raw Excalidraw scene blob (elements + files).
	// Stored as JSON-marshalled bytes — the store doesn't reinterpret.
	SceneJSON []byte
	// NonFunctionalMD / ContextMD are the markdown side-panes.
	NonFunctionalMD string
	ContextMD       string
	// UpdatedAt is wall-clock at write time (server-side).
	UpdatedAt time.Time
}

// CanvasDraftStore — Redis-backed adapter (see infra/redis_canvas_drafts.go).
//
//   - Save MUST refuse payloads above CanvasDraftMaxBytes with ErrValidation.
//   - Get MUST return ErrNotFound on a miss.
//   - Delete MUST be idempotent (no error on missing key).
type CanvasDraftStore interface {
	Save(ctx context.Context, attemptID uuid.UUID, draft CanvasDraft) error
	Get(ctx context.Context, attemptID uuid.UUID) (CanvasDraft, error)
	Delete(ctx context.Context, attemptID uuid.UUID) error
}
