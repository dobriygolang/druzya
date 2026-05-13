// Tests для LLM-backed action item extractor.
//
// Pure parsing tests + scripted-chain integration test:
//   - Happy path (JSON парсится, note_id mapping работает).
//   - Code fences (```json … ```) — defensive stripping.
//   - Galled note_id (LLM выдумал) — silently dropped, не падаем.
//   - Empty title в одном из items — skipped, остальные проходят.
//   - Cap до noteActionExtractMaxSuggestions (10) когда LLM наспамил.
//   - Chain error → fail-soft caller получит обёрнутую ошибку.
//
// Не тестим: timeout / retry / температуру — это инфра llmchain'а
// (отдельные тесты в shared/pkg/llmchain).
package infra

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	honeApp "druz9/hone/app"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// stubChain — ChatClient mock с заранее заданным content / err.
type stubChain struct {
	content string
	err     error
	called  int
}

func (s *stubChain) Chat(_ context.Context, _ llmchain.Request) (llmchain.Response, error) {
	s.called++
	if s.err != nil {
		return llmchain.Response{}, s.err
	}
	return llmchain.Response{Content: s.content}, nil
}

func (s *stubChain) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("stubChain: ChatStream not supported")
}

// quietLogger — buffer'нутый slog для тестов, чтобы не плевать в stderr.
func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
}

func TestLLMChainNoteActionExtractor_HappyPath(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	noteB := uuid.New()
	resp := `{"suggestions":[
		{"title":"починить fix для Маши","source_note_id":"` + noteA.String() + `","source_excerpt":"todo: починить fix"},
		{"title":"ответить на письмо","source_note_id":"` + noteB.String() + `","source_excerpt":"надо ответить"}
	]}`
	chain := &stubChain{content: resp}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{
			{NoteID: noteA, Title: "Daily", Excerpt: "todo: починить fix"},
			{NoteID: noteB, Title: "Inbox", Excerpt: "надо ответить на письмо Маши"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d suggestions, want 2: %+v", len(got), got)
	}
	if got[0].Title != "починить fix для Маши" {
		t.Errorf("title[0]=%q", got[0].Title)
	}
	if got[0].SourceNoteID != noteA {
		t.Errorf("note[0]=%s want %s", got[0].SourceNoteID, noteA)
	}
	if got[1].SourceNoteID != noteB {
		t.Errorf("note[1]=%s want %s", got[1].SourceNoteID, noteB)
	}
	if chain.called != 1 {
		t.Errorf("chain.called=%d want 1", chain.called)
	}
}

func TestLLMChainNoteActionExtractor_StripsCodeFences(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	resp := "```json\n" + `{"suggestions":[{"title":"fix","source_note_id":"` + noteA.String() + `","source_excerpt":"todo: fix"}]}` + "\n```"
	chain := &stubChain{content: resp}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "todo: fix"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Title != "fix" {
		t.Fatalf("got %+v", got)
	}
}

func TestLLMChainNoteActionExtractor_DropsHallucinatedNoteID(t *testing.T) {
	t.Parallel()
	realNote := uuid.New()
	hallucinated := uuid.New()
	resp := `{"suggestions":[
		{"title":"real","source_note_id":"` + realNote.String() + `","source_excerpt":"ok"},
		{"title":"ghost","source_note_id":"` + hallucinated.String() + `","source_excerpt":"phantom"}
	]}`
	chain := &stubChain{content: resp}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: realNote, Excerpt: "todo: ok"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Title != "real" {
		t.Fatalf("expected single 'real' suggestion, got %+v", got)
	}
}

func TestLLMChainNoteActionExtractor_DropsEmptyTitle(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	resp := `{"suggestions":[
		{"title":"","source_note_id":"` + noteA.String() + `","source_excerpt":"x"},
		{"title":"  ","source_note_id":"` + noteA.String() + `","source_excerpt":"y"},
		{"title":"keep","source_note_id":"` + noteA.String() + `","source_excerpt":"z"}
	]}`
	chain := &stubChain{content: resp}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "todo: keep"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].Title != "keep" {
		t.Fatalf("expected single 'keep', got %+v", got)
	}
}

func TestLLMChainNoteActionExtractor_CapsAtMaxSuggestions(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	var b strings.Builder
	b.WriteString(`{"suggestions":[`)
	for i := 0; i < 15; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"title":"x` + string(rune('a'+i)) + `","source_note_id":"` + noteA.String() + `","source_excerpt":"e"}`)
	}
	b.WriteString(`]}`)
	chain := &stubChain{content: b.String()}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "todo: x"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != noteActionExtractMaxSuggestions {
		t.Fatalf("got %d suggestions, want cap %d", len(got), noteActionExtractMaxSuggestions)
	}
}

func TestLLMChainNoteActionExtractor_ChainError(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	chain := &stubChain{err: errors.New("provider boom")}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	_, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "todo: x"}},
	})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "provider boom") {
		t.Errorf("err=%v expected to wrap provider boom", err)
	}
}

func TestLLMChainNoteActionExtractor_ParseError(t *testing.T) {
	t.Parallel()
	noteA := uuid.New()
	chain := &stubChain{content: "not a json {"}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	_, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "todo: x"}},
	})
	if err == nil {
		t.Fatalf("expected parse error")
	}
}

func TestLLMChainNoteActionExtractor_EmptyBatchShortCircuit(t *testing.T) {
	t.Parallel()
	chain := &stubChain{content: `{"suggestions":[]}`}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{Items: nil})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty, got %+v", got)
	}
	if chain.called != 0 {
		t.Errorf("expected 0 chain calls, got %d (should short-circuit empty batch)", chain.called)
	}
}

func TestLLMChainNoteActionExtractor_FallbackExcerptWhenLLMOmits(t *testing.T) {
	t.Parallel()
	// LLM прислал empty source_excerpt — fallback на оригинал из batch'а.
	noteA := uuid.New()
	resp := `{"suggestions":[{"title":"do thing","source_note_id":"` + noteA.String() + `","source_excerpt":""}]}`
	chain := &stubChain{content: resp}
	e := NewLLMChainNoteActionExtractor(chain, quietLogger())

	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: noteA, Excerpt: "original excerpt"}},
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 1 || got[0].SourceExcerpt != "original excerpt" {
		t.Fatalf("expected fallback excerpt 'original excerpt', got %+v", got)
	}
}

func TestNoNoteActionExtractor_AlwaysEmpty(t *testing.T) {
	t.Parallel()
	e := NewNoNoteActionExtractor()
	got, err := e.Extract(context.Background(), honeApp.ExtractActionBatch{
		Items: []honeApp.NoteExcerpt{{NoteID: uuid.New(), Excerpt: "x"}},
	})
	if err != nil {
		t.Fatalf("NoNoteActionExtractor.Extract returned err: %v (must be soft-fail)", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty list, got %+v", got)
	}
}
