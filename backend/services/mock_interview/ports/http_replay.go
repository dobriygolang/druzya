// http_replay.go — chi handlers for the post-debrief "разбор" endpoints.
//
//   GET  /api/v1/mock/attempts/{id}/replay
//   POST /api/v1/mock/attempts/{id}/replay/generate
//
// Both run on the existing /api/v1/* bearer-auth chain (no extra gating
// here — the calling user must own the parent pipeline; we verify via
// stage → pipeline → user_id chain on the use case side).
//
// Why chi-direct rather than going through Connect / proto:
//   - mock_interview's REST↔Connect migration is mid-flight (~30 RPCs
//     migrated, the rest still chi). Adding more proto for a v1 feature
//     would couple us to a code-gen step on every backend redeploy.
//   - Replay payload contains nested annotations array — proto can
//     express it, but JSON-native shape is cleaner for the read API.
//
// Returns:
//   - 200 with replay payload (matches MockReplayOutput).
//   - 404 when the attempt id doesn't exist.
//   - 202 (GET only) when no replay has been generated yet — body is
//     `{"status":"not_ready"}` — frontend prompts user to click
//     "Сгенерировать разбор" → POST /replay/generate.
//   - 503 when the LLM cascade is unavailable.
package ports

import (
	"errors"
	"net/http"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// getReplay — GET handler. Reads cached row; 202 (not_ready) when nothing
// cached.
func (s *Server) getReplay(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Replay == nil {
		writeErr(w, http.StatusServiceUnavailable, "replay not wired")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id: "+err.Error())
		return
	}
	// Ownership check — we need to traverse attempt → stage → pipeline
	// → user_id. The shared helper does this for canvas endpoints; use it.
	if !s.requireAttemptOwner(w, r, attemptID, uid) {
		return
	}

	out, err := s.Replay.Get(r.Context(), attemptID)
	if err != nil {
		if errors.Is(err, domain.ErrReplayNotReady) {
			writeJSON(w, http.StatusAccepted, map[string]any{
				"status": "not_ready",
			})
			return
		}
		s.errToHTTP(w, r, err, "Replay.Get")
		return
	}
	writeJSON(w, http.StatusOK, replayOutputToWire(out))
}

// generateReplay — POST handler. Fires LLM, caches, returns fresh blob.
// 503 на LLM-unavailable; 200 on success. POST without body (path-only).
func (s *Server) generateReplay(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Replay == nil {
		writeErr(w, http.StatusServiceUnavailable, "replay not wired")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id: "+err.Error())
		return
	}
	if !s.requireAttemptOwner(w, r, attemptID, uid) {
		return
	}

	out, err := s.Replay.Generate(r.Context(), attemptID)
	if err != nil {
		if errors.Is(err, app.ErrReplayUnavailable) {
			writeErr(w, http.StatusServiceUnavailable, "LLM cascade returned no usable response")
			return
		}
		s.errToHTTP(w, r, err, "Replay.Generate")
		return
	}
	writeJSON(w, http.StatusOK, replayOutputToWire(out))
}

// replayOutputToWire — flattens domain types into snake_case JSON shape
// the frontend expects. Keeps the chi-handler thin.
func replayOutputToWire(o app.MockReplayOutput) map[string]any {
	anns := make([]map[string]any, 0, len(o.Annotations))
	for _, a := range o.Annotations {
		anns = append(anns, map[string]any{
			"your_excerpt":  a.YourExcerpt,
			"ideal_excerpt": a.IdealExcerpt,
			"type":          string(a.Type),
			"comment":       a.Comment,
		})
	}
	return map[string]any{
		"attempt_id":      o.AttemptID.String(),
		"ideal_answer_md": o.IdealAnswerMD,
		"annotations":     anns,
		"generated_at":    o.GeneratedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		"question_body":   o.QuestionBody,
		"your_answer_md":  o.YourAnswerMD,
	}
}

// requireAttemptOwner — fetch attempt → stage → pipeline; 404 if not
// found, 403 if pipeline belongs to a different user. We don't surface
// "exists but not yours" as 403 in the body (gives away resource
// existence); generic 404 instead.
func (s *Server) requireAttemptOwner(w http.ResponseWriter, r *http.Request, attemptID, uid uuid.UUID) bool {
	att, err := s.H.Attempts.Get(r.Context(), attemptID)
	if err != nil {
		s.errToHTTP(w, r, err, "Attempts.Get for replay owner")
		return false
	}
	stage, err := s.H.PipelineStages.Get(r.Context(), att.PipelineStageID)
	if err != nil {
		s.errToHTTP(w, r, err, "PipelineStages.Get for replay owner")
		return false
	}
	pip, err := s.H.Pipelines.Get(r.Context(), stage.PipelineID)
	if err != nil {
		s.errToHTTP(w, r, err, "Pipelines.Get for replay owner")
		return false
	}
	if pip.UserID != uid {
		writeErr(w, http.StatusNotFound, "not found")
		return false
	}
	return true
}
