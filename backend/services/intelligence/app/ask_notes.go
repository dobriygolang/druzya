package app

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// TopK — сколько нот включаем в RAG-context. 8 — sweet spot между
// глубиной охвата (помогает на размытых запросах) и токен-стоимостью
// (8 × ~600 chars ~ 5KB context).
const TopK = 8

// CitationRefRe — парсер цитаций «[1]», «[2,3]», «[4-5]» в LLM-ответе.
// Captures группа — числовой контент внутри скобок.
var CitationRefRe = regexp.MustCompile(`\[(\d+(?:[,\-\s]+\d+)*)\]`)

// AskNotes — use case для AskNotes RPC.
type AskNotes struct {
	Notes    domain.NotesReader
	Embedder domain.Embedder
	Answerer domain.NoteAnswerer
	Log      *slog.Logger
}

// AskNotesInput — параметры use case'а.
type AskNotesInput struct {
	UserID   uuid.UUID
	Question string
}

// Do executes the RAG flow:
//
//  1. embed(question) → vector
//  2. cosine(vector, corpus) → top-K
//  3. answerer.Answer(question, top-K) → markdown с [N]-цитациями
//  4. parse [N] → []Citation
//
// Empty corpus → пустой ответ-helper, не error: «You have no notes yet».
// Корпус без embedding'ов (новый юзер) — тот же fallback. Anti-fallback
// здесь СОЗНАТЕЛЬНО смягчён: «no data» — не системная ошибка, это
// валидное состояние пустого корпуса.
func (uc *AskNotes) Do(ctx context.Context, in AskNotesInput) (domain.AskAnswer, error) {
	q := strings.TrimSpace(in.Question)
	if q == "" {
		return domain.AskAnswer{}, fmt.Errorf("intelligence.AskNotes.Do: %w: empty question", domain.ErrInvalidInput)
	}

	qVec, _, err := uc.Embedder.Embed(ctx, q)
	if err != nil {
		return domain.AskAnswer{}, fmt.Errorf("intelligence.AskNotes.Do: embed question: %w", err)
	}

	corpus, err := uc.Notes.EmbeddedCorpus(ctx, in.UserID)
	if err != nil {
		return domain.AskAnswer{}, fmt.Errorf("intelligence.AskNotes.Do: corpus: %w", err)
	}
	if len(corpus) == 0 {
		return domain.AskAnswer{
			AnswerMD:  "You have no embedded notes yet. Try saving a few notes — when they're indexed, I'll be able to answer questions about them.",
			Citations: nil,
		}, nil
	}

	type scored struct {
		n   domain.NoteEmbedding
		sim float32
	}
	ranked := make([]scored, 0, len(corpus))
	for _, c := range corpus {
		sim := cosine(qVec, c.Embedding)
		ranked = append(ranked, scored{n: c, sim: sim})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].sim > ranked[j].sim })
	if len(ranked) > TopK {
		ranked = ranked[:TopK]
	}

	contextNotes := make([]domain.NoteEmbedding, 0, len(ranked))
	for _, r := range ranked {
		contextNotes = append(contextNotes, r.n)
	}

	answer, err := uc.Answerer.Answer(ctx, q, contextNotes)
	if err != nil {
		return domain.AskAnswer{}, fmt.Errorf("intelligence.AskNotes.Do: answer: %w", err)
	}

	citations := parseCitations(answer, contextNotes)
	return domain.AskAnswer{AnswerMD: answer, Citations: citations}, nil
}

// parseCitations walks the answer for [N] markers and resolves them to
// the corresponding entry in contextNotes (1-indexed). Duplicates dedup'd
// in order of first appearance. Out-of-range indices silently dropped —
// the LLM occasionally invents a [9] when only 8 notes are passed in.
func parseCitations(answer string, ctxNotes []domain.NoteEmbedding) []domain.Citation {
	matches := CitationRefRe.FindAllStringSubmatch(answer, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[int]bool, len(matches))
	out := make([]domain.Citation, 0, len(matches))
	for _, m := range matches {
		// m[1] like "1" or "1,2" or "1-3". Extract every integer.
		parts := splitRefs(m[1])
		for _, p := range parts {
			n, err := strconv.Atoi(p)
			if err != nil {
				continue
			}
			if n < 1 || n > len(ctxNotes) {
				continue
			}
			if seen[n] {
				continue
			}
			seen[n] = true
			note := ctxNotes[n-1]
			out = append(out, domain.Citation{
				NoteID:  note.NoteID,
				Title:   note.Title,
				Snippet: note.Snippet,
			})
		}
	}
	return out
}

// splitRefs splits "1,2" / "1-3" / "1, 2" into individual numeric tokens.
// Range "a-b" becomes [a, b] (we don't expand — citations referencing a
// range typically mean both endpoints are relevant; intermediate ones
// would be a separate citation if the model meant them).
func splitRefs(s string) []string {
	out := make([]string, 0, 4)
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == '-' || r == ' '
	}) {
		tok = strings.TrimSpace(tok)
		if tok != "" {
			out = append(out, tok)
		}
	}
	return out
}

// cosine returns cosine similarity. Mirror of hone.app.cosine — kept
// here to avoid an inter-service domain import.
func cosine(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}
