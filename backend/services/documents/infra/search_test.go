package infra

import (
	"math"
	"testing"

	"druz9/documents/domain"

	"github.com/google/uuid"
)

// TestCosineTopK_Ordering — базовый acceptance test: ближайший вектор
// приходит первым, дальний — последним. Всё построено на L2-normalized
// единичных векторах, чтобы dot product совпадал с cosine.
func TestCosineTopK_Ordering(t *testing.T) {
	// Три 2D-вектора:
	//   a ≈ query (cos ≈ 1)
	//   b повёрнут на 45° (cos ≈ 0.707)
	//   c противоположный (cos = -1)
	query := []float32{1, 0}
	chunks := []domain.Chunk{
		{ID: uuid.New(), Ord: 2, Content: "b", Embedding: []float32{float32(math.Sqrt2) / 2, float32(math.Sqrt2) / 2}},
		{ID: uuid.New(), Ord: 1, Content: "a", Embedding: []float32{1, 0}},
		{ID: uuid.New(), Ord: 3, Content: "c", Embedding: []float32{-1, 0}},
	}
	hits := CosineTopK(query, chunks, 3)
	if len(hits) != 3 {
		t.Fatalf("want 3 hits, got %d", len(hits))
	}
	if hits[0].Chunk.Content != "a" {
		t.Errorf("top[0] = %q, want a", hits[0].Chunk.Content)
	}
	if hits[1].Chunk.Content != "b" {
		t.Errorf("top[1] = %q, want b", hits[1].Chunk.Content)
	}
	if hits[2].Chunk.Content != "c" {
		t.Errorf("top[2] = %q, want c", hits[2].Chunk.Content)
	}
}

// TestCosineTopK_ClampK — k больше длины chunks → возвращаем все (без
// паники). k ≤ 0 или пустой chunks → nil. Проверяем оба крайних случая
// — ошибки в индексации на этом шаге = out-of-range в пром.
func TestCosineTopK_ClampK(t *testing.T) {
	query := []float32{1, 0}
	chunks := []domain.Chunk{
		{ID: uuid.New(), Content: "a", Embedding: []float32{1, 0}},
		{ID: uuid.New(), Content: "b", Embedding: []float32{0, 1}},
	}

	// k > len — возвращаем все.
	if got := CosineTopK(query, chunks, 10); len(got) != 2 {
		t.Errorf("k=10 on 2 chunks: want 2 hits, got %d", len(got))
	}
	// k = 0 — nil.
	if got := CosineTopK(query, chunks, 0); got != nil {
		t.Errorf("k=0: want nil, got %v", got)
	}
	// Пустой chunks — nil.
	if got := CosineTopK(query, []domain.Chunk{}, 5); got != nil {
		t.Errorf("empty chunks: want nil, got %v", got)
	}
}

// TestCosineTopK_SkipsWrongDim — чанки с несовпадающей размерностью
// embedding (теоретически невозможно из-за CHECK на вставке, но
// защита-от-данных) должны ПРОПУСКАТЬСЯ, а не паниковать в dot().
func TestCosineTopK_SkipsWrongDim(t *testing.T) {
	query := []float32{1, 0, 0}
	chunks := []domain.Chunk{
		{ID: uuid.New(), Content: "good", Embedding: []float32{1, 0, 0}},
		{ID: uuid.New(), Content: "bad", Embedding: []float32{1, 0}}, // wrong dim
	}
	hits := CosineTopK(query, chunks, 5)
	if len(hits) != 1 || hits[0].Chunk.Content != "good" {
		t.Errorf("want only 'good' hit, got %v", hits)
	}
}

// TestCosineTopK_StableSort — при одинаковом score порядок не должен
// «плясать» между вызовами. Go sort.Slice не стабилен, но для сравнимо-
// равных элементов практически даёт предсказуемый результат. Этот тест
// — ранняя детекция если мы когда-нибудь добавим рандомизацию.
func TestCosineTopK_StableSort(t *testing.T) {
	query := []float32{1, 0}
	chunks := []domain.Chunk{
		{ID: uuid.MustParse("00000000-0000-0000-0000-000000000001"), Content: "x", Embedding: []float32{1, 0}},
		{ID: uuid.MustParse("00000000-0000-0000-0000-000000000002"), Content: "y", Embedding: []float32{1, 0}},
	}
	first := CosineTopK(query, chunks, 2)
	second := CosineTopK(query, chunks, 2)
	for i := range first {
		if first[i].Chunk.ID != second[i].Chunk.ID {
			t.Errorf("pos %d id differs between calls: %s vs %s",
				i, first[i].Chunk.ID, second[i].Chunk.ID)
		}
	}
}
