// streak_calendar_handler.go — REST endpoint for the year-grid on
// /daily/streak.
//
// We mount this as a chi route (not a Connect RPC) for two reasons:
//
//  1. The shape is page-specific (denormalised into 12 month buckets +
//     header counters) and only consumed by KataStreakPage. Wrapping it
//     in a proto contract + regenerating the entire druz9.v1 surface
//     for one read endpoint is overkill — same call we made for
//     /api/v1/support/ticket and /api/v1/voice/turn.
//  2. A simple GET with one optional query param (`?year=`) does not
//     benefit from Connect's strongly-typed request envelope.
//
// Bearer auth is applied at the router level (router.restAuthGate); the
// user_id arrives in ctx via sharedMw.WithUserID — same plumbing every
// other authed REST endpoint relies on.
package ports

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"druz9/daily/app"
	sharedMw "druz9/shared/pkg/middleware"
)

// StreakCalendarHandler — http.Handler для GET /api/v1/kata/streak.
type StreakCalendarHandler struct {
	UC  *app.GetStreakCalendar
	Log *slog.Logger
}

// NewStreakCalendarHandler builds the handler. log is required (anti-fallback policy).
func NewStreakCalendarHandler(uc *app.GetStreakCalendar, log *slog.Logger) *StreakCalendarHandler {
	if log == nil {
		panic("daily.ports.NewStreakCalendarHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &StreakCalendarHandler{UC: uc, Log: log}
}

// streakCalendarResponse mirrors the shape the frontend expects.
// Field names match frontend/src/lib/queries/streak.ts (StreakResponse).
type streakCalendarResponse struct {
	Current      int                   `json:"current"`
	Best         int                   `json:"best"`
	FreezeTokens int                   `json:"freeze_tokens"`
	FreezeMax    int                   `json:"freeze_max"`
	TotalDone    int                   `json:"total_done"`
	TotalMissed  int                   `json:"total_missed"`
	TotalFreeze  int                   `json:"total_freeze"`
	Remaining    int                   `json:"remaining"`
	Year         int                   `json:"year"`
	Months       []streakMonthResponse `json:"months"`
}

type streakMonthResponse struct {
	Name   string `json:"name"`
	Done   int    `json:"done"`
	Missed int    `json:"missed"`
	Freeze int    `json:"freeze"`
	Total  int    `json:"total"`
}

// ServeHTTP implements http.Handler.
func (h *StreakCalendarHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	year, err := parseYearParam(r.URL.Query().Get("year"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	cal, err := h.UC.Do(r.Context(), uid, year)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "kata.streak: GetStreakCalendar failed",
			slog.Any("err", err), slog.Any("user_id", uid))
		writeJSONError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := streakCalendarResponse{
		Current:      cal.Current,
		Best:         cal.Best,
		FreezeTokens: cal.FreezeTokens,
		FreezeMax:    cal.FreezeMax,
		TotalDone:    cal.TotalDone,
		TotalMissed:  cal.TotalMissed,
		TotalFreeze:  cal.TotalFreeze,
		Remaining:    cal.Remaining,
		Year:         cal.Year,
		Months:       make([]streakMonthResponse, 0, len(cal.Months)),
	}
	for _, m := range cal.Months {
		out.Months = append(out.Months, streakMonthResponse{
			Name:   m.Name,
			Done:   m.Done,
			Missed: m.Missed,
			Freeze: m.Freeze,
			Total:  m.Total,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}

// parseYearParam parses the optional `year=` query string.
// Empty → 0 (use case interprets as "current year").
func parseYearParam(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	y, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid year: %w", err)
	}
	if y < 2000 || y > 9999 {
		return 0, errors.New("year out of range (2000..9999)")
	}
	return y, nil
}

// writeJSONError keeps the wire shape consistent with other ad-hoc handlers
// in this package (notify/support_handler.go writeError).
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}
