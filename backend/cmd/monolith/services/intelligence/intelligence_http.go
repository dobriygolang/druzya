package intelligence

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
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
			// Phase 4.4 — severity wire. Strings cruise/nudge/warn/critical
			// (proto enum переводится через json marshalling proto3 names);
			// этот chi-direct handler просто отдаёт raw string, фронт уже
			// маппит в цвет.
			"severity":        string(brief.Severity),
			"severity_reason": brief.SeverityReason,
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

// newRecentBriefsHandler — Phase 5 Hone /coach feed. Returns last N days
// of cached briefs newest-first. ?days=30 default; capped at 60 на
// repository-level чтобы payload не разросся.
//
// Endpoint: GET /api/v1/intelligence/briefs/recent?days=30
//
// briefs передаются repo напрямую (не use case) — feed это read-only
// проекция, force-flow / cache-staleness не применяются.
func newRecentBriefsHandler(briefs intelDomain.DailyBriefRepo, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := sharedMw.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
			return
		}
		days := 30
		if d := r.URL.Query().Get("days"); d != "" {
			if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 60 {
				days = v
			}
		}
		rows, err := briefs.RecentForUser(r.Context(), uid, days, 60)
		if err != nil {
			if log != nil {
				log.WarnContext(r.Context(), "intelligence.briefs/recent", slog.Any("err", err))
			}
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		items := make([]map[string]any, 0, len(rows))
		for _, b := range rows {
			briefID := ""
			if b.BriefID != uuid.Nil {
				briefID = b.BriefID.String()
			}
			recs := make([]map[string]any, 0, len(b.Recommendations))
			for _, rec := range b.Recommendations {
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
			items = append(items, map[string]any{
				"brief_id":        briefID,
				"headline":        b.Headline,
				"narrative":       b.Narrative,
				"generated_at":    b.GeneratedAt.UTC().Format(time.RFC3339),
				"severity":        string(b.Severity),
				"severity_reason": b.SeverityReason,
				"recommendations": recs,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
	}
}
