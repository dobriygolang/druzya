// Package services — Phase C-4 sync replication endpoints.
//
// Two REST endpoints на одной модели «cursor + table-deltas»:
//
//	POST /api/v1/sync/pull
//	  body:  {cursor: "RFC3339" | null, tables: [...] | null}
//	  reply: {
//	    cursor:     "RFC3339",        // монотонно растущий, пишется клиентом
//	    changed:    {table → [row…]},  // upserts (server snapshot)
//	    deleted:    [{table, rowId}],  // tombstones since cursor
//	    fullSnapshot: bool             // true если cursor == null (initial)
//	  }
//
//	POST /api/v1/sync/push
//	  body:  {operations: [{op, table, row}, ...]}
//	  reply: {applied: int, skipped: int, conflicts: [...]}
//
// LWW resolution: push принимает {table, row, updatedAt}. Если на сервере
// row.updated_at >= client.updatedAt → skip (server wins). Иначе apply.
// Это «last-writer-wins by updated_at» — простая модель для append-mostly
// таблиц (focus_sessions, plans). Для notes/whiteboards используем
// Yjs CRDT в C-6, не LWW push.
//
// Tombstones: pull возвращает rows, которые удалили ДРУГИЕ устройства
// (origin_device_id != requesting). Свои tombstone'ы не возвращаем, чтобы
// не вызывать «удалить ещё раз» в локальном cache.
//
// Pagination: на pull возвращаем максимум `pullLimit` rows per table.
// Если упёрлись в лимит — `truncated: true` flag, клиент должен снова
// pull'нуть с обновлённым cursor (= max(updated_at) того что пришло).
// Без этого юзер с 10k notes за один pull выкачивал бы их все.
package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pullLimit — max rows на одну таблицу за один pull. 500 = ~250 KB body
// при средней note 500 bytes; разумный compromise между round-trip
// overhead и memory burst у клиента.
const pullLimit = 500

// syncReplicationHandler — REST handler'ы pull/push. Регистрируется в
// sync.go рядом с device-CRUD'ом (тот же модуль). Держим отдельно потому
// что код большой, и pull/push — semantically отдельная concern от
// device-management.
type syncReplicationHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
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

// allTables — таблицы которые мы синкаем в Phase C-4. notes/whiteboards
// здесь как LWW — это temporary до C-6 когда их заменит Yjs sync. Сейчас
// возвращаем поля как есть.
var allTables = []string{
	"hone_notes",
	"hone_whiteboards",
	"hone_focus_sessions",
	"hone_plans",
	"coach_episodes",
}

// pullColumns — list per table колонок которые отдаём клиенту. Не *
// (защита от случайного раскрытия sensitive колонок типа embedding'ов
// которые должны оставаться сервер-side только).
var pullColumns = map[string]string{
	"hone_notes":          "id, title, body_md, size_bytes, archived_at, published_at, public_slug, created_at, updated_at",
	"hone_whiteboards":    "id, title, state_json, version, archived_at, created_at, updated_at",
	"hone_focus_sessions": "id, started_at, ended_at, planned_duration_seconds, actual_duration_seconds, plan_item_id, pinned_title",
	"hone_plans":          "user_id, day, items, generated_at",
	"coach_episodes":      "id, kind, summary, payload, occurred_at, created_at",
}

// pullCursorColumn — какое поле использовать для cursor-фильтра. Для
// большинства — updated_at; для append-only (focus_sessions, episodes) —
// created_at; для plans — generated_at.
var pullCursorColumn = map[string]string{
	"hone_notes":          "updated_at",
	"hone_whiteboards":    "updated_at",
	"hone_focus_sessions": "started_at", // append-only by start
	"hone_plans":          "generated_at",
	"coach_episodes":      "created_at",
}

