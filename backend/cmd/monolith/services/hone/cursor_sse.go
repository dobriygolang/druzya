// cursor_sse.go — SSE endpoint for AI cursor events on the TaskBoard.
//
// Subscribes the request to honeDomain.CursorEventBus for the
// authenticated user and streams every CursorEvent as a Server-Sent
// Event line. The frontend's <AICursor> component decodes them and
// drives the on-screen pointer animation.
//
// SSE choice (vs. WebSocket): server → client only, browser-native, no
// extra protocol upgrade. Fits the use case exactly.
package hone

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	honeDomain "druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type cursorSSEHandler struct {
	bus honeDomain.CursorEventBus
	log *slog.Logger
}

// Mount attaches the stream endpoint at /hone/tasks/events/stream.
func (h *cursorSSEHandler) Mount(r chi.Router) {
	r.Get("/hone/tasks/events/stream", h.serve)
}

// cursorEventWire — JSON shape sent over SSE.
type cursorEventWire struct {
	Kind       string    `json:"kind"`
	TaskID     string    `json:"taskId,omitempty"`
	ToColumn   string    `json:"toColumn,omitempty"`
	FromColumn string    `json:"fromColumn,omitempty"`
	Body       string    `json:"body,omitempty"`
	OccurredAt time.Time `json:"occurredAt"`
	// Phase J / H3 (2026-05-12) — CardCategorise payload extension.
	// Frontend reads these on `card.categorise` events to show the
	// «Auto-tagged as <kind>» toast with reasoning + confidence.
	DetectedKind string  `json:"detectedKind,omitempty"`
	Confidence   float32 `json:"confidence,omitempty"`
}

func toCursorWire(e honeDomain.CursorEvent) cursorEventWire {
	w := cursorEventWire{
		Kind:         string(e.Kind),
		ToColumn:     string(e.ToColumn),
		FromColumn:   string(e.FromColumn),
		Body:         e.Body,
		OccurredAt:   e.OccurredAt,
		DetectedKind: string(e.DetectedKind),
		Confidence:   e.Confidence,
	}
	if e.TaskID != uuid.Nil {
		w.TaskID = e.TaskID.String()
	}
	return w
}

func (h *cursorSSEHandler) serve(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	if h.bus == nil {
		monolithServices.WritePubJSONError(w, http.StatusServiceUnavailable, "cursor_disabled", "")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "no_streaming", "")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ch, unsub := h.bus.Subscribe(uid)
	defer unsub()

	// Heartbeat every 25s keeps proxies (nginx, cloudflare) from idle-
	// closing the stream. Comment lines are ignored by browsers.
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprintf(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case ev, ok := <-ch:
			if !ok {
				return
			}
			payload, err := json.Marshal(toCursorWire(ev))
			if err != nil {
				h.warn(ctx, "marshal", err)
				continue
			}
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Kind, payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (h *cursorSSEHandler) warn(ctx context.Context, where string, err error) {
	if h.log == nil {
		return
	}
	h.log.WarnContext(ctx, "hone.cursor.sse",
		slog.String("where", where), slog.Any("err", err))
}
