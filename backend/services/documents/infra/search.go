package infra

import "druz9/documents/domain"

// CosineTopK is re-exported from domain for backward compatibility with
// existing call sites that haven't been updated yet. New code should call
// domain.CosineTopK directly.
//
// Deprecated: use domain.CosineTopK.
func CosineTopK(query []float32, chunks []domain.Chunk, k int) []domain.SearchHit {
	return domain.CosineTopK(query, chunks, k)
}
