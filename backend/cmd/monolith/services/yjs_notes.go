// Package services — Phase C-6 Yjs CRDT persistence для notes.
//
// Server здесь — "dumb storage" для binary Yjs update-сообщений. Все
// CRDT semantics живут client-side (в Y.Doc). Это позволяет обойтись
// без Go-port'ов Yjs и при этом получить полное CRDT-поведение между
// несколькими клиентами одного юзера.
//
// Endpoints:
//
//	POST /api/v1/sync/yjs/notes/{noteId}/append
//	  body:  binary (Yjs update message, application/octet-stream)
//	  reply: {seq: int64, createdAt: RFC3339}
//
//	GET /api/v1/sync/yjs/notes/{noteId}/updates?since=N
//	  reply: {updates: [{seq, dataB64, originDeviceId, createdAt}], latestSeq}
//	  (binary blob закодирован base64 чтобы войти в JSON; для bandwidth
//	   это ~33% overhead, но избавляет от multipart / streaming complexity)
//
//	POST /api/v1/sync/yjs/notes/{noteId}/compact
//	  body:  binary (full Y.encodeStateAsUpdate(doc))
//	  reply: {seq, removed: int}
//	  Атомарно: вставляет новый update + удаляет все с seq < new.seq для
//	  этого note_id. Client compaction = «я помержил всю историю,
//	  остальное мусор».
//
// Authorization: каждый endpoint JOIN'ит с hone_notes по user_id.
// Чужой noteId → 404 (не отличаем от «не существует» чтобы не утекать
// информацию об ID).
//
// Body limit: 1 MiB на один update message (большой даже для долгих
// сессий редактирования). Compact body — 5 MiB (это уже full-state).
// Превышение → 413.
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

// NewYjsNotes wires the Yjs persistence module.
func NewYjsNotes(d Deps) *Module {
	h := &yjsNotesHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Post("/sync/yjs/notes/{noteId}/append", h.append)
			r.Get("/sync/yjs/notes/{noteId}/updates", h.updates)
			r.Post("/sync/yjs/notes/{noteId}/compact", h.compact)
		},
	}
}

type yjsNotesHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// ─── helpers ──────────────────────────────────────────────────────────────

// ownsNote — true if (userID, noteID) указывают на существующую заметку.
// Возвращает (exists, err); exists=false тоже без error означает 404.
func (h *yjsNotesHandler) ownsNote(ctx context.Context, userID, noteID uuid.UUID) (bool, error) {
	var dummy int
	err := h.pool.QueryRow(ctx,
		`SELECT 1 FROM hone_notes WHERE id=$1 AND user_id=$2`,
		noteID, userID,
	).Scan(&dummy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("yjs.ownsNote: %w", err)
	}
	return true, nil
}

func (h *yjsNotesHandler) parseNoteID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "noteId"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_note_id", "")
		return uuid.Nil, false
	}
	return id, true
}

func (h *yjsNotesHandler) authedUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return uuid.Nil, false
	}
	return uid, true
}

// ─── append ───────────────────────────────────────────────────────────────

