// yjs_persist.go — use-case'ы Phase C-6 generic Yjs CRDT persistence.
package app

import (
	"errors"
	"fmt"
	"log/slog"

	"context"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// Limits — выровнены с monolith handler'ом.
const (
	YjsAppendMaxBytes  = 1 << 20 // 1 MiB
	YjsCompactMaxBytes = 5 << 20 // 5 MiB
	YjsUpdatesPerPage  = 500
)

// Sentinels.
var (
	// ErrYjsParentNotFound — (userID, parentID) не указывают на существующую
	// строку (note или whiteboard) в parent-таблице.
	ErrYjsParentNotFound = errors.New("hone: yjs parent not found")
	// ErrYjsEmptyBody — нулевая длина тела.
	ErrYjsEmptyBody = errors.New("hone: yjs empty body")
	// ErrYjsBodyTooLarge — превышен лимит (append или compact).
	ErrYjsBodyTooLarge = errors.New("hone: yjs body too large")
)

// ─── YjsAppend ────────────────────────────────────────────────────────────

// YjsAppend — owner-проверенный insert одного update'а. После успеха
// вызывает Publisher.PublishYjsAppend (если задан).
type YjsAppend struct {
	Repo      domain.YjsRepo
	Publisher domain.SyncEventPublisher
	Log       *slog.Logger
}

// YjsAppendInput.
type YjsAppendInput struct {
	Kind           domain.YjsKind
	KindSlug       string // для publisher fan-out — "notes" / "whiteboards"
	UserID         uuid.UUID
	ParentID       uuid.UUID
	Data           []byte
	OriginDeviceID uuid.UUID
}

// Do executes the use case.
func (uc *YjsAppend) Do(ctx context.Context, in YjsAppendInput) (domain.YjsAppendResult, error) {
	if len(in.Data) == 0 {
		return domain.YjsAppendResult{}, ErrYjsEmptyBody
	}
	if len(in.Data) > YjsAppendMaxBytes {
		return domain.YjsAppendResult{}, ErrYjsBodyTooLarge
	}
	exists, err := uc.Repo.OwnsParent(ctx, in.Kind, in.UserID, in.ParentID)
	if err != nil {
		return domain.YjsAppendResult{}, fmt.Errorf("hone.YjsAppend.Do: owns: %w", err)
	}
	if !exists {
		return domain.YjsAppendResult{}, ErrYjsParentNotFound
	}
	resp, err := uc.Repo.Append(ctx, in.Kind, in.UserID, in.ParentID, in.Data, optDevice(in.OriginDeviceID))
	if err != nil {
		return domain.YjsAppendResult{}, fmt.Errorf("hone.YjsAppend.Do: %w", err)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishYjsAppend(in.UserID, in.KindSlug, in.ParentID.String(), in.OriginDeviceID)
	}
	return resp, nil
}

// ─── YjsPullUpdates ───────────────────────────────────────────────────────

// YjsPullUpdates — owner-проверенный pull всех updates с seq > since.
// Возвращает result + флаг truncated (если набралось > YjsUpdatesPerPage).
type YjsPullUpdates struct {
	Repo domain.YjsRepo
	Log  *slog.Logger
}

// YjsPullUpdatesInput.
type YjsPullUpdatesInput struct {
	Kind     domain.YjsKind
	UserID   uuid.UUID
	ParentID uuid.UUID
	Since    int64
}

// YjsPullUpdatesOutput.
type YjsPullUpdatesOutput struct {
	Updates   []domain.YjsUpdate
	LatestSeq int64
	Truncated bool
}

// Do executes the use case.
func (uc *YjsPullUpdates) Do(ctx context.Context, in YjsPullUpdatesInput) (YjsPullUpdatesOutput, error) {
	exists, err := uc.Repo.OwnsParent(ctx, in.Kind, in.UserID, in.ParentID)
	if err != nil {
		return YjsPullUpdatesOutput{}, fmt.Errorf("hone.YjsPullUpdates.Do: owns: %w", err)
	}
	if !exists {
		return YjsPullUpdatesOutput{}, ErrYjsParentNotFound
	}
	rows, err := uc.Repo.ListSince(ctx, in.Kind, in.UserID, in.ParentID, in.Since, YjsUpdatesPerPage+1)
	if err != nil {
		return YjsPullUpdatesOutput{}, fmt.Errorf("hone.YjsPullUpdates.Do: %w", err)
	}
	out := YjsPullUpdatesOutput{Updates: rows}
	for _, u := range rows {
		if u.Seq > out.LatestSeq {
			out.LatestSeq = u.Seq
		}
	}
	if len(out.Updates) > YjsUpdatesPerPage {
		out.Updates = out.Updates[:YjsUpdatesPerPage]
		out.Truncated = true
		out.LatestSeq = out.Updates[len(out.Updates)-1].Seq
	}
	return out, nil
}

// ─── YjsCompact ───────────────────────────────────────────────────────────

// YjsCompact — owner-проверенный merge: insert merged + drop старых.
type YjsCompact struct {
	Repo      domain.YjsRepo
	Publisher domain.SyncEventPublisher
	Log       *slog.Logger
}

// YjsCompactInput.
type YjsCompactInput struct {
	Kind           domain.YjsKind
	KindSlug       string
	UserID         uuid.UUID
	ParentID       uuid.UUID
	MergedData     []byte
	OriginDeviceID uuid.UUID
}

// Do executes the use case.
func (uc *YjsCompact) Do(ctx context.Context, in YjsCompactInput) (domain.YjsCompactResult, error) {
	if len(in.MergedData) == 0 {
		return domain.YjsCompactResult{}, ErrYjsEmptyBody
	}
	if len(in.MergedData) > YjsCompactMaxBytes {
		return domain.YjsCompactResult{}, ErrYjsBodyTooLarge
	}
	exists, err := uc.Repo.OwnsParent(ctx, in.Kind, in.UserID, in.ParentID)
	if err != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsCompact.Do: owns: %w", err)
	}
	if !exists {
		return domain.YjsCompactResult{}, ErrYjsParentNotFound
	}
	resp, err := uc.Repo.Compact(ctx, in.Kind, in.UserID, in.ParentID, in.MergedData, optDevice(in.OriginDeviceID))
	if err != nil {
		return domain.YjsCompactResult{}, fmt.Errorf("hone.YjsCompact.Do: %w", err)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishYjsAppend(in.UserID, in.KindSlug, in.ParentID.String(), in.OriginDeviceID)
	}
	return resp, nil
}

func optDevice(d uuid.UUID) *uuid.UUID {
	if d == uuid.Nil {
		return nil
	}
	return &d
}
