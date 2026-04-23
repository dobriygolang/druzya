package ports

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"
)

// PracticeHandler exposes POST /api/v1/arena/practice — instant single-player
// match against a built-in AI opponent. It is a chi-direct route (NOT proto-
// transcoded) because the proto contract for Connect ArenaService doesn't
// model the practice flow yet — adding the field would require a proto bump
// and full client regen, which is out of scope for the user-facing fix.
type PracticeHandler struct {
	UC        *app.StartPractice
	UserEloFn UserEloFunc
}

// NewPracticeHandler wires the handler.
func NewPracticeHandler(uc *app.StartPractice, eloFn UserEloFunc) *PracticeHandler {
	return &PracticeHandler{UC: uc, UserEloFn: eloFn}
}

// PracticeRequest is the JSON body for POST /arena/practice.
type PracticeRequest struct {
	// Section selects the task pool. Defaults to "algorithms" when empty.
	Section string `json:"section"`
	// NeuralModel is a hint for which AI persona to render client-side.
	NeuralModel string `json:"neural_model"`
}

// PracticeResponse is the JSON response body.
type PracticeResponse struct {
	MatchID       string `json:"match_id"`
	OpponentLabel string `json:"opponent_label"`
	Status        string `json:"status"`
	StartedAt     string `json:"started_at"`
}

// ServeHTTP implements http.Handler.
func (h *PracticeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePracticeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var body PracticeRequest
	// Empty body is allowed — defaults take over.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writePracticeErr(w, http.StatusBadRequest, fmt.Sprintf("invalid json: %s", err.Error()))
			return
		}
	}
	section := enums.Section(body.Section)
	if section == "" {
		section = enums.SectionAlgorithms
	}
	if !section.IsValid() {
		writePracticeErr(w, http.StatusBadRequest, "invalid section")
		return
	}
	elo := domain.InitialELO
	if h.UserEloFn != nil {
		elo = h.UserEloFn(r.Context(), uid, section)
	}
	out, err := h.UC.Do(r.Context(), app.StartPracticeInput{
		UserID:      uid,
		Elo:         elo,
		Section:     section,
		NeuralModel: body.NeuralModel,
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrNotFound):
			writePracticeErr(w, http.StatusNotFound, "no task available for this section")
		default:
			writePracticeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	resp := PracticeResponse{
		MatchID:       out.MatchID.String(),
		OpponentLabel: out.OpponentLabel,
		Status:        string(out.Status),
		StartedAt:     out.StartedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		// Status already written — best we can do is log via the default
		// logger; the caller will see a truncated body and retry.
		return
	}
}

func writePracticeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
