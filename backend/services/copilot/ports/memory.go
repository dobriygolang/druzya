package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/copilot/app"
	"druz9/copilot/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// MemoryHandler exposes Cue desktop compact-memory sync.
// It is transport-only: validation/ownership lives in app.SyncMemory,
// persistence lives behind domain.MemorySink.
type MemoryHandler struct {
	Sync *app.SyncMemory
	Log  *slog.Logger
}

func NewMemoryHandler(in MemoryHandler) *MemoryHandler {
	if in.Sync == nil {
		panic("copilot.ports.NewMemoryHandler: Sync is required")
	}
	if in.Log == nil {
		panic("copilot.ports.NewMemoryHandler: Log is required")
	}
	return &in
}

type memorySyncRequest struct {
	Turns             []memoryTurn      `json:"turns"`
	ScreenshotSummary string            `json:"screenshot_summary"`
	Topics            []string          `json:"topics"`
	Outcome           string            `json:"outcome"`
	RollingSummary    string            `json:"rolling_summary"`
	Embeddings        []memoryEmbedding `json:"embeddings"`
}

type memoryTurn struct {
	Question      string    `json:"question"`
	Answer        string    `json:"answer"`
	HasScreenshot bool      `json:"has_screenshot"`
	Timestamp     time.Time `json:"timestamp"`
	Model         string    `json:"model"`
}

type memoryEmbedding struct {
	Term   string  `json:"term"`
	Weight float64 `json:"weight"`
}

func (h *MemoryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	conversationID, err := uuid.Parse(chi.URLParam(r, "conversationId"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid conversation id")
		return
	}

	var req memorySyncRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid memory payload")
		return
	}
	memory := req.toDomain()
	if err := h.Sync.Do(r.Context(), app.SyncMemoryInput{
		UserID:         uid,
		ConversationID: conversationID,
		Memory:         memory,
	}); err != nil {
		h.writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r memorySyncRequest) toDomain() domain.ConversationMemory {
	turns := make([]domain.MemoryTurn, 0, len(r.Turns))
	for _, t := range r.Turns {
		turns = append(turns, domain.MemoryTurn{
			Question:      clamp(strings.TrimSpace(t.Question), 1200),
			Answer:        clamp(strings.TrimSpace(t.Answer), 2000),
			HasScreenshot: t.HasScreenshot,
			Timestamp:     t.Timestamp,
			Model:         clamp(strings.TrimSpace(t.Model), 128),
		})
	}
	topics := make([]string, 0, len(r.Topics))
	for _, t := range r.Topics {
		t = clamp(strings.TrimSpace(t), 64)
		if t != "" {
			topics = append(topics, t)
		}
	}
	embeddings := make([]domain.MemoryEmbedding, 0, len(r.Embeddings))
	for _, e := range r.Embeddings {
		term := clamp(strings.TrimSpace(e.Term), 64)
		if term == "" {
			continue
		}
		embeddings = append(embeddings, domain.MemoryEmbedding{Term: term, Weight: e.Weight})
	}
	return domain.ConversationMemory{
		Turns:             turns,
		ScreenshotSummary: clamp(strings.TrimSpace(r.ScreenshotSummary), 1000),
		Topics:            topics,
		Outcome:           domain.MemoryOutcome(strings.TrimSpace(r.Outcome)),
		RollingSummary:    clamp(strings.TrimSpace(r.RollingSummary), 6000),
		Embeddings:        embeddings,
	}
}

func (h *MemoryHandler) writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrInvalidInput):
		writeJSONErr(w, http.StatusBadRequest, "invalid memory payload")
	case errors.Is(err, domain.ErrNotFound):
		writeJSONErr(w, http.StatusNotFound, "conversation not found")
	default:
		h.Log.ErrorContext(r.Context(), "copilot.memory",
			slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "memory sync failed")
	}
}

func clamp(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}
