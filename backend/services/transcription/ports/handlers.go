// Package ports exposes the REST and WebSocket surfaces for the
// transcription service.
//
//	POST /api/v1/transcription
//	Content-Type: multipart/form-data
//	Fields:
//	  audio     — required, the raw audio file (webm/mp3/wav/m4a)
//	  language  — optional, BCP-47 hint ("ru", "en")
//	  prompt    — optional, bias phrase for domain vocabulary
//
// Auth: bearer-required; audio is billed (even when on a free Groq tier)
// so we never expose this to anonymous users.
package ports

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"druz9/shared/pkg/killswitch"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/pkg/ratelimit"
	"druz9/transcription/app"
	"druz9/transcription/domain"

	"github.com/go-chi/chi/v5"
)

// transcribeLimitPerMin caps per-user calls at 60/min. AudioCaptureMac
// emits at most one chunk every ~2 seconds (with VAD), so 60/min gives
// ~2x headroom for mic bursts; a higher cap would expose us to runaway
// Groq bills if a client bug started spamming /transcription.
const (
	transcribeLimitPerMin = 60
	multipartMemoryBudget = 32 << 20 // bigger parts spill to disk
	formOverheadPadding   = 1 << 20  // headroom for form fields + multipart boundary
)

// Handler serves the POST /transcription endpoint.
type Handler struct {
	// Tiered applies per-call tier resolution → model selection → inner
	// Transcribe. nil-safe: when subscription wiring is not loaded, the
	// decorator passes through with the default model.
	Tiered *app.TieredTranscribe
	// Limiter caps the Groq per-user call rate. nil disables limiting
	// (dev mode without Redis).
	Limiter *ratelimit.RedisFixedWindow
	// KillSwitch lets an operator disable the endpoint without a deploy.
	KillSwitch *killswitch.Switch
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
	if h.KillSwitch != nil && h.KillSwitch.IsOn(r.Context(), killswitch.FeatureTranscription) {
		w.Header().Set("Retry-After", "60")
		writeErr(w, http.StatusServiceUnavailable, "transcription temporarily disabled by operator")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if h.Limiter != nil {
		key := "rl:trans:" + uid.String()
		res, err := h.Limiter.Allow(r.Context(), key, transcribeLimitPerMin, time.Minute)
		if err == nil && !res.Allowed {
			w.Header().Set("Retry-After", strconv.Itoa(res.RetryAfterSec))
			writeErr(w, http.StatusTooManyRequests, "rate limited, retry in "+strconv.Itoa(res.RetryAfterSec)+"s")
			return
		}
		// err != nil means a Redis transport fault; we fail open so one
		// Redis blip cannot break STT for every user.
	}

	// MaxBytesReader applies to the whole request, so size it at the audio
	// cap plus padding for form fields and the multipart boundary.
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxAudioBytes+formOverheadPadding)
	defer deferCleanupForm(r)()

	if err := r.ParseMultipartForm(multipartMemoryBudget); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart: "+err.Error())
		return
	}

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

	res, err := h.Tiered.Do(r.Context(), uid, domain.TranscribeInput{
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

// deferCleanupForm returns a closer that releases multipart resources
// and the request body. Use as `defer deferCleanupForm(r)()`.
func deferCleanupForm(r *http.Request) func() {
	return func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		_ = r.Body.Close()
	}
}

func (h *Handler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "transcription.handler",
		slog.String("op", op),
		slog.Any("err", err))
}
