// run_handler.go — REST endpoint for POST /api/v1/daily/run.
//
// "Run" is the dry-grade variant of SubmitKata: the user gets feedback on the
// example test cases without persisting a submission, mutating the streak,
// or publishing DailyKataCompleted. Same Judge0Client interface is reused so
// switching from the FakeJudge0 stub to a real sandbox is a one-line wiring
// change.
//
// We mount this as a chi route (not a Connect RPC) because:
//
//  1. The endpoint is one POST with a tiny request body — wrapping a proto
//     message + regenerating the entire druz9.v1 surface is overkill (same
//     rationale as streak_calendar_handler.go).
//  2. The client wants the response shape `{passed, total, output, time_ms}`
//     that's UI-tailored — we don't need a new proto contract for that.
//
// Bearer auth is applied at the router level (router.restAuthGate); the
// user_id arrives in ctx via sharedMw.WithUserID.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/daily/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"
)

// RunHandler — http.Handler для POST /api/v1/daily/run.
//
// Holds the Judge0Client directly because there's no persistence and no
// streak side-effect; the request flow is fully synchronous.
type RunHandler struct {
	Judge domain.Judge0Client
	Log   *slog.Logger
	Now   func() time.Time
}

// NewRunHandler builds the handler. log is required (anti-fallback policy).
func NewRunHandler(j domain.Judge0Client, log *slog.Logger, now func() time.Time) *RunHandler {
	if log == nil {
		panic("daily.ports.NewRunHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	if now == nil {
		now = time.Now
	}
	return &RunHandler{Judge: j, Log: log, Now: now}
}

// runRequest mirrors the JSON body the frontend sends.
type runRequest struct {
	KataID   string `json:"kata_id"`
	Code     string `json:"code"`
	Language string `json:"language"`
}

// runResponse is the UI-tailored shape returned to the client.
type runResponse struct {
	Passed bool   `json:"passed"`
	Total  int    `json:"total"`
	Output string `json:"output"`
	TimeMs int64  `json:"time_ms"`
}

// ServeHTTP implements http.Handler.
func (h *RunHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req runRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	if strings.TrimSpace(req.Code) == "" {
		writeJSONError(w, http.StatusBadRequest, "code is required")
		return
	}
	lang := enums.Language(req.Language)
	if !lang.IsValid() {
		writeJSONError(w, http.StatusBadRequest, "invalid language")
		return
	}

	start := h.Now()
	passed, total, ok, err := h.runWithTimeout(r.Context(), req.Code, lang.String())
	elapsed := h.Now().Sub(start)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "daily.Run: judge failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "execution failed")
		return
	}

	out := runResponse{
		Passed: passed,
		Total:  total,
		TimeMs: elapsed.Milliseconds(),
		Output: formatRunOutput(passed, ok, total, elapsed),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}

// runWithTimeout caps the sandboxed run at 30s — anything longer is almost
// certainly an infinite loop in user code (the FakeJudge0 returns instantly,
// but a real sandbox needs the bound).
func (h *RunHandler) runWithTimeout(ctx context.Context, code, lang string) (bool, int, int, error) {
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	passed, total, ok, err := h.Judge.Submit(runCtx, code, lang, domain.TaskPublic{})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return false, 0, 0, fmt.Errorf("daily.Run: timeout: %w", err)
		}
		return false, 0, 0, fmt.Errorf("daily.Run: judge: %w", err)
	}
	return passed, total, ok, nil
}

// formatRunOutput keeps the payload small: a one-line stdout summary that the
// UI renders verbatim. A real sandbox will replace this with actual stdout +
// stderr captured during execution.
func formatRunOutput(passed bool, okCount, total int, elapsed time.Duration) string {
	if total == 0 {
		return "No test cases executed."
	}
	verdict := "FAIL"
	if passed {
		verdict = "PASS"
	}
	return fmt.Sprintf("%s — %d/%d test cases passed in %dms",
		verdict, okCount, total, elapsed.Milliseconds())
}
