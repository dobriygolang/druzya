//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for this domain.
var ErrNotFound = errors.New("editor: not found")

// ErrForbidden is returned when the caller cannot perform an action on the
// room (e.g. non-owner attempts to freeze).
var ErrForbidden = errors.New("editor: forbidden")

// ErrInvalidInvite is returned when an invite token is malformed, tampered
// with, or expired.
var ErrInvalidInvite = errors.New("editor: invalid invite token")

// ErrInvalidState is returned when the room is not in a state that allows the
// requested transition (e.g. write to an expired room).
var ErrInvalidState = errors.New("editor: invalid state")

// ErrSandboxUnavailable is returned when the Judge0 sandbox cannot be reached
// or is not configured. The transport layer maps this to Connect's
// CodeUnavailable (HTTP 503). Anti-fallback policy: we never fabricate a run
// result when we could not actually execute.
var ErrSandboxUnavailable = errors.New("editor: sandbox unavailable")

// ErrRateLimited is returned when the per-user RunCode budget is exhausted.
// The transport layer maps this to Connect's CodeResourceExhausted (HTTP 429).
var ErrRateLimited = errors.New("editor: rate limited")

// RunResult is the domain projection of a Judge0 /submissions response
// mapped to what the UI wants to render under the editor.
type RunResult struct {
	Stdout   string
	Stderr   string
	ExitCode int32
	TimeMs   int32
	Status   string
}

// CodeRunner is the port for a sandboxed one-shot execution backend.
// Implementations live in infra/ (Judge0, or a future stub).
type CodeRunner interface {
	Run(ctx context.Context, code string, language enums.Language) (RunResult, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Room persistence
// ─────────────────────────────────────────────────────────────────────────

// RoomRepo persists editor_rooms rows.
type RoomRepo interface {
	Create(ctx context.Context, r Room) (Room, error)
	Get(ctx context.Context, id uuid.UUID) (Room, error)
	UpdateFreeze(ctx context.Context, id uuid.UUID, frozen bool) (Room, error)
	ExtendExpires(ctx context.Context, id uuid.UUID, newExpires time.Time) error
	SetVisibility(ctx context.Context, id uuid.UUID, v Visibility) error
}

// ParticipantRepo persists editor_participants rows.
type ParticipantRepo interface {
	Add(ctx context.Context, p Participant) (Participant, error)
	List(ctx context.Context, roomID uuid.UUID) ([]Participant, error)
	GetRole(ctx context.Context, roomID, userID uuid.UUID) (enums.EditorRole, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Task — tiny read-only adapter so the editor can surface the TaskPublic
// for interview/pair_mock rooms. Kept narrow so this domain does not
// import ai_mock/ai_native/arena task entities.
// ─────────────────────────────────────────────────────────────────────────

// TaskRepo fetches a client-safe task projection. The editor domain
// never needs solution_hint (it has no LLM grading path), so only the
// public projection is exposed.
type TaskRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (TaskPublic, error)
}

// ─────────────────────────────────────────────────────────────────────────
// Replay
// ─────────────────────────────────────────────────────────────────────────

// ReplayUploader uploads the serialised op/cursor stream for a room to
// object storage and returns a presigned GET URL.
//
// STUB for MVP — infra/replay.go returns a fake URL without actually writing
// anything. The production implementation will do MinIO multipart upload
// under the `editor-replays/` prefix (bible §6 lifecycle policy).
type ReplayUploader interface {
	Upload(ctx context.Context, roomID uuid.UUID, payload []byte) (presignedURL string, expiresAt time.Time, err error)
}

// ─────────────────────────────────────────────────────────────────────────
// TokenVerifier — for WS handshake. Copied shape from ai_mock so the
// editor ports don't depend on the auth domain.
// ─────────────────────────────────────────────────────────────────────────

// TokenVerifier validates a JWT at the WS handshake.
//
// VerifyScoped дополнительно проверяет JWT scope claim:
//   - если token's Scope пустой → unrestricted, accept
//   - если non-empty → должен равняться expectedScope, иначе reject
//
// Используется для guest-токенов: scope = "editor:<roomID>" минтится при
// guest-join, на WS upgrade'е сверяется с URL room_id.
type TokenVerifier interface {
	Verify(raw string) (uuid.UUID, error)
	VerifyScoped(raw string, expectedScope string) (uuid.UUID, error)
}
