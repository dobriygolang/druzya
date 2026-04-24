package infra

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/transcription/domain"
)

// newTestProvider — Groq provider pointed at an httptest server.
// Timeout collapsed to 2s so accidental hangs fail tests fast.
func newTestProvider(baseURL string) *GroqProvider {
	p := NewGroqProvider("test-key")
	p.BaseURL = baseURL
	p.client.Timeout = 2 * 1_000_000_000 // 2s
	return p
}

// TestGroqProvider_Happy — 200 verbose_json → populated TranscribeResult.
// Also verifies: bearer header present, multipart 'file' part contains
// our bytes, 'model' form field set to whisper-large-v3-turbo.
func TestGroqProvider_Happy(t *testing.T) {
	var (
		gotAuth     string
		gotModel    string
		gotLang     string
		gotFileBody []byte
		gotFileName string
		gotFileCT   string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")

		// Parse multipart, extract file + fields.
		mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
			http.Error(w, "not multipart", http.StatusBadRequest)
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			switch part.FormName() {
			case "file":
				gotFileName = part.FileName()
				gotFileCT = part.Header.Get("Content-Type")
				gotFileBody, _ = io.ReadAll(part)
			case "model":
				b, _ := io.ReadAll(part)
				gotModel = string(b)
			case "language":
				b, _ := io.ReadAll(part)
				gotLang = string(b)
			default:
				_, _ = io.Copy(io.Discard, part)
			}
			_ = part.Close()
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"text": "Привет мир",
			"language": "ru",
			"duration": 1.23,
			"segments": [
				{"start": 0.0, "end": 0.6, "text": "Привет"},
				{"start": 0.6, "end": 1.23, "text": " мир"}
			]
		}`))
	}))
	defer srv.Close()

	p := newTestProvider(srv.URL)
	audio := []byte{0xde, 0xad, 0xbe, 0xef, 0x00, 0x01}
	res, err := p.Transcribe(context.Background(), domain.TranscribeInput{
		Audio:    audio,
		Filename: "rec.webm",
		MIME:     "audio/webm",
		Language: "ru",
	})
	if err != nil {
		t.Fatalf("err: %v", err)
	}

	if res.Text != "Привет мир" {
		t.Errorf("text = %q, want 'Привет мир'", res.Text)
	}
	if res.Language != "ru" || res.Duration != 1.23 {
		t.Errorf("language/duration = %q/%v", res.Language, res.Duration)
	}
	if len(res.Segments) != 2 {
		t.Errorf("want 2 segments, got %d", len(res.Segments))
	}

	// Verify request shape.
	if gotAuth != "Bearer test-key" {
		t.Errorf("auth header = %q", gotAuth)
	}
	if gotModel != "whisper-large-v3-turbo" {
		t.Errorf("model form field = %q", gotModel)
	}
	if gotLang != "ru" {
		t.Errorf("language form field = %q", gotLang)
	}
	if gotFileName != "rec.webm" {
		t.Errorf("filename = %q", gotFileName)
	}
	if gotFileCT != "audio/webm" {
		t.Errorf("file Content-Type = %q", gotFileCT)
	}
	if string(gotFileBody) != string(audio) {
		t.Errorf("file body = %v, want %v", gotFileBody, audio)
	}
}

// TestGroqProvider_EmptyAudio — short-circuit без сетевого вызова.
// Наш handler уже отфильтровывает, но провайдер — defence in depth.
func TestGroqProvider_EmptyAudio(t *testing.T) {
	p := NewGroqProvider("k")
	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{Audio: nil})
	if !errors.Is(err, domain.ErrEmptyAudio) {
		t.Errorf("want ErrEmptyAudio, got %v", err)
	}
}

// TestGroqProvider_TooLarge — audio > MaxAudioBytes → ErrTooLarge,
// снова до сетевого вызова. Сэкономленный HTTP roundtrip на ошибке.
func TestGroqProvider_TooLarge(t *testing.T) {
	p := NewGroqProvider("k")
	// MaxAudioBytes+1 — граница.
	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{
		Audio: make([]byte, domain.MaxAudioBytes+1),
	})
	if !errors.Is(err, domain.ErrTooLarge) {
		t.Errorf("want ErrTooLarge, got %v", err)
	}
}

// TestGroqProvider_Non2xx — 401/429/500/etc → ErrProviderUnavailable
// с фрагментом тела для диагностики.
func TestGroqProvider_Non2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
	}))
	defer srv.Close()

	p := newTestProvider(srv.URL)
	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{
		Audio: []byte{0, 1, 2},
	})
	if !errors.Is(err, domain.ErrProviderUnavailable) {
		t.Errorf("want ErrProviderUnavailable, got %v", err)
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention 401: %v", err)
	}
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("error should surface provider message: %v", err)
	}
}

// TestGroqProvider_ErrorInBody — 200 OK но с "error" в JSON body
// (Groq иногда так отвечает на rate-limit). Обрабатываем как провайдер-
// ошибку, а не успех с пустым текстом.
func TestGroqProvider_ErrorInBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"","error":{"message":"rate_limit_exceeded"}}`))
	}))
	defer srv.Close()

	p := newTestProvider(srv.URL)
	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{
		Audio: []byte{0, 1, 2},
	})
	if !errors.Is(err, domain.ErrProviderUnavailable) {
		t.Errorf("want ErrProviderUnavailable, got %v", err)
	}
	if !strings.Contains(err.Error(), "rate_limit_exceeded") {
		t.Errorf("error should surface provider code: %v", err)
	}
}

// TestGroqProvider_MalformedJSON — 200 OK с битым JSON → provider-error,
// не паника/сегфолт.
func TestGroqProvider_MalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{not json`))
	}))
	defer srv.Close()

	p := newTestProvider(srv.URL)
	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{Audio: []byte{0, 1}})
	if !errors.Is(err, domain.ErrProviderUnavailable) {
		t.Errorf("want ErrProviderUnavailable on malformed JSON, got %v", err)
	}
}

// TestGroqProvider_NetworkFailure — BaseURL указывает на закрытый порт
// → таймаут/connection refused → ErrProviderUnavailable. Проверяем что
// wrap'аем в sentinel, а не просто пробрасываем сетевую ошибку.
func TestGroqProvider_NetworkFailure(t *testing.T) {
	p := NewGroqProvider("k")
	p.BaseURL = "http://127.0.0.1:1"   // заведомо закрытый порт
	p.client.Timeout = 500 * 1_000_000 // 500ms

	_, err := p.Transcribe(context.Background(), domain.TranscribeInput{Audio: []byte{0, 1}})
	if !errors.Is(err, domain.ErrProviderUnavailable) {
		t.Errorf("want ErrProviderUnavailable, got %v", err)
	}
}

// TestGroqProvider_Name — lint на stable identifier. Меняя — ломаем логи/
// метрики, так что фиксируем тестом.
func TestGroqProvider_Name(t *testing.T) {
	p := NewGroqProvider("k")
	if p.Name() != "groq" {
		t.Errorf("Name() = %q, want 'groq'", p.Name())
	}
}
