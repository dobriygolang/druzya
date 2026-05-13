// Sync replication endpoints — thin HTTP wrapper over
// druz9/sync/app.{PullChanges,PushChanges}.
//
// Two REST endpoints на одной модели «cursor + table-deltas»:
//
//	POST /api/v1/sync/pull
//	  body:  {cursor: "RFC3339" | null, tables: [...] | null}
//	  reply: {
//	    cursor:     "RFC3339",        // монотонно растущий
//	    changed:    {table → [row…]},  // upserts (server snapshot)
//	    deleted:    [{table, rowId}],  // tombstones since cursor
//	    fullSnapshot: bool             // true если cursor == null (initial)
//	  }
//
//	POST /api/v1/sync/push
//	  body:  {operations: [{op, table, row}, ...]}
//	  reply: {applied: int, skipped: int, conflicts: [...]}
package sync

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	sharedMw "druz9/shared/pkg/middleware"
	syncApp "druz9/sync/app"
	syncDomain "druz9/sync/domain"

	"github.com/google/uuid"
)

// replicationHandler — REST handler'ы pull/push. Live in same module as
// device-CRUD; sister-file split is just for readability (pull/push code
// is large and semantically separate from device-management).
type replicationHandler struct {
	log     *slog.Logger
	pull    *syncApp.PullChanges
	push    *syncApp.PushChanges
	catalog syncDomain.TableCatalog
}

// ─── Pull ─────────────────────────────────────────────────────────────────

type pullRequest struct {
	Cursor *string  `json:"cursor"` // null on initial bootstrap
	Tables []string `json:"tables"` // empty = все
}

type pullDeleted struct {
	Table string `json:"table"`
	RowID string `json:"rowId"`
}

type pullResponse struct {
	Cursor       string                      `json:"cursor"`
	Changed      map[string][]map[string]any `json:"changed"`
	Deleted      []pullDeleted               `json:"deleted"`
	Truncated    bool                        `json:"truncated"`
	FullSnapshot bool                        `json:"fullSnapshot"`
}

