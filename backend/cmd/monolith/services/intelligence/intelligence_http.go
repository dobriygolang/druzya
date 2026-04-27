package intelligence

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// newDailyBriefDirectHandler builds a chi-direct alias for
// POST /intelligence/daily-brief that calls the GetDailyBrief use case
// without going through vanguard. Identical wire shape to the proto
// (camelCase JSON) so the frontend doesn't have to branch.
func newDailyBriefDirectHandler(uc *intelApp.GetDailyBrief, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		// Body is optional. Accept empty / non-JSON bodies — proto
		// behaviour is "force defaults to false" anyway.
		var body struct {
			Force bool `json:"force"`
		}
		if r.ContentLength != 0 && r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		brief, err := uc.Do(r.Context(), intelApp.GetDailyBriefInput{
			UserID: uid,
			Force:  body.Force,
		})
		if err != nil {
			status := http.StatusInternalServerError
			switch {
			case errors.Is(err, intelDomain.ErrLLMUnavailable):
				status = http.StatusServiceUnavailable
			case errors.Is(err, intelDomain.ErrRateLimited):
				status = http.StatusTooManyRequests
			}
			if log != nil {
				log.WarnContext(r.Context(), "intelligence.daily-brief direct", slog.Any("err", err))
			}
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), status)
			return
		}
		briefID := ""
		if brief.BriefID != uuid.Nil {
			briefID = brief.BriefID.String()
		}
		out := map[string]any{
			"brief_id":     briefID,
			"headline":     brief.Headline,
			"narrative":    brief.Narrative,
			"generated_at": brief.GeneratedAt.UTC().Format(time.RFC3339),
		}
		recs := make([]map[string]any, 0, len(brief.Recommendations))
		for _, rec := range brief.Recommendations {
			row := map[string]any{
				"kind":      string(rec.Kind),
				"title":     rec.Title,
				"rationale": rec.Rationale,
			}
			if rec.TargetID != "" {
				row["target_id"] = rec.TargetID
			}
			recs = append(recs, row)
		}
		out["recommendations"] = recs
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}
