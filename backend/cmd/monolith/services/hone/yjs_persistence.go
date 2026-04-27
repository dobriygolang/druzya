// Package services — Phase C-6 generic Yjs CRDT persistence.
package hone

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

	monolithServices "druz9/cmd/monolith/services"
	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// yjsKind — per-domain параметры HTTP уровня (URL slug + chi param). SQL-
// параметры (parent/updates/FK) живут в honeDomain.YjsKind.
type yjsKind struct {
	URLSlug    string
	URLParam   string
	DomainKind honeDomain.YjsKind
}

var (
	yjsKindNotes = yjsKind{
		URLSlug:  "notes",
		URLParam: "noteId",
		DomainKind: honeDomain.YjsKind{
			ParentTable:  "hone_notes",
			UpdatesTable: "note_yjs_updates",
			ForeignKey:   "note_id",
		},
	}
	yjsKindWhiteboards = yjsKind{
		URLSlug:  "whiteboards",
		URLParam: "wbId",
		DomainKind: honeDomain.YjsKind{
			ParentTable:  "hone_whiteboards",
			UpdatesTable: "whiteboard_yjs_updates",
			ForeignKey:   "whiteboard_id",
		},
	}
)

// YjsPersistenceDeps — что нужно handler'у. Заполняется в bootstrap'е.
type YjsPersistenceDeps struct {
	Append  *honeApp.YjsAppend
	Updates *honeApp.YjsPullUpdates
	Compact *honeApp.YjsCompact
	Log     *slog.Logger
}

// NewYjsPersistence wires both notes и whiteboards Yjs endpoints в один
// модуль.
func NewYjsPersistence(deps YjsPersistenceDeps) *monolithServices.Module {
	h := &yjsPersistenceHandler{
		appendUC:  deps.Append,
		updatesUC: deps.Updates,
		compactUC: deps.Compact,
		log:       deps.Log,
	}
	return &monolithServices.Module{
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
	appendUC  *honeApp.YjsAppend
	updatesUC *honeApp.YjsPullUpdates
	compactUC *honeApp.YjsCompact
	log       *slog.Logger
}

// ─── helpers ──────────────────────────────────────────────────────────────

func (h *yjsPersistenceHandler) parseParentID(w http.ResponseWriter, r *http.Request, k yjsKind) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, k.URLParam))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return uuid.Nil, false
	}
	return id, true
}

func (h *yjsPersistenceHandler) authedUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return uuid.Nil, false
	}
	return uid, true
}

// guarded — combines auth + parent-ownership-via-use-case (внутри Do).
// Возвращает (uid, parentID, proceed). Caller bails when proceed=false.
func (h *yjsPersistenceHandler) guarded(w http.ResponseWriter, r *http.Request, k yjsKind) (uuid.UUID, uuid.UUID, bool) {
	uid, ok := h.authedUser(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	parentID, ok := h.parseParentID(w, r, k)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return uid, parentID, true
}

// ─── append ───────────────────────────────────────────────────────────────

type yjsAppendResponse struct {
	Seq       int64     `json:"seq"`
	CreatedAt time.Time `json:"createdAt"`
}

func (h *yjsPersistenceHandler) appendOp(w http.ResponseWriter, r *http.Request, k yjsKind) {
	uid, parentID, ok := h.guarded(w, r, k)
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, honeApp.YjsAppendMaxBytes+1))
	if err != nil {
		h.serverError(w, r, "append.read", err, uid)
		return
	}

	res, err := h.appendUC.Do(r.Context(), honeApp.YjsAppendInput{
		Kind:           k.DomainKind,
		KindSlug:       k.URLSlug,
		UserID:         uid,
		ParentID:       parentID,
		Data:           body,
		OriginDeviceID: sharedMw.DeviceIDFromContext(r.Context()),
	})
	if err != nil {
		h.handleYjsErr(w, r, "append", err, uid, honeApp.YjsAppendMaxBytes, "update_too_large", "max %d bytes per update")
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, yjsAppendResponse{
		Seq:       res.Seq,
		CreatedAt: res.CreatedAt,
	})
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
	uid, parentID, ok := h.guarded(w, r, k)
	if !ok {
		return
	}

	since := int64(0)
	if v := r.URL.Query().Get("since"); v != "" {
		s, perr := strconv.ParseInt(v, 10, 64)
		if perr != nil {
			monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_since", "")
			return
		}
		since = s
	}

	out, err := h.updatesUC.Do(r.Context(), honeApp.YjsPullUpdatesInput{
		Kind:     k.DomainKind,
		UserID:   uid,
		ParentID: parentID,
		Since:    since,
	})
	if err != nil {
		if errors.Is(err, honeApp.ErrYjsParentNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "updates", err, uid)
		return
	}

	resp := yjsUpdatesResponse{
		Updates:   make([]yjsUpdateRow, 0, len(out.Updates)),
		LatestSeq: out.LatestSeq,
		Truncated: out.Truncated,
	}
	for _, u := range out.Updates {
		row := yjsUpdateRow{
			Seq:       u.Seq,
			DataB64:   base64.StdEncoding.EncodeToString(u.Data),
			CreatedAt: u.CreatedAt,
		}
		if u.OriginDeviceID != nil {
			s := u.OriginDeviceID.String()
			row.OriginDeviceID = &s
		}
		resp.Updates = append(resp.Updates, row)
	}
	monolithServices.WritePubJSON(w, http.StatusOK, resp)
}

// ─── compact ──────────────────────────────────────────────────────────────

type yjsCompactResponse struct {
	Seq     int64 `json:"seq"`
	Removed int64 `json:"removed"`
}

func (h *yjsPersistenceHandler) compactOp(w http.ResponseWriter, r *http.Request, k yjsKind) {
	uid, parentID, ok := h.guarded(w, r, k)
	if !ok {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, honeApp.YjsCompactMaxBytes+1))
	if err != nil {
		h.serverError(w, r, "compact.read", err, uid)
		return
	}

	res, err := h.compactUC.Do(r.Context(), honeApp.YjsCompactInput{
		Kind:           k.DomainKind,
		KindSlug:       k.URLSlug,
		UserID:         uid,
		ParentID:       parentID,
		MergedData:     body,
		OriginDeviceID: sharedMw.DeviceIDFromContext(r.Context()),
	})
	if err != nil {
		h.handleYjsErr(w, r, "compact", err, uid, honeApp.YjsCompactMaxBytes, "compact_too_large", "max %d bytes per compact")
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, yjsCompactResponse{
		Seq:     res.Seq,
		Removed: res.Removed,
	})
}

// handleYjsErr — общий error-routing для append/compact (одинаковые
// validation-sentinels).
func (h *yjsPersistenceHandler) handleYjsErr(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID, maxBytes int, tooLargeCode, tooLargeMsg string) {
	switch {
	case errors.Is(err, honeApp.ErrYjsBodyTooLarge):
		monolithServices.WritePubJSONError(w, http.StatusRequestEntityTooLarge, tooLargeCode,
			fmt.Sprintf(tooLargeMsg, maxBytes))
	case errors.Is(err, honeApp.ErrYjsEmptyBody):
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "empty_body", "")
	case errors.Is(err, honeApp.ErrYjsParentNotFound):
		monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
	default:
		h.serverError(w, r, where, err, uid)
	}
}

func (h *yjsPersistenceHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "yjs.persistence",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
