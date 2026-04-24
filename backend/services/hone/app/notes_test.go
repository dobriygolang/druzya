package app

import (
	"math"
	"testing"
)

// ─── cosine ────────────────────────────────────────────────────────────────
//
// cosine is the hot-loop of GetNoteConnections. It runs once per note in the
// user's corpus every time the user opens connections (~0.1-1ms total at
// realistic scale — 100-1000 notes). The tests lock down the invariants
// callers rely on: identical vectors give 1.0, orthogonal give 0, length
// mismatch degrades silently rather than panicking.

func TestCosine_IdenticalVectorsReturnOne(t *testing.T) {
	t.Parallel()
	v := []float32{0.3, -0.1, 0.8, 0.2}
	got := cosine(v, v)
	if math.Abs(float64(got-1)) > 1e-4 {
		t.Fatalf("cosine(v, v) = %f, want ~1.0", got)
	}
}

func TestCosine_OrthogonalVectorsReturnZero(t *testing.T) {
	t.Parallel()
	a := []float32{1, 0, 0, 0}
	b := []float32{0, 1, 0, 0}
	got := cosine(a, b)
	if math.Abs(float64(got)) > 1e-6 {
		t.Fatalf("cosine(a⊥b) = %f, want ~0", got)
	}
}

func TestCosine_OppositeVectorsReturnMinusOne(t *testing.T) {
	t.Parallel()
	a := []float32{0.5, 0.5}
	b := []float32{-0.5, -0.5}
	got := cosine(a, b)
	if math.Abs(float64(got+1)) > 1e-3 {
		t.Fatalf("cosine(a, -a) = %f, want ~-1.0", got)
	}
}

func TestCosine_LengthMismatchReturnsZero(t *testing.T) {
	t.Parallel()
	// Defensive: bge-small always emits fixed-dim vectors, but a corrupted
	// DB row shouldn't crash GetNoteConnections. Zero sim = filtered below
	// the 0.6 threshold → correctly excluded from results.
	if got := cosine([]float32{1, 0, 0}, []float32{1, 0}); got != 0 {
		t.Fatalf("cosine on length-mismatch = %f, want 0", got)
	}
	if got := cosine(nil, []float32{1}); got != 0 {
		t.Fatalf("cosine on nil = %f, want 0", got)
	}
	if got := cosine(nil, nil); got != 0 {
		t.Fatalf("cosine on empty = %f, want 0", got)
	}
}

func TestCosine_ZeroVectorReturnsZero(t *testing.T) {
	t.Parallel()
	// Zero-norm sentinel — bge-small never outputs all-zero vectors in
	// practice (non-empty input → some signal) but defending against it is
	// cheap and prevents NaN propagation downstream.
	if got := cosine([]float32{0, 0, 0}, []float32{1, 1, 1}); got != 0 {
		t.Fatalf("cosine(0, v) = %f, want 0", got)
	}
}

// ─── sqrt32 ────────────────────────────────────────────────────────────────

func TestSqrt32_RoughAccuracy(t *testing.T) {
	t.Parallel()
	// Newton iteration used for ranking — not bit-exact but should be
	// within 0.1% of the true root for the value range we see (sums of
	// squares of unit-norm vectors ≤ dim ≤ 384).
	for _, x := range []float32{0.25, 1, 4, 100, 384} {
		got := sqrt32(x)
		want := float32(math.Sqrt(float64(x)))
		if math.Abs(float64(got-want)/float64(want)) > 1e-3 {
			t.Errorf("sqrt32(%f) = %f, want ~%f", x, got, want)
		}
	}
	if got := sqrt32(0); got != 0 {
		t.Errorf("sqrt32(0) = %f, want 0", got)
	}
	if got := sqrt32(-1); got != 0 {
		t.Errorf("sqrt32(-1) = %f, want 0", got)
	}
}
