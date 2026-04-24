package extractor

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/documents/domain"
)

// TestTextExtractor_Plain — text/plain с разными charset-суффиксами.
// Проверяем, что парсер MIME игнорирует "; charset=…" и не требует
// конкретного регистра.
func TestTextExtractor_Plain(t *testing.T) {
	e := NewTextExtractor()
	cases := []struct {
		mime    string
		content string
		want    string
	}{
		{"text/plain", "Hello world", "Hello world"},
		{"text/plain; charset=UTF-8", "Привет", "Привет"},
		{"Text/Plain", "caseinsensitive", "caseinsensitive"},
		{"text/markdown", "# Heading\nbody", "# Heading\nbody"},
	}
	for _, c := range cases {
		got, err := e.Extract(context.Background(), c.mime, []byte(c.content))
		if err != nil {
			t.Errorf("mime=%q: unexpected err %v", c.mime, err)
			continue
		}
		if got != c.want {
			t.Errorf("mime=%q: got %q, want %q", c.mime, got, c.want)
		}
	}
}

// TestTextExtractor_Empty — пустой whitespace-only контент → ErrEmptyContent,
// не «молчаливо возвращаем пусто». Это gatekeeper для загрузок, где
// файл есть, но содержательного текста нет.
func TestTextExtractor_Empty(t *testing.T) {
	e := NewTextExtractor()
	_, err := e.Extract(context.Background(), "text/plain", []byte("   \n\t  "))
	if !errors.Is(err, domain.ErrEmptyContent) {
		t.Errorf("whitespace-only: want ErrEmptyContent, got %v", err)
	}
}

// TestTextExtractor_InvalidUTF8 — байты, которые не являются UTF-8,
// должны отклоняться с ErrUnsupportedMIME. Иначе embedder получит
// мусор и вернёт шумный вектор.
func TestTextExtractor_InvalidUTF8(t *testing.T) {
	e := NewTextExtractor()
	bad := []byte{0xff, 0xfe, 0xfd} // invalid UTF-8 BOM-ish prefix
	_, err := e.Extract(context.Background(), "text/plain", bad)
	if !errors.Is(err, domain.ErrUnsupportedMIME) {
		t.Errorf("invalid utf-8: want ErrUnsupportedMIME, got %v", err)
	}
}

// TestTextExtractor_UnknownMIME — не-обрабатываемые типы → ошибка, а
// не «а-ля пытаемся распарсить как plain». Это контракт — handler
// мапит в 415.
func TestTextExtractor_UnknownMIME(t *testing.T) {
	e := NewTextExtractor()
	cases := []string{
		"image/png",
		"application/zip",
		"application/octet-stream",
		"",
	}
	for _, m := range cases {
		_, err := e.Extract(context.Background(), m, []byte("anything"))
		if !errors.Is(err, domain.ErrUnsupportedMIME) {
			t.Errorf("mime=%q: want ErrUnsupportedMIME, got %v", m, err)
		}
	}
}

// TestTextExtractor_HTML_StripsTags — базовый HTML: теги уходят, текст
// остаётся, пробелы вокруг тегов нормализуются в одиночные.
func TestTextExtractor_HTML_StripsTags(t *testing.T) {
	e := NewTextExtractor()
	html := `<html><body><h1>Title</h1><p>Hello <b>world</b>!</p></body></html>`
	got, err := e.Extract(context.Background(), "text/html", []byte(html))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// После нормализации ожидаем plain "Title Hello world !" или близко.
	if !strings.Contains(got, "Title") || !strings.Contains(got, "Hello") || !strings.Contains(got, "world") {
		t.Errorf("expected Title/Hello/world in output, got %q", got)
	}
	// Теги не должны просочиться.
	if strings.ContainsAny(got, "<>") {
		t.Errorf("leaked angle brackets: %q", got)
	}
}

// TestTextExtractor_HTML_ScriptStyleDropped — <script>/<style> с их
// содержимым должны ВЫБРАСЫВАТЬСЯ: код/CSS для RAG бесполезны и
// сбивают embedding.
func TestTextExtractor_HTML_ScriptStyleDropped(t *testing.T) {
	e := NewTextExtractor()
	html := `<html><head><script>alert('xss');</script><style>body{color:red}</style></head>
<body>Visible content</body></html>`
	got, err := e.Extract(context.Background(), "text/html", []byte(html))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got, "Visible content") {
		t.Errorf("visible content missing: %q", got)
	}
	if strings.Contains(got, "alert") {
		t.Errorf("script content leaked: %q", got)
	}
	if strings.Contains(got, "color:red") {
		t.Errorf("style content leaked: %q", got)
	}
}

// TestNormalizeMIME — чистый unit-test на хелпер. Если regression
// слипает charset в ключ, switch будет падать на browser-side cases.
func TestNormalizeMIME(t *testing.T) {
	cases := map[string]string{
		"text/plain":                 "text/plain",
		"Text/HTML; charset=utf-8":   "text/html",
		"  application/pdf  ":        "application/pdf",
		"":                           "",
		"text/plain ; charset=utf-8": "text/plain",
	}
	for in, want := range cases {
		if got := normalizeMIME(in); got != want {
			t.Errorf("normalizeMIME(%q) = %q, want %q", in, got, want)
		}
	}
}