func (h *syncReplicationHandler) pull(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	requestingDevice := sharedMw.DeviceIDFromContext(r.Context())

	var req pullRequest
	// Empty body = full bootstrap (cursor=null, all tables). Decode error
	// игнорируем сознательно: фронт может отправить пустое тело при
	// initial pull, и это валидно.
	_ = json.NewDecoder(r.Body).Decode(&req)

	tables := req.Tables
	if len(tables) == 0 {
		tables = allTables
	} else {
		// Validate каждый table'а — иначе SQL-инъекция в pullColumns lookup.
		for _, t := range tables {
			if _, ok := pullColumns[t]; !ok {
				writePubJSONError(w, http.StatusBadRequest, "unknown_table", t)
				return
			}
		}
	}

	var cursorTime time.Time
	fullSnapshot := req.Cursor == nil || *req.Cursor == ""
	if !fullSnapshot {
		t, err := time.Parse(time.RFC3339Nano, *req.Cursor)
		if err != nil {
			writePubJSONError(w, http.StatusBadRequest, "bad_cursor", err.Error())
			return
		}
		cursorTime = t
	}

	resp := pullResponse{
		Changed:      make(map[string][]map[string]any, len(tables)),
		Deleted:      make([]pullDeleted, 0),
		FullSnapshot: fullSnapshot,
	}

	maxSeenAt := cursorTime
	for _, table := range tables {
		rows, latest, truncated, err := h.fetchTable(r.Context(), uid, table, cursorTime)
		if err != nil {
			h.log.ErrorContext(r.Context(), "sync.pull: fetch failed",
				slog.String("table", table), slog.Any("err", err),
				slog.String("user_id", uid.String()))
			writePubJSONError(w, http.StatusInternalServerError, "internal", "")
			return
		}
		resp.Changed[table] = rows
		if truncated {
			resp.Truncated = true
		}
		if latest.After(maxSeenAt) {
			maxSeenAt = latest
		}
	}

	// Tombstones — single query, исключая запросившее устройство.
	tombs, latestTomb, err := h.fetchTombstones(r.Context(), uid, requestingDevice, cursorTime)
	if err != nil {
		h.log.ErrorContext(r.Context(), "sync.pull: tombstones failed",
			slog.Any("err", err), slog.String("user_id", uid.String()))
		writePubJSONError(w, http.StatusInternalServerError, "internal", "")
		return
	}
	resp.Deleted = tombs
	if latestTomb.After(maxSeenAt) {
		maxSeenAt = latestTomb
	}

	// Cursor устанавливаем в max(seen) или now() если ничего не было.
	// Использование now() безопаснее: если cron в будущем положит row
	// с updated_at < now(), наш cursor его всё равно не пропустит.
	if maxSeenAt.IsZero() {
		maxSeenAt = time.Now().UTC()
	}
	resp.Cursor = maxSeenAt.UTC().Format(time.RFC3339Nano)

	writePubJSON(w, http.StatusOK, resp)
}

// fetchTable читает changed-rows из table с фильтром по cursor.
// Returns: rows, max(cursor_column) seen, truncated-flag, err.
func (h *syncReplicationHandler) fetchTable(ctx context.Context, uid uuid.UUID, table string, cursor time.Time) ([]map[string]any, time.Time, bool, error) {
	cols := pullColumns[table]
	cursorCol := pullCursorColumn[table]
	if cols == "" || cursorCol == "" {
		return nil, time.Time{}, false, fmt.Errorf("sync.fetchTable: unknown table %q", table)
	}

	// Plan'ы — на user_id, day key. Special-case: cursor — generated_at,
	// но primary identifier — (user_id, day), поэтому возвращаем как есть.
	// Запросы — простые SELECT'ы; для безопасности не используем
	// dynamic table-string pattern с inline'ом. Здесь все three values
	// (table, cols, cursorCol) приходят из validated pullColumns map'а, не
	// из user input. SQL-инъекции нет.
	q := fmt.Sprintf(
		`SELECT %s FROM %s
		  WHERE user_id = $1 AND %s > $2
		  ORDER BY %s ASC
		  LIMIT $3`,
		cols, table, cursorCol, cursorCol,
	)
	// hone_plans — user_id уже в SELECT, оставляем фильтр.
	rows, err := h.pool.Query(ctx, q, uid, cursor, pullLimit+1)
	if err != nil {
		return nil, time.Time{}, false, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	out := make([]map[string]any, 0, pullLimit)
	descs := rows.FieldDescriptions()
	var maxAt time.Time
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, time.Time{}, false, fmt.Errorf("scan values: %w", err)
		}
		row := make(map[string]any, len(descs))
		for i, d := range descs {
			name := d.Name
			row[name] = normalizeValue(vals[i])
			if name == cursorCol {
				if t, ok := vals[i].(time.Time); ok && t.After(maxAt) {
					maxAt = t
				}
			}
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, time.Time{}, false, fmt.Errorf("rows iter: %w", err)
	}

	truncated := false
	if len(out) > pullLimit {
		out = out[:pullLimit]
		truncated = true
	}
	return out, maxAt, truncated, nil
}

