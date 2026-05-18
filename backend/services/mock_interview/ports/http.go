// http.go — chi-mounted handlers, оставшиеся после chi→proto миграции.
// Все JSON endpoints мигрированы в Connect (см. connect_server.go,
// connect_admin.go); здесь живут только бинарные/streaming endpoints,
// которые не подходят под proto-JSON: canvas submit и canvas drafts.
//
// Auth: bearer middleware применяется на родительском роутере.
package ports

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// errCanvasTooLarge — distinct sentinel так что хендлер может выбрать 413 vs 400.
var errCanvasTooLarge = errors.New("image_data_url payload exceeds 5MB")

const maxCanvasBase64Bytes = 5 * 1024 * 1024

// validateCanvasDataURL enforces shape/size требования для
// POST /mock/attempts/{id}/submit-canvas. Только image/png и image/jpeg
// base64 data URLs, decoded payload ≤5MB.
func validateCanvasDataURL(s string) error {
	const prefix = "data:"
	s = strings.TrimSpace(s)
	if s == "" {
		return errors.New("image_data_url empty")
	}
	if !strings.HasPrefix(s, prefix) {
		return errors.New("image_data_url must start with data:image/png;base64, or data:image/jpeg;base64,")
	}
	rest := s[len(prefix):]
	semi := strings.Index(rest, ";")
	if semi < 0 {
		return errors.New("image_data_url missing ;base64,")
	}
	mime := rest[:semi]
	if mime != "image/png" && mime != "image/jpeg" {
		return fmt.Errorf("image_data_url unsupported mime %q (allowed: image/png, image/jpeg)", mime)
	}
	rest = rest[semi+1:]
	if !strings.HasPrefix(rest, "base64,") {
		return errors.New("image_data_url not base64-encoded")
	}
	rest = rest[len("base64,"):]
	decoded, err := base64.StdEncoding.DecodeString(rest)
	if err != nil {
		return fmt.Errorf("image_data_url base64 decode: %w", err)
	}
	if len(decoded) > maxCanvasBase64Bytes {
		return errCanvasTooLarge
	}
	return nil
}

// Mount регистрирует binary canvas endpoints. JSON endpoints живут в
// connect_server.go / connect_admin.go (mounted через vanguard transcoder
// в cmd/monolith).
func (s *Server) Mount(r chi.Router) {
	r.Post("/mock/attempts/{id}/submit-canvas", s.publicSubmitCanvas)
	r.Get("/mock/attempts/{id}/canvas-draft", s.publicGetCanvasDraft)
	r.Put("/mock/attempts/{id}/canvas-draft", s.publicSaveCanvasDraft)
	r.Delete("/mock/attempts/{id}/canvas-draft", s.publicDeleteCanvasDraft)
	// Post-debrief "разбор" replay (см. http_replay.go). Stays chi
	// because the nested annotation payload reads more naturally in
	// JSON-native shape than through proto round-trip.
	r.Get("/mock/attempts/{id}/replay", s.getReplay)
	r.Post("/mock/attempts/{id}/replay/generate", s.generateReplay)
}

// ── helpers ─────────────────────────────────────────────────────────────

func parseUUIDParam(r *http.Request, key string) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, key))
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("uuid.Parse url_param %s: %w", key, err)
	}
	return id, nil
}

func decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}

// requirePipelineOwner — pipeline существует И принадлежит uid. 401/403/404
// при failure (404 чтобы скрыть существование чужого pipeline'а).
func (s *Server) requirePipelineOwner(w http.ResponseWriter, r *http.Request, pipelineID uuid.UUID, uid uuid.UUID) bool {
	p, err := s.H.Pipelines.Get(r.Context(), pipelineID)
	if err != nil {
		s.errToHTTP(w, r, err, "requirePipelineOwner")
		return false
	}
	if p.UserID != uid {
		writeErr(w, http.StatusNotFound, "not found")
		return false
	}
	return true
}

// ── canvas submit ──────────────────────────────────────────────────────

func (s *Server) publicSubmitCanvas(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in submitCanvasRequest
	if derr := decode(r, &in); derr != nil {
		writeErr(w, http.StatusBadRequest, derr.Error())
		return
	}
	// Validate data URL shape and size before pulling LLM into the loop.
	if verr := validateCanvasDataURL(in.ImageDataURL); verr != nil {
		if errors.Is(verr, errCanvasTooLarge) {
			writeErr(w, http.StatusRequestEntityTooLarge, verr.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, verr.Error())
		return
	}

	att, err := s.H.Attempts.Get(r.Context(), attemptID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas attempt")
		return
	}
	stage, err := s.H.PipelineStages.Get(r.Context(), att.PipelineStageID)
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas stage")
		return
	}
	if !s.requirePipelineOwner(w, r, stage.PipelineID, uid) {
		return
	}

	out, err := s.Orch.SubmitCanvas(r.Context(), app.SubmitCanvasInput{
		AttemptID:       attemptID,
		UserID:          uid,
		ImageDataURL:    in.ImageDataURL,
		SceneJSON:       []byte(in.SceneJSON),
		ContextMD:       in.ContextMD,
		NonFunctionalMD: in.NonFunctionalMD,
	})
	if err != nil {
		s.errToHTTP(w, r, err, "publicSubmitCanvas")
		return
	}
	writeJSON(w, http.StatusOK, toPipelineAttemptDTO(out, "", "", nil))
}

// ── canvas drafts (Redis fallback) ─────────────────────────────────────

func (s *Server) publicSaveCanvasDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body canvasDraftBody
	if derr := decode(r, &body); derr != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if len(body.SceneJSON) == 0 {
		writeErr(w, http.StatusBadRequest, "scene_json required")
		return
	}
	if err := s.Orch.SaveCanvasDraft(r.Context(), app.SaveCanvasDraftInput{
		AttemptID:       attemptID,
		UserID:          uid,
		SceneJSON:       []byte(body.SceneJSON),
		NonFunctionalMD: body.NonFunctionalMD,
		ContextMD:       body.ContextMD,
	}); err != nil {
		if errors.Is(err, domain.ErrValidation) {
			writeErr(w, http.StatusRequestEntityTooLarge, "draft too large")
			return
		}
		s.errToHTTP(w, r, err, "publicSaveCanvasDraft")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) publicGetCanvasDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	d, err := s.Orch.GetCanvasDraft(r.Context(), attemptID, uid)
	if err != nil {
		s.errToHTTP(w, r, err, "publicGetCanvasDraft")
		return
	}
	writeJSON(w, http.StatusOK, canvasDraftDTO{
		SceneJSON:       json.RawMessage(d.SceneJSON),
		NonFunctionalMD: d.NonFunctionalMD,
		ContextMD:       d.ContextMD,
		UpdatedAt:       d.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	})
}

func (s *Server) publicDeleteCanvasDraft(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.Orch == nil {
		writeErr(w, http.StatusServiceUnavailable, "orchestrator not configured")
		return
	}
	attemptID, err := parseUUIDParam(r, "id")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.Orch.DeleteCanvasDraft(r.Context(), attemptID, uid); err != nil {
		s.errToHTTP(w, r, err, "publicDeleteCanvasDraft")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
