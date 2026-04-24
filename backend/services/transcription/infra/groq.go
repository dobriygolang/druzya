package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"time"

	"druz9/transcription/domain"
)

// GroqProvider calls Groq's OpenAI-compatible Whisper endpoint:
//
//	POST https://api.groq.com/openai/v1/audio/transcriptions
//	Authorization: Bearer <GROQ_API_KEY>
//	multipart/form-data:
//	  file=<audio bytes>
//	  model=whisper-large-v3-turbo
//	  language=<hint>    (optional)
//	  prompt=<bias>      (optional)
//	  response_format=json
//
// We use whisper-large-v3-turbo because it's the fastest model on Groq
// (>150x real-time on their hardware) while matching medium-quality
// English+Russian output. Cost per minute is included in the shared
// GROQ free-tier that llmchain already uses.
type GroqProvider struct {
	APIKey  string
	BaseURL string
	Model   string
	client  *http.Client
}

// NewGroqProvider constructs a provider with production-sane defaults.
// Timeout is 60s — long enough for a 10min audio clip, short enough
// that a stuck connection doesn't hold the request handler forever.
func NewGroqProvider(apiKey string) *GroqProvider {
	return &GroqProvider{
		APIKey:  apiKey,
		BaseURL: "https://api.groq.com/openai/v1",
		Model:   "whisper-large-v3-turbo",
		client:  &http.Client{Timeout: 60 * time.Second},
	}
}

// Name implements domain.Provider.
func (g *GroqProvider) Name() string { return "groq" }

// Transcribe implements domain.Provider.
func (g *GroqProvider) Transcribe(ctx context.Context, in domain.TranscribeInput) (domain.TranscribeResult, error) {
	if len(in.Audio) == 0 {
		return domain.TranscribeResult{}, domain.ErrEmptyAudio
	}
	if len(in.Audio) > domain.MaxAudioBytes {
		return domain.TranscribeResult{}, domain.ErrTooLarge
	}

	body, contentType, err := g.buildMultipart(in)
	if err != nil {
		return domain.TranscribeResult{}, fmt.Errorf("build multipart: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.BaseURL+"/audio/transcriptions", body)
	if err != nil {
		return domain.TranscribeResult{}, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+g.APIKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := g.client.Do(req)
	if err != nil {
		// Network/timeout — user-actionable 502. Wrap with the sentinel
		// so callers can distinguish from 4xx validation errors.
		return domain.TranscribeResult{}, fmt.Errorf("%w: %v", domain.ErrProviderUnavailable, err)
	}
	defer resp.Body.Close()

	// Cap the response body: a rogue/compromised provider could try to
	// DoS us by streaming an endless response. 5MB is plenty for any
	// legitimate transcript.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return domain.TranscribeResult{}, fmt.Errorf("%w: read body: %v", domain.ErrProviderUnavailable, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the provider's error message verbatim (clipped) so
		// operators can diagnose rate-limits / bad keys quickly.
		snippet := string(raw)
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		return domain.TranscribeResult{}, fmt.Errorf("%w: groq %d: %s", domain.ErrProviderUnavailable, resp.StatusCode, snippet)
	}

	return parseGroqResponse(raw)
}

// buildMultipart packs the audio + form fields into a multipart body.
// We write file bytes via io.Copy so Content-Disposition headers are
// set correctly with a filename hint (Groq keys format detection off
// the extension when the MIME is ambiguous).
func (g *GroqProvider) buildMultipart(in domain.TranscribeInput) (io.Reader, string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	// file field — need a custom header to set both filename and
	// Content-Type (mw.CreateFormFile hardcodes application/octet-
	// stream, which Groq sometimes rejects for webm without a clue).
	h := textproto.MIMEHeader{}
	filename := in.Filename
	if filename == "" {
		filename = "audio.webm"
	}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	mime := in.MIME
	if mime == "" {
		mime = "audio/webm"
	}
	h.Set("Content-Type", mime)
	fw, err := mw.CreatePart(h)
	if err != nil {
		return nil, "", fmt.Errorf("multipart create part: %w", err)
	}
	if _, err := fw.Write(in.Audio); err != nil {
		return nil, "", fmt.Errorf("multipart write audio: %w", err)
	}

	// Required form fields.
	if err := mw.WriteField("model", g.Model); err != nil {
		return nil, "", fmt.Errorf("multipart write model: %w", err)
	}
	if err := mw.WriteField("response_format", "verbose_json"); err != nil {
		return nil, "", fmt.Errorf("multipart write response_format: %w", err)
	}

	// Optional hints.
	if in.Language != "" {
		if err := mw.WriteField("language", in.Language); err != nil {
			return nil, "", fmt.Errorf("multipart write language: %w", err)
		}
	}
	if in.Prompt != "" {
		if err := mw.WriteField("prompt", in.Prompt); err != nil {
			return nil, "", fmt.Errorf("multipart write prompt: %w", err)
		}
	}

	if err := mw.Close(); err != nil {
		return nil, "", fmt.Errorf("multipart close: %w", err)
	}
	return &buf, mw.FormDataContentType(), nil
}

// groqResponse matches the verbose_json shape. Fields we don't need
// (tokens, temperature, avg_logprob) are omitted — json decoder ignores
// them silently.
type groqResponse struct {
	Text     string        `json:"text"`
	Language string        `json:"language"`
	Duration float64       `json:"duration"`
	Segments []groqSegment `json:"segments"`
	// "error" field appears only on 2xx-with-error-body responses
	// (Groq sometimes returns 200 with {"error":{"message":…}} on
	// rate-limit edge cases — belt-and-suspenders parsing).
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type groqSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

func parseGroqResponse(raw []byte) (domain.TranscribeResult, error) {
	var r groqResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return domain.TranscribeResult{}, fmt.Errorf("%w: parse response: %v", domain.ErrProviderUnavailable, err)
	}
	if r.Error != nil && r.Error.Message != "" {
		return domain.TranscribeResult{}, fmt.Errorf("%w: groq: %s", domain.ErrProviderUnavailable, r.Error.Message)
	}

	segs := make([]domain.Segment, len(r.Segments))
	for i, s := range r.Segments {
		segs[i] = domain.Segment{Start: s.Start, End: s.End, Text: s.Text}
	}

	return domain.TranscribeResult{
		Text:     r.Text,
		Language: r.Language,
		Duration: r.Duration,
		Segments: segs,
	}, nil
}

// Guard: struct satisfies the interface at compile time. Cheap insurance
// against signature drift on the interface side.
var _ domain.Provider = (*GroqProvider)(nil)

// Ensure errors package is used (stays imported if we tweak above).
var _ = errors.New
