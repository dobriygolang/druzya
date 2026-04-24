// Package ports — REST surface for the transcription service.
//
// One endpoint for MVP:
//
//	POST /api/v1/transcription
//	Content-Type: multipart/form-data
//	Fields:
//	  audio     — required, the raw audio file (webm/mp3/wav/m4a)
//	  language  — optional, BCP-47 hint ("ru", "en")
//	  prompt    — optional, bias phrase for domain vocabulary
//
// Auth: bearer-required; audio is billed (even if currently free-tier
// on Groq) so we don't expose to anonymous users.
package ports

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"druz9/transcription/app"
	"druz9/transcription/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	Transcribe *app.Transcribe
	Log        *slog.Logger
}

func (h *Handler) Mount(r chi.Router) {
	r.Post("/transcription", h.handleTranscribe)
}

type transcribeResponse struct {
	Text     string  `json:"text"`
	Language string  `json:"language,omitempty"`
	Duration float64 `json:"duration,omitempty"`
}

func (h *Handler) handleTranscribe(w http.ResponseWriter, r *http.Request) {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	// MaxBytesReader applies to the WHOLE request including form
	// overhead; we size at audio cap + 1MB of padding for form fields
	// and multipart boundary bytes.
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxAudioBytes+1<<20)
	defer r.Body.Close()

	// 32MB in-memory parse budget — bigger parts spill to disk, which
	// Go's multipart handles transparently. We RemoveAll at the end.
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart: "+err.Error())
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, fileHeader, err := r.FormFile("audio")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing audio field")
		return
	}
	defer file.Close()

	audio, err := io.ReadAll(io.LimitReader(file, domain.MaxAudioBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read audio: "+err.Error())
		return
	}
	if int64(len(audio)) > domain.MaxAudioBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "audio too large")
		return
	}

	mime := fileHeader.Header.Get("Content-Type")
	language := r.FormValue("language")
	prompt := r.FormValue("prompt")

	res, err := h.Transcribe.Do(r.Context(), domain.TranscribeInput{
		Audio:    audio,
		Filename: fileHeader.Filename,
		MIME:     mime,
		Language: language,
		Prompt:   prompt,
	})
	if err != nil {
		h.logErr(r, "transcribe", err)
		switch {
		case errors.Is(err, domain.ErrEmptyAudio):
			writeErr(w, http.StatusBadRequest, "empty audio")
		case errors.Is(err, domain.ErrTooLarge):
			writeErr(w, http.StatusRequestEntityTooLarge, "audio too large")
		case errors.Is(err, domain.ErrProviderUnavailable):
			writeErr(w, http.StatusBadGateway, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, "transcription failed")
		}
		return
	}

	writeJSON(w, http.StatusOK, transcribeResponse{
		Text:     res.Text,
		Language: res.Language,
		Duration: res.Duration,
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}

func (h *Handler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "transcription.handler",
		slog.String("op", op),
		slog.Any("err", err))
}
