package infra

import (
	"strings"
	"unicode"
)

// SentenceChunker splits text into overlapping sentence windows. Budget
// and overlap are measured in approximate-tokens (~= words); we use a
// word count instead of a real tokenizer because bge-small's sub-word
// split is within ~15% of word count for English/Russian prose, and the
// error tolerates comfortably within a chunk-size budget.
//
// Why sentence granularity:
//   - chunks align with semantic boundaries (no mid-sentence cuts that
//     fragment phrase embeddings);
//   - overlap preserves cross-sentence coref ("the company … it …");
//   - deterministic — same input always splits the same way, which matters
//     for idempotent re-ingest after a failed embed run.
//
// Anti-features we deliberately don't add: paragraph detection, code-block
// awareness, Markdown heading boosts. Those belong in format-specific
// pre-processors (extractor layer), not the generic chunker.
type SentenceChunker struct {
	// TargetTokens: aim for ~this many tokens per chunk.
	TargetTokens int
	// OverlapTokens: previous chunk's tail re-appears at the next chunk's
	// head, up to this budget. 0 disables overlap.
	OverlapTokens int
	// MaxTokens: hard ceiling. A single sentence longer than this gets
	// word-split to fit. Guards against legal boilerplate / long URL runs.
	MaxTokens int
}

// DefaultChunker returns a Chunker tuned for bge-small-en (512 ctx).
// 400/50/600 tokens fits comfortably, leaves headroom for system-prompt
// framing when chunks get concatenated into a RAG prompt.
func DefaultChunker() *SentenceChunker {
	return &SentenceChunker{
		TargetTokens:  400,
		OverlapTokens: 50,
		MaxTokens:     600,
	}
}

// Chunk implements domain.Chunker. Never returns nil; an empty input yields
// an empty slice (caller short-circuits before embedding).
func (c *SentenceChunker) Chunk(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return []string{}
	}
	sentences := splitSentences(text)
	if len(sentences) == 0 {
		return []string{}
	}

	out := make([]string, 0, 1+len(sentences)/4)
	var (
		curr       strings.Builder
		currTokens int
	)

	flush := func() {
		if currTokens == 0 {
			return
		}
		out = append(out, strings.TrimSpace(curr.String()))
		curr.Reset()
		currTokens = 0
	}

	for _, s := range sentences {
		stoks := approxTokens(s)
		// A single sentence that overflows the hard ceiling gets word-split
		// in place. This is rare (prose averages ~20 tokens/sentence) but
		// happens with tables flattened to a single line, or URL-heavy
		// footnotes. Cutting mid-sentence is ugly but better than OOM'ing
		// the embedder context.
		if stoks > c.MaxTokens {
			flush()
			out = append(out, splitLongSentence(s, c.MaxTokens)...)
			continue
		}

		// Close the current chunk before it would exceed the target —
		// target is the soft aim, Max is the hard cap. Aiming below target
		// on the far side of a sentence boundary trades slightly more
		// chunks for cleaner semantic cuts.
		if currTokens > 0 && currTokens+stoks > c.TargetTokens {
			flush()
		}

		if curr.Len() > 0 {
			curr.WriteByte(' ')
		}
		curr.WriteString(s)
		currTokens += stoks
	}
	flush()

	if c.OverlapTokens > 0 && len(out) > 1 {
		out = applyOverlap(out, c.OverlapTokens)
	}
	return out
}

// approxTokens approximates bge-small's tokenization by counting words.
// Real tokenization is sub-word (BPE), but for budgeting purposes words
// under-approximate by ~10-15% which keeps us safely below the hard
// model context (512). We don't need exactness, just a stable budget.
func approxTokens(s string) int {
	n := 0
	inWord := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			inWord = false
			continue
		}
		if !inWord {
			n++
			inWord = true
		}
	}
	return n
}

// splitSentences is a deliberately-simple terminal-punctuation splitter.
// It's NOT a full NLP segmenter: "Dr. Smith" will over-split at "Dr." and
// "5.3" will over-split at the dot. We accept this because:
//   - both over-splits produce smaller chunks which is strictly safe
//     (embedding more granular units doesn't hurt recall);
//   - bringing in a full segmenter (spaCy / udpipe) is a dep war we're
//     not ready for, and pretrained models bloat the binary by 100MB+.
func splitSentences(text string) []string {
	// Normalize whitespace once so downstream doesn't have to.
	var b strings.Builder
	b.Grow(len(text))
	prevSpace := false
	for _, r := range text {
		if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	normalized := strings.TrimSpace(b.String())

	out := make([]string, 0, 16)
	var cur strings.Builder
	runes := []rune(normalized)
	for i, r := range runes {
		cur.WriteRune(r)
		if r == '.' || r == '!' || r == '?' || r == '。' {
			// Look ahead for a space-or-end; swallow the space and emit.
			if i+1 >= len(runes) || unicode.IsSpace(runes[i+1]) {
				s := strings.TrimSpace(cur.String())
				if s != "" {
					out = append(out, s)
				}
				cur.Reset()
			}
		}
	}
	tail := strings.TrimSpace(cur.String())
	if tail != "" {
		out = append(out, tail)
	}
	return out
}

// splitLongSentence cuts a single very-long sentence into word-spans that
// each fit within maxTokens. Last span may be shorter.
func splitLongSentence(s string, maxTokens int) []string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return nil
	}
	out := make([]string, 0, (len(words)/maxTokens)+1)
	for i := 0; i < len(words); i += maxTokens {
		end := i + maxTokens
		if end > len(words) {
			end = len(words)
		}
		out = append(out, strings.Join(words[i:end], " "))
	}
	return out
}

// applyOverlap rewrites chunks[i] (i > 0) to prepend the tail of
// chunks[i-1] up to `overlapTokens`. Tail selection is word-based so the
// prepended text is always a prefix-align-able slice of the previous
// chunk — never cuts a word mid-way.
func applyOverlap(chunks []string, overlapTokens int) []string {
	for i := 1; i < len(chunks); i++ {
		prevWords := strings.Fields(chunks[i-1])
		start := len(prevWords) - overlapTokens
		if start < 0 {
			start = 0
		}
		if start == len(prevWords) {
			continue
		}
		prefix := strings.Join(prevWords[start:], " ")
		chunks[i] = prefix + " " + chunks[i]
	}
	return chunks
}
