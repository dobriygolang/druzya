// Package ports — REST handler for the /match-history page.
//
// GetMyMatches lives here as a plain chi handler instead of a Connect-RPC
// method. The contract (path, query params, JSON shape) matches what the
// frontend already calls; switching it to Connect later only changes the
// transport, not the wire payload.
//
// The shape mirrors what /api/v1/arena/match/{id} returns for the match
// detail endpoint — flat fields, no participant nesting — because the
// /match-history table doesn't need the full ArenaMatch tree per row.
package ports

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// MatchHistoryEntryDTO is the wire shape returned by GET /api/v1/arena/matches/my.
type MatchHistoryEntryDTO struct {
	MatchID           string    `json:"match_id"`
	FinishedAt        time.Time `json:"finished_at"`
	Mode              string    `json:"mode"`
	Section           string    `json:"section"`
	OpponentUserID    string    `json:"opponent_user_id"`
	OpponentUsername  string    `json:"opponent_username"`
	OpponentAvatarURL string    `json:"opponent_avatar_url"`
	Result            string    `json:"result"`
	LPChange          int       `json:"lp_change"`
	DurationSeconds   int       `json:"duration_seconds"`
}

// GetMyMatchesResponseDTO is the JSON envelope for the history page.
type GetMyMatchesResponseDTO struct {
	Items []MatchHistoryEntryDTO `json:"items"`
	Total int                    `json:"total"`
}

// MyMatchesHandler builds an http.HandlerFunc backed by the GetMyMatches
// use case. Pulled out so cmd/monolith can wire it into the chi router
// without exposing the use case directly to chi-only test setups.
func MyMatchesHandler(uc *app.GetMyMatches) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
			return
		}

		q := r.URL.Query()
		limit, err := atoiDefault(q.Get("limit"), 0)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		offset, err := atoiDefault(q.Get("offset"), 0)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid offset")
			return
		}

		mode := enums.ArenaMode(q.Get("mode"))
		if mode != "" && !mode.IsValid() {
			writeJSONError(w, http.StatusBadRequest, "invalid mode")
			return
		}
		section := enums.Section(q.Get("section"))
		if section != "" && !section.IsValid() {
			writeJSONError(w, http.StatusBadRequest, "invalid section")
			return
		}

		out, err := uc.Do(r.Context(), app.GetMyMatchesInput{
			UserID:  uid,
			Limit:   limit,
			Offset:  offset,
			Mode:    mode,
			Section: section,
		})
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "history failure")
			return
		}

		dto := GetMyMatchesResponseDTO{
			Items: make([]MatchHistoryEntryDTO, 0, len(out.Items)),
			Total: out.Total,
		}
		for _, e := range out.Items {
			dto.Items = append(dto.Items, toEntryDTO(e))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(dto)
	}
}

// toEntryDTO converts a domain entry to its wire form.
func toEntryDTO(e domain.MatchHistoryEntry) MatchHistoryEntryDTO {
	dto := MatchHistoryEntryDTO{
		MatchID:           e.MatchID.String(),
		FinishedAt:        e.FinishedAt,
		Mode:              string(e.Mode),
		Section:           string(e.Section),
		OpponentUsername:  e.OpponentUsername,
		OpponentAvatarURL: e.OpponentAvatarURL,
		Result:            e.Result,
		LPChange:          e.LPChange,
		DurationSeconds:   e.DurationSeconds,
	}
	if e.OpponentUserID != uuid.Nil {
		dto.OpponentUserID = e.OpponentUserID.String()
	}
	return dto
}

// atoiDefault parses s as an int; empty string falls back to def.
func atoiDefault(s string, def int) (int, error) {
	if s == "" {
		return def, nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, errors.New("invalid integer")
	}
	return v, nil
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
