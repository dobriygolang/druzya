// Package extractor converts uploaded file bytes into plain text for
// chunking. Each format is a small self-contained piece; the dispatcher
// in TextExtractor routes by MIME type.
//
// MVP scope: text/plain, text/markdown, text/html. PDF/DOCX/URL-fetch
// land in follow-up sessions — they need third-party libs (unipdf,
// unioffice, go-readability) whose licensing and binary-bloat tradeoffs
// deserve their own review.
package extractor

import (
	"context"
	"strings"
	"unicode"
	"unicode/utf8"

	"druz9/documents/domain"
)

// TextExtractor dispatches extraction based on MIME. Zero value is usable;
// register additional formats by composition (wrap this and delegate for
// unknown types) — that's cleaner than an options-bag on a single struct.
type TextExtractor struct{}

// NewTextExtractor is provided for symmetry with other packages; the zero
// value is fine, but New*() is the established style in this codebase.
func NewTextExtractor() *TextExtractor { return &TextExtractor{} }

// Extract implements domain.Extractor.
func (e *TextExtractor) Extract(_ context.Context, mime string, content []byte) (string, error) {
	m := normalizeMIME(mime)
	switch {
	case m == "text/plain", m == "text/markdown", strings.HasPrefix(m, "text/plain;"):
		return extractPlain(content)
	case m == "text/html", strings.HasPrefix(m, "text/html;"):
		return extractHTML(content)
	case m == "application/pdf":
		return ExtractPDF(content)
	case m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		m == "application/msword":
		// application/msword is the legacy .doc type. We route it here
		// because some browsers mislabel .docx as application/msword;
		// the ExtractDOCX path sniffs the zip magic and rejects real
		// .doc files (OLE compound) with ErrUnsupportedMIME.
		return ExtractDOCX(content)
	default:
		return "", domain.ErrUnsupportedMIME
	}
}

// normalizeMIME strips "; charset=..." and lowercases — browsers and
// `file -i` output vary wildly, and routing on the primary type avoids a
// lookup table of every permutation.
func normalizeMIME(mime string) string {
	mime = strings.ToLower(strings.TrimSpace(mime))
	if i := strings.IndexByte(mime, ';'); i >= 0 {
		return strings.TrimSpace(mime[:i])
	}
	return mime
}

// extractPlain validates UTF-8 and returns the content as-is. We don't
// try to auto-detect encodings (Windows-1251, GB18030, etc.): that's an
// import-side concern handled by the client before upload. Invalid UTF-8
// is treated as a hard error — better a clear 400 than silently embedding
// garbage bytes.
func extractPlain(content []byte) (string, error) {
	if !utf8.Valid(content) {
		return "", domain.ErrUnsupportedMIME
	}
	s := string(content)
	if strings.TrimSpace(s) == "" {
		return "", domain.ErrEmptyContent
	}
	return s, nil
}

// extractHTML strips tags and collapses whitespace. This is intentionally
// naive — no DOM parsing, no <script>/<style> exclusion beyond the
// tag-strip sweep. For well-formed HTML this handles the common case;
// for adversarial inputs (obfuscated script, CSS-injected text) we don't
// care because embeddings on noisy text are just low-signal, not unsafe.
//
// Upgrade path: when URL ingestion lands we'll adopt go-readability or
// goquery-based extraction to pull main-content only. Until then, this
// is adequate for `<textarea>`-pasted HTML fragments.
func extractHTML(content []byte) (string, error) {
	if !utf8.Valid(content) {
		return "", domain.ErrUnsupportedMIME
	}

	// Drop <script> and <style> blocks wholesale — their contents are
	// meaningless for RAG and can confuse the embedder.
	cleaned := stripBlocks(string(content), "script", "style")

	var b strings.Builder
	b.Grow(len(cleaned))
	inTag := false
	prevSpace := false
	for _, r := range cleaned {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
			// Collapse the tag boundary into a single space so inline
			// elements don't glue neighboring words together.
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		case inTag:
			// Inside a tag — discard.
		case unicode.IsSpace(r):
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		default:
			b.WriteRune(r)
			prevSpace = false
		}
	}
	text := strings.TrimSpace(b.String())
	if text == "" {
		return "", domain.ErrEmptyContent
	}
	return text, nil
}

// stripBlocks removes <tag>…</tag> spans case-insensitively. A conservative
// implementation — we don't attempt to handle deeply nested same-named
// tags (which are invalid HTML anyway).
func stripBlocks(s string, tags ...string) string {
	lower := strings.ToLower(s)
	for _, t := range tags {
		open := "<" + t
		close := "</" + t + ">"
		for {
			start := strings.Index(lower, open)
			if start < 0 {
				break
			}
			end := strings.Index(lower[start:], close)
			if end < 0 {
				// Unclosed block — drop to the end of the document.
				s = s[:start]
				lower = lower[:start]
				break
			}
			end = start + end + len(close)
			s = s[:start] + s[end:]
			lower = lower[:start] + lower[end:]
		}
	}
	return s
}

// Guard: TextExtractor satisfies the interface.
var _ domain.Extractor = (*TextExtractor)(nil)
