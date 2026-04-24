package infra

import (
	"sort"

	"druz9/documents/domain"
)

// CosineTopK returns the k chunks with highest cosine similarity against
// query. Both query and chunk embeddings MUST be L2-normalized (which
// OllamaEmbedder guarantees) — the "cosine" reduces to a dot product.
//
// Performance envelope: O(N·D) where N=len(chunks), D=embedding dim (384).
// At N=5000, D=384, pure-Go FMA we measure ~3-5ms on a laptop CPU. That's
// within the hot-path budget; if we outgrow it the upgrade path is
// pgvector + `ORDER BY embedding <=> $1` (see migration 00011 comment).
func CosineTopK(query []float32, chunks []domain.Chunk, k int) []domain.SearchHit {
	if k <= 0 || len(chunks) == 0 {
		return nil
	}
	hits := make([]domain.SearchHit, 0, len(chunks))
	for _, c := range chunks {
		// Skip chunks with a mis-sized embedding — should never happen
		// given the CHECK constraint on the column, but cheap to verify
		// and avoids a panic in dot() if it ever does.
		if len(c.Embedding) != len(query) {
			continue
		}
		hits = append(hits, domain.SearchHit{
			Chunk: c,
			Score: dot(query, c.Embedding),
		})
	}
	sort.Slice(hits, func(i, j int) bool {
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > k {
		hits = hits[:k]
	}
	return hits
}

// dot computes Σ a[i]*b[i]. No SIMD — at D=384 the compiler auto-vectorizes
// this loop well enough on amd64/arm64, and manual assembly isn't worth
// the maintenance burden at this scale.
func dot(a, b []float32) float32 {
	var s float32
	for i := range a {
		s += a[i] * b[i]
	}
	return s
}
