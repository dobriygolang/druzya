package app

import (
	"context"
	"strings"

	"druz9/copilot/domain"
)

// defaultRAGTopK caps RAG injection hits. Higher values dilute signal
// (more irrelevant context) and inflate input tokens.
const defaultRAGTopK = 5

// minRAGPromptChars filters image-only "what is this?" turns: embedding
// an empty/near-empty prompt yields a near-uniform vector and top-K hits
// are effectively random.
const minRAGPromptChars = 3

// buildDocsContext runs the searcher and formats the hits into a single
// system-message payload. Returns "" (no block at all) for any reason to
// skip — missing searcher, no session, no docs, empty prompt, or a
// transient search failure. Search errors are swallowed rather than
// blocking the turn; RAG is a boost, not a gate.
func (uc *Analyze) buildDocsContext(ctx context.Context, haveLive bool, session domain.Session, prompt string) string {
	if uc.DocSearcher == nil || !haveLive || len(session.DocumentIDs) == 0 {
		return ""
	}
	trimmed := strings.TrimSpace(prompt)
	if len(trimmed) < minRAGPromptChars {
		return ""
	}
	topK := uc.RAGTopK
	if topK <= 0 {
		topK = defaultRAGTopK
	}
	hits, err := uc.DocSearcher.SearchForSession(ctx, session.UserID, session.DocumentIDs, trimmed, topK)
	if err != nil {
		if uc.Log != nil {
			uc.Log.Warn("copilot.Analyze: RAG search failed — continuing without context",
				"err", err, "user", session.UserID, "session", session.ID, "docs", len(session.DocumentIDs))
		}
		return ""
	}
	if len(hits) == 0 {
		return ""
	}

	// Delimiters mark content as UNTRUSTED data — see systemPrompt.
	// Each hit gets its own <<<USER_DOC label=...>>> block so the
	// LLM can cite the source and won't confuse two docs with each
	// other. Labels are sanitised (strip the delimiter literal in
	// case an adversarial filename contains it).
	var b strings.Builder
	b.WriteString("Relevant excerpts from the user's attached documents. Use them when they inform the answer; cite the source label in parentheses when you quote.\n\n")
	for i, h := range hits {
		if i > 0 {
			b.WriteString("\n")
		}
		label := sanitizeLabel(h.SourceLabel)
		b.WriteString("<<<USER_DOC label=\"")
		b.WriteString(label)
		b.WriteString("\">>>\n")
		b.WriteString(sanitizeDocContent(h.Content))
		b.WriteString("\n<<</USER_DOC>>>\n")
	}
	return b.String()
}

// sanitizeLabel strips characters that would let an attacker break
// out of the attribute value or fake a delimiter. Labels are the
// filename or title — 99% of real ones are plain text; a user who
// uploads `file-<<</USER_DOC>>>.pdf` gets neutralised here.
func sanitizeLabel(s string) string {
	s = strings.ReplaceAll(s, "<<<", "<<")
	s = strings.ReplaceAll(s, ">>>", ">>")
	s = strings.ReplaceAll(s, "\"", "'")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	const maxLabelLen = 120
	if len(s) > maxLabelLen {
		s = s[:maxLabelLen] + "…"
	}
	return s
}

// sanitizeDocContent defangs our own delimiter literals so a chunk
// whose text happens to contain `<<<USER_DOC>>>` can't forge a new
// boundary and poison the LLM's reading of the block structure.
// We replace with the same string minus one angle so the text reads
// naturally but the parser (both LLM-attention and any future
// regex-based tool) sees distinct tokens.
func sanitizeDocContent(s string) string {
	s = strings.ReplaceAll(s, "<<<USER_DOC", "<<USER_DOC")
	s = strings.ReplaceAll(s, "<<</USER_DOC>>>", "<</USER_DOC>>")
	return s
}