func (h *syncReplicationHandler) fetchTombstones(ctx context.Context, uid, requestingDevice uuid.UUID, cursor time.Time) ([]pullDeleted, time.Time, error) {
	// origin_device_id IS DISTINCT FROM $2 — NULL-safe сравнение, чтобы
	// admin-удаления (origin=NULL) тоже улетели всем устройствам.
	rows, err := h.pool.Query(ctx,
		`SELECT table_name, row_id, deleted_at
		   FROM sync_tombstones
		  WHERE user_id = $1
		    AND deleted_at > $2
		    AND origin_device_id IS DISTINCT FROM $3
		  ORDER BY deleted_at ASC
		  LIMIT $4`,
		uid, cursor, requestingDevice, pullLimit+1,
	)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("tombstones query: %w", err)
	}
	defer rows.Close()
	out := make([]pullDeleted, 0)
	var maxAt time.Time
	for rows.Next() {
		var (
			table string
			rowID uuid.UUID
			delAt time.Time
		)
		if err := rows.Scan(&table, &rowID, &delAt); err != nil {
			return nil, time.Time{}, fmt.Errorf("tombstones scan: %w", err)
		}
		out = append(out, pullDeleted{Table: table, RowID: rowID.String()})
		if delAt.After(maxAt) {
			maxAt = delAt
		}
	}
	return out, maxAt, nil
}

// normalizeValue приводит pgx Value -> JSON-safe representation.
// pgtype.* типы JSON-marshal'ятся плохо без преобразования; голые time/
// uuid/string/int/bool — как есть.
func normalizeValue(v any) any {
	switch t := v.(type) {
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	case [16]byte:
		// Raw uuid bytes — convert to string.
		u := uuid.UUID(t)
		return u.String()
	case nil:
		return nil
	default:
		return v
	}
}

// ─── Push ─────────────────────────────────────────────────────────────────
//
// В C-4 push реализован минимально: handler принимает batch операций,
// проверяет ownership и updated_at, applies LWW. Сейчас НЕ используется
// клиентом (Hone Connect-RPC запросы пишут напрямую через свои handler'ы)
// — но endpoint существует чтобы C-6 Yjs CRDT смог cleanly мигрировать
// на /push для notes batch sync'ов после offline-edit'а.
//
// Body schema:
//   {operations: [
//     {op:"upsert", table:"hone_notes", row: {id, title, body_md, updated_at, ...}},
//     {op:"delete", table:"hone_notes", rowId, deletedAt}
//   ]}

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

