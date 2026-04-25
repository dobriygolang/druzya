// Package services — Phase C-6 generic Yjs CRDT persistence.
//
// Один handler-каркас обслуживает /sync/yjs/{kind}/{id}/{append|updates|compact}
// для нескольких kind'ов (notes, whiteboards, ...). Каждый kind отличается
// только тремя параметрами: parent table (`hone_notes`), updates table
// (`note_yjs_updates`) и FK column в updates table (`note_id`).
//
// Без generic'а получалось 380 строк дублей на каждый новый kind. С
// generic — 50 строк wiring per kind.
//
// Server семантика та же что в yjs_notes.go header'е: dumb storage,
// CRDT logic — на клиенте, защита через ownership-JOIN, body limits 1
// MiB / 5 MiB compact / 500 updates per page.
package services

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	yjsAppendMaxBytes  = 1 << 20 // 1 MiB
	yjsCompactMaxBytes = 5 << 20 // 5 MiB
	yjsUpdatesPerPage  = 500
)

// yjsKind описывает per-domain параметры. Только эти 4 поля меняются
// между notes/whiteboards/etc.
type yjsKind struct {
	// Path slug в URL: /sync/yjs/{slug}/{id}/...
	URLSlug string
	// chi URL param name для id заметки/доски ("noteId", "wbId").
	URLParam string
	// Parent table where ownership is recorded (hone_notes, hone_whiteboards).
	ParentTable string
	// Updates table — где писать append'ы (note_yjs_updates, ...).
	UpdatesTable string
	// FK column в updates table указывающая на parent (note_id, whiteboard_id).
	ForeignKey string
}

var (
	yjsKindNotes = yjsKind{
		URLSlug:      "notes",
		URLParam:     "noteId",
		ParentTable:  "hone_notes",
		UpdatesTable: "note_yjs_updates",
		ForeignKey:   "note_id",
	}
	yjsKindWhiteboards = yjsKind{
		URLSlug:      "whiteboards",
		URLParam:     "wbId",
		ParentTable:  "hone_whiteboards",
		UpdatesTable: "whiteboard_yjs_updates",
		ForeignKey:   "whiteboard_id",
	}
)

// NewYjsPersistence wires both notes and whiteboards Yjs endpoints in one
// module. Это единая точка для всех CRDT-таблиц — позволяет модулю
// shutdown-coordination'у управлять ими общо (см. Module-level хуки в
// будущем для compaction-cron'ов).
func NewYjsPersistence(d Deps) *Module {
	h := &yjsPersistenceHandler{pool: d.Pool, log: d.Log, broker: d.SyncEventBroker}
	return &Module{
		MountREST: func(r chi.Router) {
			for _, k := range []yjsKind{yjsKindNotes, yjsKindWhiteboards} {
				kk := k // capture per loop iteration
				r.Post(
					fmt.Sprintf("/sync/yjs/%s/{%s}/append", kk.URLSlug, kk.URLParam),
					func(w http.ResponseWriter, req *http.Request) { h.appendOp(w, req, kk) },
				)
				r.Get(
					fmt.Sprintf("/sync/yjs/%s/{%s}/updates", kk.URLSlug, kk.URLParam),
					func(w http.ResponseWriter, req *http.Request) { h.updatesOp(w, req, kk) },
				)
				r.Post(
					fmt.Sprintf("/sync/yjs/%s/{%s}/compact", kk.URLSlug, kk.URLParam),
					func(w http.ResponseWriter, req *http.Request) { h.compactOp(w, req, kk) },
				)
			}
		},
	}
}

type yjsPersistenceHandler struct {
	pool   *pgxpool.Pool
	log    *slog.Logger
	broker *SyncEventBroker // optional; nil = no realtime push
}

// ─── helpers ──────────────────────────────────────────────────────────────

// ownsParent — true если (userID, parentID) указывают на существующую
// строку в parent-таблице. Возвращает (exists, err).
func (h *yjsPersistenceHandler) ownsParent(ctx context.Context, k yjsKind, userID, parentID uuid.UUID) (bool, error) {
	var dummy int
	q := fmt.Sprintf(`SELECT 1 FROM %s WHERE id=$1 AND user_id=$2`, k.ParentTable)
	err := h.pool.QueryRow(ctx, q, parentID, userID).Scan(&dummy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("yjs.ownsParent(%s): %w", k.ParentTable, err)
	}
	return true, nil
}