type appendResponse struct {
	Seq       int64     `json:"seq"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *yjsNotesHandler) append(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.authedUser(w, r)
	if !ok {
		return
	}
	noteID, ok := h.parseNoteID(w, r)
	if !ok {
		return
	}

	exists, err := h.ownsNote(r.Context(), uid, noteID)
	if err != nil {
		h.serverError(w, r, "append.owns", err, uid)
		return
	}
	if !exists {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
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

	originDevice := sharedMw.DeviceIDFromContext(r.Context())
	var devArg any
	if originDevice != uuid.Nil {
		devArg = originDevice
	}

	var resp appendResponse
	err = h.pool.QueryRow(r.Context(),
		`INSERT INTO note_yjs_updates (note_id, user_id, update_data, origin_device_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING seq, created_at`,
		noteID, uid, body, devArg,
	).Scan(&resp.Seq, &resp.CreatedAt)
	if err != nil {
		h.serverError(w, r, "append.insert", err, uid)
		return
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── updates (read since cursor) ──────────────────────────────────────────

type updateRow struct {
	Seq            int64     `json:"seq"`
	DataB64        string    `json:"dataB64"`
	OriginDeviceID *string   `json:"originDeviceId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type updatesResponse struct {
	Updates   []updateRow `json:"updates"`
	LatestSeq int64       `json:"latestSeq"`
	Truncated bool        `json:"truncated"`
}

func (h *yjsNotesHandler) updates(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.authedUser(w, r)
	if !ok {
		return
	}
	noteID, ok := h.parseNoteID(w, r)
	if !ok {
		return
	}

	exists, err := h.ownsNote(r.Context(), uid, noteID)
	if err != nil {
		h.serverError(w, r, "updates.owns", err, uid)
		return
	}
	if !exists {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
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

	// Note: фильтр по user_id избыточен (note_id уже подтверждён через
	// ownsNote), но оставляем как defense-in-depth — даже если кто-то
	// в будущем уберёт ownsNote по ошибке, чужие updates не утекут.
	rows, err := h.pool.Query(r.Context(),
		`SELECT seq, update_data, origin_device_id, created_at
		   FROM note_yjs_updates
		  WHERE note_id=$1 AND user_id=$2 AND seq > $3
		  ORDER BY seq ASC
		  LIMIT $4`,
		noteID, uid, since, yjsUpdatesPerPage+1,
	)
	if err != nil {
		h.serverError(w, r, "updates.query", err, uid)
		return
	}
	defer rows.Close()

	resp := updatesResponse{Updates: make([]updateRow, 0, yjsUpdatesPerPage)}
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
		row := updateRow{
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
		// Latest корректно указывает на последний возвращаемый row.
		resp.LatestSeq = resp.Updates[len(resp.Updates)-1].Seq
	}
	writePubJSON(w, http.StatusOK, resp)
}

// ─── compact ──────────────────────────────────────────────────────────────

type compactResponse struct {
	Seq     int64 `json:"seq"`
	Removed int64 `json:"removed"`
}

// compact заменяет всю историю update'ов одной merged-state. Client
// делает Y.encodeStateAsUpdate(doc) на полностью apply'нутый Y.Doc и
// шлёт сюда. Server атомарно: insert + delete всё с seq < new.seq.
//
// Race-safe: если параллельно прилетит обычный append, он попадёт ПОСЛЕ
// compact'а (новый seq > compact.seq). Compact удаляет только
// pre-existing rows. Concurrent appends сохраняются.
func (h *yjsNotesHandler) compact(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.authedUser(w, r)
	if !ok {
		return
	}
	noteID, ok := h.parseNoteID(w, r)
	if !ok {
		return
	}

	exists, err := h.ownsNote(r.Context(), uid, noteID)
	if err != nil {
		h.serverError(w, r, "compact.owns", err, uid)
		return
	}
	if !exists {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
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

	originDevice := sharedMw.DeviceIDFromContext(r.Context())
	var devArg any
	if originDevice != uuid.Nil {
		devArg = originDevice
	}

	var newSeq int64
	if qErr := tx.QueryRow(r.Context(),
		`INSERT INTO note_yjs_updates (note_id, user_id, update_data, origin_device_id)
		 VALUES ($1, $2, $3, $4)
		 RETURNING seq`,
		noteID, uid, body, devArg,
	).Scan(&newSeq); qErr != nil {
		h.serverError(w, r, "compact.insert", qErr, uid)
		return
	}

	cmd, err := tx.Exec(r.Context(),
		`DELETE FROM note_yjs_updates
		  WHERE note_id=$1 AND user_id=$2 AND seq < $3`,
		noteID, uid, newSeq,
	)
	if err != nil {
		h.serverError(w, r, "compact.delete", err, uid)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		h.serverError(w, r, "compact.commit", err, uid)
		return
	}

	writePubJSON(w, http.StatusOK, compactResponse{
		Seq:     newSeq,
		Removed: cmd.RowsAffected(),
	})
}

func (h *yjsNotesHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "yjs.notes",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	writePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
