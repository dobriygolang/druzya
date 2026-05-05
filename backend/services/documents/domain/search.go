package domain

import "slices"

// CosineTopK returns the k chunks with highest cosine similarity against
// query. Both query and chunk embeddings MUST be L2-normalized — the
// "cosine" reduces to a dot product.
//
// Pure function over domain types; lives here so port handlers can pass it
// to the search use-case without crossing into infra.
//
// Performance envelope: O(N·D) where N=len(chunks), D=embedding dim (384).
// At N=5000, D=384 on a laptop CPU it runs in ~3-5ms. If we outgrow it the
// upgrade path is pgvector + `ORDER BY embedding <=> $1`.
func CosineTopK(query []float32, chunks []Chunk, k int) []SearchHit {
	if k <= 0 || len(chunks) == 0 {
		return nil
	}
	hits := make([]SearchHit, 0, len(chunks))
	for _, c := range chunks {
		// Skip chunks with a mis-sized embedding — should never happen given
		// the CHECK constraint on the column, but cheap to verify.
		if len(c.Embedding) != len(query) {
			continue
		}
		hits = append(hits, SearchHit{
			Chunk: c,
			Score: dot(query, c.Embedding),
		})
	}
	slices.SortFunc(hits, func(a, b SearchHit) int {
		if a.Score > b.Score {
			return -1
		}
		if a.Score < b.Score {
			return 1
		}
		return 0
	})
	if len(hits) > k {
		hits = hits[:k]
	}
	return hits
}

// dot computes Σ a[i]*b[i]. The compiler auto-vectorizes this loop well
// enough on amd64/arm64 at D=384.
func dot(a, b []float32) float32 {
	var s float32
	for i := range a {
		s += a[i] * b[i]
	}
	return s
}