func (h *replicationHandler) handlePull(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	requestingDevice := sharedMw.DeviceIDFromContext(r.Context())

	var req pullRequest
	// Empty body = full bootstrap (cursor=null, all tables). Decode error
	// игнорируем сознательно: фронт может отправить пустое тело при
	// initial pull, и это валидно.
	_ = json.NewDecoder(r.Body).Decode(&req)

	var cursorTime time.Time
	fullSnapshot := req.Cursor == nil || *req.Cursor == ""
	if !fullSnapshot {
		t, err := time.Parse(time.RFC3339Nano, *req.Cursor)
		if err != nil {
			monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_cursor", err.Error())
			return
		}
		cursorTime = t
	}

	res, err := h.pull.Run(r.Context(), syncDomain.PullRequest{
		UserID:           uid,
		RequestingDevice: requestingDevice,
		Cursor:           cursorTime,
		FullSnapshot:     fullSnapshot,
		Tables:           req.Tables,
	})
	if err != nil {
		if errors.Is(err, syncDomain.ErrUnknownTable) {
			monolithServices.WritePubJSONError(w, http.StatusBadRequest, "unknown_table", err.Error())
			return
		}
		h.log.ErrorContext(r.Context(), "sync.pull failed",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	resp := pullResponse{
		Cursor:       res.Cursor.UTC().Format(time.RFC3339Nano),
		Changed:      make(map[string][]map[string]any, len(res.Changed)),
		Deleted:      make([]pullDeleted, 0, len(res.Deleted)),
		Truncated:    res.Truncated,
		FullSnapshot: res.FullSnapshot,
	}
	for _, delta := range res.Changed {
		resp.Changed[delta.Table] = delta.Rows
	}
	for _, t := range res.Deleted {
		resp.Deleted = append(resp.Deleted, pullDeleted{Table: t.Table, RowID: t.RowID.String()})
	}
	monolithServices.WritePubJSON(w, http.StatusOK, resp)
}

// ─── Push ─────────────────────────────────────────────────────────────────
//
// В C-4 push реализован минимально: handler принимает batch операций,
// проверяет ownership и updated_at, applies LWW. Сейчас НЕ используется
// клиентом (Hone Connect-RPC запросы пишут напрямую через свои handler'ы)
// — но endpoint существует чтобы C-6 Yjs CRDT смог cleanly мигрировать
// на /push для notes batch sync'ов после offline-edit'а.

type pushOperation struct {
	Op        string         `json:"op"` // "upsert" | "delete"
	Table     string         `json:"table"`
	Row       map[string]any `json:"row,omitempty"`
	RowID     string         `json:"rowId,omitempty"`
	DeletedAt *string        `json:"deletedAt,omitempty"`
}

type pushRequest struct {
	Operations []pushOperation `json:"operations"`
}

type pushConflict struct {
	Index   int    `json:"index"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

type pushResponse struct {
	Applied   int            `json:"applied"`
	Skipped   int            `json:"skipped"`
	Conflicts []pushConflict `json:"conflicts"`
}

func (h *replicationHandler) handlePush(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	originDevice := sharedMw.DeviceIDFromContext(r.Context())

	var req pushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", err.Error())
		return
	}
	if len(req.Operations) == 0 {
		monolithServices.WritePubJSON(w, http.StatusOK, pushResponse{Conflicts: []pushConflict{}})
		return
	}
	if len(req.Operations) > syncApp.MaxPushBatch {
		monolithServices.WritePubJSONError(w, http.StatusRequestEntityTooLarge, "batch_too_large", "max 1000 operations per push")
		return
	}

	ops := make([]syncDomain.PushOp, 0, len(req.Operations))
	preConflicts := make([]pushConflict, 0)
	for i, op := range req.Operations {
		switch op.Op {
		case string(syncDomain.PushOpDelete):
			rid, err := uuid.Parse(op.RowID)
			if err != nil {
				preConflicts = append(preConflicts, pushConflict{
					Index: i, Reason: "delete_failed", Message: "bad row id: " + err.Error(),
				})
				continue
			}
			ops = append(ops, syncDomain.PushOp{Index: i, Kind: syncDomain.PushOpDelete, Table: op.Table, RowID: rid})
		case string(syncDomain.PushOpUpsert):
			ops = append(ops, syncDomain.PushOp{Index: i, Kind: syncDomain.PushOpUpsert, Table: op.Table, Row: op.Row})
		default:
			preConflicts = append(preConflicts, pushConflict{Index: i, Reason: "bad_op", Message: op.Op})
		}
	}

	res, err := h.push.Run(r.Context(), syncDomain.PushRequest{
		UserID:         uid,
		OriginDeviceID: originDevice,
		Operations:     ops,
	})
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	resp := pushResponse{
		Applied:   res.Applied,
		Skipped:   res.Skipped,
		Conflicts: preConflicts,
	}
	for _, c := range res.Conflicts {
		resp.Conflicts = append(resp.Conflicts, pushConflict{Index: c.Index, Reason: c.Reason, Message: c.Message})
	}
	monolithServices.WritePubJSON(w, http.StatusOK, resp)
}

// ─── ChangePublisher adapter ──────────────────────────────────────────────
//
// `syncApp.PushChanges` accepts an optional broadcast hook for sync_change
// fan-out. The monolith satisfies it via SyncEventBroker.PublishSyncChange;
// shape-mismatch (uuid.UUID vs [16]byte to avoid uuid dep in app/) is
// reconciled here.

type brokerAdapter struct{ b monolithServices.SyncBroker }

func (a brokerAdapter) OnTableChange(userID, originDevice [16]byte, table string) {
	if a.b == nil {
		return
	}
	a.b.PublishSyncChange(uuid.UUID(userID), table, uuid.UUID(originDevice))
}
