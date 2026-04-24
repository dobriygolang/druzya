package extractor

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"druz9/documents/domain"
)

// ExtractDOCX pulls plain text out of a .docx file. DOCX is a zip
// archive containing `word/document.xml`; we open the zip, find that
// one entry, and walk its XML tree — all standard-library, no third-
// party dep.
//
// We emit one newline per <w:p> (paragraph) boundary and concatenate
// text from all <w:t> runs within. This drops formatting (bold,
// headings, tables) but preserves reading order — sufficient for RAG
// over CVs/JDs/notes. Tables become linearized rows, which is honest
// for embeddings even if visually flattened.
func ExtractDOCX(content []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("%w: not a zip/docx: %v", domain.ErrUnsupportedMIME, err)
	}

	var doc *zip.File
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			doc = f
			break
		}
	}
	if doc == nil {
		return "", fmt.Errorf("%w: word/document.xml not found in zip", domain.ErrUnsupportedMIME)
	}

	rc, err := doc.Open()
	if err != nil {
		return "", fmt.Errorf("open document.xml: %w", err)
	}
	defer rc.Close()

	// 10MB hard cap on the uncompressed document body to match the
	// per-file upload cap; a zip bomb that inflates past this gets
	// truncated rather than OOM'ing us.
	data, err := io.ReadAll(io.LimitReader(rc, 10*1024*1024))
	if err != nil {
		return "", fmt.Errorf("read document.xml: %w", err)
	}

	text, err := parseDocxBody(data)
	if err != nil {
		return "", fmt.Errorf("parse document.xml: %w", err)
	}
	if !utf8.Valid([]byte(text)) {
		return "", fmt.Errorf("%w: docx text is not utf-8", domain.ErrUnsupportedMIME)
	}
	cleaned := normalizeWhitespace(text)
	if strings.TrimSpace(cleaned) == "" {
		return "", domain.ErrEmptyContent
	}
	return cleaned, nil
}

// parseDocxBody walks the XML token-by-token. We need token-level
// walking (not Unmarshal) because <w:t> and <w:p> are interleaved
// through a deep tree we don't want to model with structs. Namespaces
// carry a "w" alias; we match on Local name only (robust to variations
// in xmlns prefix).
func parseDocxBody(data []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	// Loosen the decoder: some DOCX writers emit characters outside
	// strict-XML. Defaulting Entity/CharsetReader keeps UTF-8 as-is.
	dec.Strict = false

	var b strings.Builder
	b.Grow(len(data) / 3)

	// We append a newline when we leave a <w:p>. Tracking depth is not
	// needed — paragraphs are not nested in DOCX (nested content goes
	// inside <w:tbl> rows which ALSO close via </w:p>).
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("xml token: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				// <w:t> contains character data for a run.
				var s string
				if err := dec.DecodeElement(&s, &t); err != nil {
					return "", fmt.Errorf("decode w:t: %w", err)
				}
				b.WriteString(s)
			case "tab":
				// <w:tab/> — a tab stop inside a run. Represent as
				// a space so chunker doesn't fuse adjacent words.
				b.WriteByte(' ')
			case "br":
				// <w:br/> — explicit line break.
				b.WriteByte('\n')
			}
		case xml.EndElement:
			if t.Name.Local == "p" {
				b.WriteByte('\n')
			}
		}
	}
	return b.String(), nil
}
