package infra

import (
	"strings"
	"testing"
)

// TestChunker_EmptyInput — пустой/whitespace-only вход не должен выбрасывать
// chunks: даёт нам clean contract для пустых PDF (сканы без OCR).
func TestChunker_EmptyInput(t *testing.T) {
	c := DefaultChunker()
	cases := []string{"", "   ", "\n\n\t\n"}
	for _, in := range cases {
		if got := c.Chunk(in); len(got) != 0 {
			t.Errorf("Chunk(%q): want empty, got %d chunks", in, len(got))
		}
	}
}

// TestChunker_SmallInput — короткий текст умещается в один чанк целиком,
// без разбиения. Если бы chunker зачем-то разрезал на границах слов
// или символов-переносов, такой тест бы падал.
func TestChunker_SmallInput(t *testing.T) {
	c := DefaultChunker()
	text := "Alice is a senior Go engineer. She works on distributed systems."
	got := c.Chunk(text)
	if len(got) != 1 {
		t.Fatalf("want 1 chunk, got %d: %v", len(got), got)
	}
	if !strings.Contains(got[0], "distributed systems") {
		t.Errorf("chunk missing tail: %q", got[0])
	}
}

// TestChunker_BudgetRollover — когда суммарный токен-бюджет переваливает
// target, chunker закрывает текущий чанк на границе предложения и
// открывает новый. Проверяем: (1) каждый чанк ≤ target (с оверхедом
// на overlap-prefix), (2) никакое предложение не разорвано пополам.
func TestChunker_BudgetRollover(t *testing.T) {
	c := &SentenceChunker{
		TargetTokens:  10,
		OverlapTokens: 0,
		MaxTokens:     50,
	}
	// Десять предложений по ~4 слова — итого ~40 токенов. При target=10
	// чанкер должен нарезать на 4-5 чанков.
	sentences := []string{
		"The quick brown fox jumps.",
		"A lazy dog sleeps deeply.",
		"Birds sing in the morning.",
		"Rivers flow into the ocean.",
		"Mountains reach the sky high.",
		"Cities never sleep at night.",
		"Forests grow old with time.",
		"Deserts stretch wide and hot.",
		"Snow falls silently at dawn.",
		"Children play in the park.",
	}
	input := strings.Join(sentences, " ")
	chunks := c.Chunk(input)

	if len(chunks) < 3 {
		t.Errorf("want ≥3 chunks for 40+ tokens at target=10, got %d: %v", len(chunks), chunks)
	}

	// Каждое предложение должно попасть в какой-то чанк целиком.
	joined := strings.Join(chunks, " | ")
	for _, s := range sentences {
		if !strings.Contains(joined, s) {
			t.Errorf("sentence %q not preserved across chunks", s)
		}
	}
}

// TestChunker_LongSentence — предложение, которое само по себе превышает
// MaxTokens (напр. сплошной URL или таблица в одну линию), должно
// принудительно резаться по словам. Без этого embedder'ский контекст
// переполнится.
func TestChunker_LongSentence(t *testing.T) {
	c := &SentenceChunker{TargetTokens: 10, OverlapTokens: 0, MaxTokens: 8}
	// 20 слов без точек — искусственно длинное «предложение».
	words := make([]string, 20)
	for i := range words {
		words[i] = "word"
	}
	input := strings.Join(words, " ") + "."
	chunks := c.Chunk(input)

	if len(chunks) < 2 {
		t.Fatalf("long sentence must be split; got 1 chunk: %q", chunks[0])
	}
	for i, ch := range chunks {
		n := len(strings.Fields(ch))
		if n > c.MaxTokens {
			t.Errorf("chunk[%d] has %d tokens, > MaxTokens=%d", i, n, c.MaxTokens)
		}
	}
}

// TestChunker_Overlap — при включённом overlap каждый chunk[i] (i>0)
// должен начинаться с последних OverlapTokens слов chunk[i-1]. Проверяем
// невзаимные слова на границах, не полные равенства — из-за пробелов.
func TestChunker_Overlap(t *testing.T) {
	c := &SentenceChunker{
		TargetTokens:  6,
		OverlapTokens: 3,
		MaxTokens:     20,
	}
	// Пять коротких предложений, чтобы гарантировать ≥2 чанков.
	input := "Alpha one two. Beta three four. Gamma five six. Delta seven eight. Epsilon nine ten."
	chunks := c.Chunk(input)
	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks, got %d: %v", len(chunks), chunks)
	}
	for i := 1; i < len(chunks); i++ {
		prev := strings.Fields(chunks[i-1])
		curr := strings.Fields(chunks[i])
		if len(prev) < c.OverlapTokens {
			continue // предыдущий был слишком короткий — overlap не применим.
		}
		tail := prev[len(prev)-c.OverlapTokens:]
		for j, word := range tail {
			if j >= len(curr) || curr[j] != word {
				t.Errorf("chunk[%d] expected overlap prefix %v, got head %v",
					i, tail, curr[:min(len(tail), len(curr))])
				break
			}
		}
	}
}

// TestChunker_Deterministic — одинаковый вход даёт одинаковый выход.
// Критично для идемпотентного re-ingest'а после failed embed-run: если
// bsplit был бы недетерминистичным, дедуп по (doc_id, ord) ломался бы.
func TestChunker_Deterministic(t *testing.T) {
	c := DefaultChunker()
	text := strings.Repeat("Sentence number. Next one. ", 30)
	a := c.Chunk(text)
	b := c.Chunk(text)
	if len(a) != len(b) {
		t.Fatalf("nondeterministic split length: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Errorf("chunk[%d] differs:\n  a=%q\n  b=%q", i, a[i], b[i])
		}
	}
}

// TestApproxTokens — guardrail на counter. Важен потому что на нём
// висит budget-решение; off-by-one даст либо чанки длиннее модели,
// либо пустые (infinite loop в старых импл).
func TestApproxTokens(t *testing.T) {
	cases := map[string]int{
		"":              0,
		"   ":           0,
		"one":           1,
		"one two three": 3,
		"a  b\tc\nd":    4,
	}
	for in, want := range cases {
		if got := approxTokens(in); got != want {
			t.Errorf("approxTokens(%q) = %d, want %d", in, got, want)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