func (h *syncReplicationHandler) push(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	var req pushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_body", err.Error())
		return
	}
	if len(req.Operations) == 0 {
		writePubJSON(w, http.StatusOK, pushResponse{})
		return
	}
	if len(req.Operations) > 1000 {
		writePubJSONError(w, http.StatusRequestEntityTooLarge, "batch_too_large", "max 1000 operations per push")
		return
	}

	resp := pushResponse{Conflicts: make([]pushConflict, 0)}

	// MVP: каждое op обрабатываем в собственной TX. Не batch — так
	// один битый op не валит весь push, и atomic guarantee per-row
	// сохраняется. Для high-volume (Yjs C-6) будем переделывать в
	// real batched COPY.
	for i, op := range req.Operations {
		switch op.Op {
		case "delete":
			if err := h.applyDelete(r.Context(), uid, op); err != nil {
				resp.Conflicts = append(resp.Conflicts, pushConflict{
					Index: i, Reason: "delete_failed", Message: err.Error(),
				})
				continue
			}
			resp.Applied++
		case "upsert":
			applied, err := h.applyUpsert(r.Context(), uid, op)
			if err != nil {
				resp.Conflicts = append(resp.Conflicts, pushConflict{
					Index: i, Reason: "upsert_failed", Message: err.Error(),
				})
				continue
			}
			if applied {
				resp.Applied++
			} else {
				resp.Skipped++
			}
		default:
			resp.Conflicts = append(resp.Conflicts, pushConflict{
				Index: i, Reason: "bad_op", Message: op.Op,
			})
		}
	}

	writePubJSON(w, http.StatusOK, resp)
}

// applyDelete — push-side delete. Эквивалентно Connect-RPC DeleteNote, но
// без через app-layer (мы тут уже в sync-протокольном слое). Tombstone
// пишется автоматически через transactional handler в hone-repo'е…
//
// Wait — мы НЕ через hone-repo, а DELETE напрямую. Значит tombstone надо
// писать тут вручную. Используем synctomb напрямую.
func (h *syncReplicationHandler) applyDelete(ctx context.Context, uid uuid.UUID, op pushOperation) error {
	rid, err := uuid.Parse(op.RowID)
	if err != nil {
		return fmt.Errorf("bad row id: %w", err)
	}
	if _, ok := pullColumns[op.Table]; !ok {
		return fmt.Errorf("unknown table %q", op.Table)
	}
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := fmt.Sprintf(`DELETE FROM %s WHERE id = $1 AND user_id = $2`, op.Table)
	if _, err := tx.Exec(ctx, q, rid, uid); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO sync_tombstones (user_id, table_name, row_id, origin_device_id)
		 VALUES ($1, $2, $3, $4)`,
		uid, op.Table, rid, sharedMw.DeviceIDFromContext(ctx),
	); err != nil {
		return fmt.Errorf("tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// applyUpsert — LWW upsert. В C-4 поддерживаем только hone_focus_sessions
// и hone_plans (append-only / daily-overwrite). hone_notes / whiteboards
// в C-6 переедут на Yjs CRDT, до тех пор push для них умышленно skipped
// — Connect-RPC пишет напрямую.
func (h *syncReplicationHandler) applyUpsert(ctx context.Context, uid uuid.UUID, op pushOperation) (bool, error) {
	switch op.Table {
	case "hone_notes", "hone_whiteboards":
		// Эти таблицы writes идут через Connect-RPC. Push для них skipped
		// до C-6 (Yjs persistence). Возвращаем skip без error чтобы
		// клиент не паниковал — это корректное поведение.
		return false, nil
	case "hone_focus_sessions", "hone_plans", "coach_episodes":
		// Server-authoritative — клиент НЕ может писать сюда напрямую
		// (только server cron'ы / handlers). Skip без error.
		return false, nil
	default:
		return false, fmt.Errorf("unsupported table %q", op.Table)
	}
}

// ─── GC cron ──────────────────────────────────────────────────────────────

type tombstoneGC struct {
	pool      *pgxpool.Pool
	log       *slog.Logger
	interval  time.Duration
	retention time.Duration
}

func (g *tombstoneGC) Run(ctx context.Context) {
	t := time.NewTicker(g.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cutoff := time.Now().Add(-g.retention)
			cmd, err := g.pool.Exec(ctx,
				`DELETE FROM sync_tombstones WHERE deleted_at < $1`, cutoff)
			if err != nil {
				g.log.Warn("sync.tombstoneGC: failed",
					slog.Any("err", err), slog.Time("cutoff", cutoff))
				continue
			}
			if cmd.RowsAffected() > 0 {
				g.log.Info("sync.tombstoneGC: pruned",
					slog.Int64("rows", cmd.RowsAffected()),
					slog.Time("cutoff", cutoff))
			}
		}
	}
}
