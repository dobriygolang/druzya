package app

import (
	"context"
	"fmt"
	"time"

	"druz9/sync/domain"
)

// PullLimit — max rows per table on one pull. 500 = ~250 KB body при
// средней note 500 bytes; разумный compromise между round-trip overhead
// и memory burst у клиента.
const PullLimit = 500

// MaxPushBatch — server-side cap on push.operations length.
const MaxPushBatch = 1000

// ─── Pull ─────────────────────────────────────────────────────────────────

// PullChanges — POST /api/v1/sync/pull. Iterates the requested tables (or
// all from the catalog) and rolls up a unified cursor across them.
type PullChanges struct {
	Repo    domain.ReplicationRepo
	Catalog domain.TableCatalog
}

// Run executes the pull. Handler validates body + parses cursor; this
// use-case stays pure on domain types.
func (uc *PullChanges) Run(ctx context.Context, in domain.PullRequest) (domain.PullResult, error) {
	tables := in.Tables
	if len(tables) == 0 {
		tables = uc.Catalog.AllTables()
	} else {
		for _, t := range tables {
			if !uc.Catalog.Known(t) {
				return domain.PullResult{}, fmt.Errorf("sync.PullChanges: %w: %q", domain.ErrUnknownTable, t)
			}
		}
	}

	res := domain.PullResult{
		Changed:      make([]domain.TableDelta, 0, len(tables)),
		Deleted:      make([]domain.Tombstone, 0),
		FullSnapshot: in.FullSnapshot,
	}
	maxSeenAt := in.Cursor
	for _, table := range tables {
		delta, err := uc.Repo.FetchTable(ctx, in.UserID, table, in.Cursor, PullLimit)
		if err != nil {
			return domain.PullResult{}, fmt.Errorf("sync.PullChanges: %w", err)
		}
		res.Changed = append(res.Changed, delta)
		if delta.Truncated {
			res.Truncated = true
		}
		if delta.MaxSeenAt.After(maxSeenAt) {
			maxSeenAt = delta.MaxSeenAt
		}
	}

	tombs, latestTomb, err := uc.Repo.FetchTombstones(ctx, in.UserID, in.RequestingDevice, in.Cursor, PullLimit)
	if err != nil {
		return domain.PullResult{}, fmt.Errorf("sync.PullChanges: %w", err)
	}
	res.Deleted = tombs
	if latestTomb.After(maxSeenAt) {
		maxSeenAt = latestTomb
	}

	if maxSeenAt.IsZero() {
		maxSeenAt = time.Now().UTC()
	}
	res.Cursor = maxSeenAt.UTC()
	return res, nil
}

// ─── Push ─────────────────────────────────────────────────────────────────

// ChangePublisher — optional broadcast for sync_change events. Implemented
// in monolith by SyncEventBroker.PublishSyncChange. nil-safe in use-case.
type ChangePublisher interface {
	OnTableChange(userID, originDevice [16]byte, table string)
}

// PushChanges — POST /api/v1/sync/push. MVP supports `delete`; `upsert` is
// intentionally a no-op for the catalog tables (Connect-RPC owns writes
// for hone_notes/whiteboards; server is authoritative for the rest).
type PushChanges struct {
	Repo      domain.ReplicationRepo
	Catalog   domain.TableCatalog
	Publisher ChangePublisher // optional
}

// Run applies the push batch. Returns aggregated counters + per-op
// conflicts. Conflicts are non-fatal — caller continues serializing the
// rest of the batch.
func (uc *PushChanges) Run(ctx context.Context, in domain.PushRequest) (domain.PushResult, error) {
	if len(in.Operations) > MaxPushBatch {
		return domain.PushResult{}, fmt.Errorf("sync.PushChanges: batch too large (%d > %d)", len(in.Operations), MaxPushBatch)
	}
	res := domain.PushResult{Conflicts: make([]domain.PushConflict, 0)}
	for _, op := range in.Operations {
		switch op.Kind {
		case domain.PushOpDelete:
			if !uc.Catalog.Known(op.Table) {
				res.Conflicts = append(res.Conflicts, domain.PushConflict{
					Index:   op.Index,
					Reason:  "delete_failed",
					Message: fmt.Sprintf("unknown table %q", op.Table),
				})
				continue
			}
			if err := uc.Repo.ApplyDelete(ctx, in.UserID, in.OriginDeviceID, op.Table, op.RowID); err != nil {
				res.Conflicts = append(res.Conflicts, domain.PushConflict{
					Index:   op.Index,
					Reason:  "delete_failed",
					Message: err.Error(),
				})
				continue
			}
			res.Applied++
			if uc.Publisher != nil {
				uc.Publisher.OnTableChange(in.UserID, in.OriginDeviceID, op.Table)
			}
		case domain.PushOpUpsert:
			// hone_notes/whiteboards — Connect-RPC owns writes (Yjs in C-6).
			// hone_focus_sessions/hone_daily_plans/coach_episodes —
			// server-authoritative. Skip without error so the client doesn't
			// panic on a correct no-op.
			if !uc.Catalog.Known(op.Table) {
				res.Conflicts = append(res.Conflicts, domain.PushConflict{
					Index:   op.Index,
					Reason:  "upsert_failed",
					Message: fmt.Sprintf("unsupported table %q", op.Table),
				})
				continue
			}
			res.Skipped++
		default:
			res.Conflicts = append(res.Conflicts, domain.PushConflict{
				Index: op.Index, Reason: "bad_op", Message: string(op.Kind),
			})
		}
	}
	return res, nil
}

// ─── Tombstone GC ─────────────────────────────────────────────────────────

// PruneTombstones — periodic cron (24h) trimming sync_tombstones older
// than `Retention`. Run() blocks; spawn under a goroutine.
type PruneTombstones struct {
	Repo      domain.ReplicationRepo
	Retention time.Duration
}

// Once executes a single prune sweep. Returns rows pruned + cutoff used.
func (uc *PruneTombstones) Once(ctx context.Context) (int64, time.Time, error) {
	cutoff := time.Now().Add(-uc.Retention)
	n, err := uc.Repo.PruneTombstones(ctx, cutoff)
	if err != nil {
		return 0, cutoff, fmt.Errorf("sync.PruneTombstones: %w", err)
	}
	return n, cutoff, nil
}
