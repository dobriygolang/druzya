// Package ports — REST handlers for the quiz service. Mounted under
// /api/v1/quiz/* by the monolith wiring.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"druz9/quiz/app"
	"druz9/quiz/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Handler bundles the quiz use cases for chi mount.
type Handler struct {
	Start  *app.StartSession
	Submit *app.SubmitSession
	Log    *slog.Logger
}

// Mount registers the routes onto an existing chi router under /api/v1.
func (h *Handler) Mount(r chi.Router) {
	r.Post("/quiz/start", h.handleStart)
	r.Post("/quiz/{session_id}/submit", h.handleSubmit)
}

// ── DTOs ─────────────────────────────────────────────────────────────────

type questionWire struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Topic       string `json:"topic,omitempty"`
	QuestionMD  string `json:"questionMd"`
	AnswerHint  string `json:"answerHint,omitempty"`
	ReadingLink string `json:"readingLink,omitempty"`
}

type startReq struct {
	Source string `json:"source"`
	Topic  string `json:"topic"`
	Count  int    `json:"count"`
}

type startResp struct {
	SessionID string         `json:"sessionId"`
	Source    string         `json:"source"`
	Questions []questionWire `json:"questions"`
	ExpiresAt int64          `json:"expiresAt"`
}

type submitReq struct {
	Answers map[string]string `json:"answers"`
}

type judgementWire struct {
	QuestionID  string `json:"questionId"`
	Correct     bool   `json:"correct"`
	Explanation string `json:"explanation,omitempty"`
}

type submitResp struct {
	SessionID  string          `json:"sessionId"`
	Source     string          `json:"source"`
	Total      int             `json:"total"`
	Correct    int             `json:"correct"`
	Judgements []judgementWire `json:"judgements"`
}

// ── Handlers ─────────────────────────────────────────────────────────────

func (h *Handler) handleStart(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	var body startReq
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_body", err.Error())
		return
	}
	src := domain.QuestionSource(body.Source)
	if !src.IsValid() {
		writeErr(w, http.StatusBadRequest, "bad_source",
			fmt.Sprintf("expected one of codex|mock_interview|mixed, got %q", body.Source))
		return
	}
	s, err := h.Start.Do(r.Context(), app.StartSessionInput{
		UserID: uid, Source: src, Topic: body.Topic, Count: body.Count,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "empty_pool", "no questions match the given source/topic")
			return
		}
		h.serverError(w, r, "start", err, uid)
		return
	}
	out := startResp{
		SessionID: s.ID.String(),
		Source:    string(s.Source),
		Questions: make([]questionWire, 0, len(s.Questions)),
		ExpiresAt: s.ExpiresAt.Unix(),
	}
	for _, q := range s.Questions {
		out.Questions = append(out.Questions, questionWire{
			ID:          q.ID,
			Source:      string(q.Source),
			Topic:       q.Topic,
			QuestionMD:  q.QuestionMD,
			AnswerHint:  q.AnswerHint,
			ReadingLink: q.ReadingLink,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handler) handleSubmit(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "session_id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var body submitReq
	if jerr := readJSON(r, &body); jerr != nil {
		writeErr(w, http.StatusBadRequest, "bad_body", jerr.Error())
		return
	}
	res, err := h.Submit.Do(r.Context(), app.SubmitSessionInput{
		UserID: uid, SessionID: id, Answers: body.Answers,
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSessionExpired):
			writeErr(w, http.StatusGone, "session_expired", "")
		case errors.Is(err, domain.ErrNotFound):
			writeErr(w, http.StatusNotFound, "not_found", "")
		default:
			h.serverError(w, r, "submit", err, uid)
		}
		return
	}
	out := submitResp{
		SessionID:  res.SessionID.String(),
		Source:     string(res.Source),
		Total:      res.Total,
		Correct:    res.Correct,
		Judgements: make([]judgementWire, 0, len(res.Judgements)),
	}
	for _, j := range res.Judgements {
		out.Judgements = append(out.Judgements, judgementWire{
			QuestionID: j.QuestionID, Correct: j.Correct, Explanation: j.Explanation,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ── helpers ──────────────────────────────────────────────────────────────

func (h *Handler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	if h.Log != nil {
		h.Log.ErrorContext(r.Context(), "quiz.http",
			slog.String("where", where),
			slog.String("user_id", uid.String()),
			slog.Any("err", err))
	}
	writeErr(w, http.StatusInternalServerError, "internal", "")
}

func readJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("empty body")
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return fmt.Errorf("quiz.readJSON: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, `{"error":{"code":%q,"message":%q}}`, code, message)
}