func (h *yjsPersistenceHandler) parseParentID(w http.ResponseWriter, r *http.Request, k yjsKind) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, k.URLParam))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return uuid.Nil, false
	}
	return id, true
}

func (h *yjsPersistenceHandler) authedUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return uuid.Nil, false
	}
	return uid, true
}

// guarded — combines auth + parent-ownership check. Returns (uid, parentID,
// proceed). Caller bails when proceed=false (response уже отправлен).
func (h *yjsPersistenceHandler) guarded(w http.ResponseWriter, r *http.Request, k yjsKind, where string) (uuid.UUID, uuid.UUID, bool) {
	uid, ok := h.authedUser(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	parentID, ok := h.parseParentID(w, r, k)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	exists, err := h.ownsParent(r.Context(), k, uid, parentID)
	if err != nil {
		h.serverError(w, r, where+".owns", err, uid)
		return uuid.Nil, uuid.Nil, false
	}
	if !exists {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
		return uuid.Nil, uuid.Nil, false
	}
	return uid, parentID, true
}

func deviceArg(ctx context.Context) any {
	d := sharedMw.DeviceIDFromContext(ctx)
	if d == uuid.Nil {
		return nil
	}
	return d
}

// ─── append ───────────────────────────────────────────────────────────────

type yjsAppendResponse struct {
	Seq       int64     `json:"seq"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *yjsPersistenceHandler) appendOp(w http.ResponseWriter, r *http.Request, k yjsKind) {
	uid, parentID, ok := h.guarded(w, r, k, "append")
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, yjsAppendMaxBytes+1))
	if err != nil {
		h.serverError(w, r, "append.read", err, uid)
		return
	}
	if len(body) > yjsAppendMaxBytes {
		writePubJSONError(w, http.StatusRequestEntityTooLarge, "update_too_large",
			fmt.Sprintf("max %d bytes per update", yjsAppendMaxBytes))
		return
	}
	if len(body) == 0 {
		writePubJSONError(w, http.StatusBadRequest, "empty_body", "")
		return
	}

	q := fmt.Sprintf(
		`INSERT INTO %s (%s, user_id, update_data, origin_device_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING seq, created_at`,
		k.UpdatesTable, k.ForeignKey,
	)

	var resp yjsAppendResponse
	if err := h.pool.QueryRow(r.Context(), q,
		parentID, uid, body, deviceArg(r.Context()),
	).Scan(&resp.Seq, &resp.CreatedAt); err != nil {
		h.serverError(w, r, "append.insert", err, uid)
		return
	}
	// Phase C-6.2 — fan-out на other devices этого юзера. Origin device
	// сам себе не получает (broker filter).
	if h.broker != nil {
		h.broker.PublishYjsAppend(uid, k.URLSlug, parentID.String(),
			sharedMw.DeviceIDFromContext(r.Context()))
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── updates ──────────────────────────────────────────────────────────────

type yjsUpdateRow struct {
	Seq            int64     `json:"seq"`
	DataB64        string    `json:"dataB64"`
	OriginDeviceID *string   `json:"originDeviceId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type yjsUpdatesResponse struct {
	Updates   []yjsUpdateRow `json:"updates"`
	LatestSeq int64          `json:"latestSeq"`
	Truncated bool           `json:"truncated"`
}

func (h *yjsPersistenceHandler) updatesOp(w http.ResponseWriter, r *http.Request, k yjsKind) {
	uid, parentID, ok := h.guarded(w, r, k, "updates")
	if !ok {
		return
	}

	since := int64(0)
	if v := r.URL.Query().Get("since"); v != "" {
		s, perr := strconv.ParseInt(v, 10, 64)
		if perr != nil {
			writePubJSONError(w, http.StatusBadRequest, "bad_since", "")
			return
		}
		since = s
	}

	// Defense-in-depth: фильтр и по parent-id и по user_id. Parent уже
	// проверен через ownsParent, но user_id-filter гарантирует что даже
	// если кто-то в будущем кейс ownership проверки ослабит — чужие
	// updates не утекут.
	q := fmt.Sprintf(
		`SELECT seq, update_data, origin_device_id, created_at
		   FROM %s
		  WHERE %s=$1 AND user_id=$2 AND seq > $3
		  ORDER BY seq ASC
		  LIMIT $4`,
		k.UpdatesTable, k.ForeignKey,
	)

	rows, err := h.pool.Query(r.Context(), q, parentID, uid, since, yjsUpdatesPerPage+1)
	if err != nil {
		h.serverError(w, r, "updates.query", err, uid)
		return
	}
	defer rows.Close()

	resp := yjsUpdatesResponse{Updates: make([]yjsUpdateRow, 0, yjsUpdatesPerPage)}
	for rows.Next() {
		var (
			seq      int64
			data     []byte
			origin   *uuid.UUID
			createAt time.Time
		)
		if err := rows.Scan(&seq, &data, &origin, &createAt); err != nil {
			h.serverError(w, r, "updates.scan", err, uid)
			return
		}
		row := yjsUpdateRow{
			Seq:       seq,
			DataB64:   base64.StdEncoding.EncodeToString(data),
			CreatedAt: createAt,
		}
		if origin != nil {
			s := origin.String()
			row.OriginDeviceID = &s
		}
		resp.Updates = append(resp.Updates, row)
		if seq > resp.LatestSeq {
			resp.LatestSeq = seq
		}
	}
	if err := rows.Err(); err != nil {
		h.serverError(w, r, "updates.rows", err, uid)
		return
	}

	if len(resp.Updates) > yjsUpdatesPerPage {
		resp.Updates = resp.Updates[:yjsUpdatesPerPage]
		resp.Truncated = true
		resp.LatestSeq = resp.Updates[len(resp.Updates)-1].Seq
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── compact ──────────────────────────────────────────────────────────────

type yjsCompactResponse struct {
	Seq     int64 `json:"seq"`
	Removed int64 `json:"removed"`
}

func (h *yjsPersistenceHandler) compactOp(w http.ResponseWriter, r *http.Request, k yjsKind) {
	uid, parentID, ok := h.guarded(w, r, k, "compact")
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, yjsCompactMaxBytes+1))
	if err != nil {
		h.serverError(w, r, "compact.read", err, uid)
		return
	}
	if len(body) > yjsCompactMaxBytes {
		writePubJSONError(w, http.StatusRequestEntityTooLarge, "compact_too_large",
			fmt.Sprintf("max %d bytes per compact", yjsCompactMaxBytes))
		return
	}
	if len(body) == 0 {
		writePubJSONError(w, http.StatusBadRequest, "empty_body", "")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.serverError(w, r, "compact.begin", err, uid)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	insertQ := fmt.Sprintf(
		`INSERT INTO %s (%s, user_id, update_data, origin_device_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING seq`,
		k.UpdatesTable, k.ForeignKey,
	)
	var newSeq int64
	if qErr := tx.QueryRow(r.Context(), insertQ,
		parentID, uid, body, deviceArg(r.Context()),
	).Scan(&newSeq); qErr != nil {
		h.serverError(w, r, "compact.insert", qErr, uid)
		return
	}

	deleteQ := fmt.Sprintf(
		`DELETE FROM %s WHERE %s=$1 AND user_id=$2 AND seq < $3`,
		k.UpdatesTable, k.ForeignKey,
	)
	cmd, err := tx.Exec(r.Context(), deleteQ, parentID, uid, newSeq)
	if err != nil {
		h.serverError(w, r, "compact.delete", err, uid)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		h.serverError(w, r, "compact.commit", err, uid)
		return
	}

	if h.broker != nil {
		h.broker.PublishYjsAppend(uid, k.URLSlug, parentID.String(),
			sharedMw.DeviceIDFromContext(r.Context()))
	}
	writePubJSON(w, http.StatusOK, yjsCompactResponse{
		Seq:     newSeq,
		Removed: cmd.RowsAffected(),
	})
}

func (h *yjsPersistenceHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "yjs.persistence",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	writePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
