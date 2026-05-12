// Diarization unit tests. Synthetic features only — реальный clustering
// quality (precision/recall на разных voices) проверяется QA-ом на
// labeled audio. Тут только инвариант algorithm'а: distinct features →
// distinct speakers, repeat features → same speaker, cap respected,
// reset чистит state.
package domain

import (
	"encoding/binary"
	"math"
	"testing"
)

// TestRMSClusterer_DistinctSpeakers — три utterance'а с разными RMS+ZCR
// должны получить три разных speakerID'ов (1, 2, 3).
func TestRMSClusterer_DistinctSpeakers(t *testing.T) {
	c := NewRMSClusterer(0.25, 8)

	// Speaker A — низкий бас (low RMS, low ZCR).
	idA := c.AssignSpeaker(AudioFeatures{RMS: 800, ZCR: 0.05})
	if idA != 1 {
		t.Fatalf("first utterance should get speaker_1, got %d", idA)
	}

	// Speaker B — громкий + ярче (high RMS, high ZCR).
	idB := c.AssignSpeaker(AudioFeatures{RMS: 6000, ZCR: 0.30})
	if idB != 2 {
		t.Fatalf("distinct features should open speaker_2, got %d", idB)
	}

	// Speaker C — mid RMS, mid ZCR (different from both).
	idC := c.AssignSpeaker(AudioFeatures{RMS: 3500, ZCR: 0.18})
	if idC != 3 {
		t.Fatalf("third distinct utterance should open speaker_3, got %d", idC)
	}

	// Все три IDs распределённые.
	if idA == idB || idB == idC || idA == idC {
		t.Fatalf("expected three distinct speakers, got %d/%d/%d", idA, idB, idC)
	}
}

// TestRMSClusterer_ReassignSame — повтор похожих features должен
// re-assign'ить тот же speakerID (а не открывать новый).
func TestRMSClusterer_ReassignSame(t *testing.T) {
	c := NewRMSClusterer(0.25, 8)

	// Speaker A — baseline.
	idA1 := c.AssignSpeaker(AudioFeatures{RMS: 1000, ZCR: 0.08})
	// Speaker B — далеко от A.
	idB1 := c.AssignSpeaker(AudioFeatures{RMS: 7000, ZCR: 0.35})
	// Speaker A repeat — slight noise variation на тех же features.
	idA2 := c.AssignSpeaker(AudioFeatures{RMS: 1100, ZCR: 0.09})
	// Speaker B repeat.
	idB2 := c.AssignSpeaker(AudioFeatures{RMS: 6900, ZCR: 0.34})

	if idA1 != idA2 {
		t.Fatalf("similar feature should reuse speakerID, got A1=%d A2=%d", idA1, idA2)
	}
	if idB1 != idB2 {
		t.Fatalf("similar feature should reuse speakerID, got B1=%d B2=%d", idB1, idB2)
	}
	if idA1 == idB1 {
		t.Fatalf("distinct features collapsed to same speaker: A=%d B=%d", idA1, idB1)
	}
}

// TestRMSClusterer_MaxSpeakerCap — после maxSpeakers utterance'ов новые
// distinct features должны fallback'нуться на ближайший existing centroid
// вместо открытия N+1.
func TestRMSClusterer_MaxSpeakerCap(t *testing.T) {
	const cap = 3
	c := NewRMSClusterer(0.20, cap)

	// Заполняем все 3 слота сильно различающимися features.
	id1 := c.AssignSpeaker(AudioFeatures{RMS: 500, ZCR: 0.02})
	id2 := c.AssignSpeaker(AudioFeatures{RMS: 4000, ZCR: 0.20})
	id3 := c.AssignSpeaker(AudioFeatures{RMS: 7500, ZCR: 0.38})
	if id1 != 1 || id2 != 2 || id3 != 3 {
		t.Fatalf("initial fill bad: %d %d %d (expected 1 2 3)", id1, id2, id3)
	}

	// Четвёртая utterance очень distinct'на (между existing) — НЕ должна
	// открыть speaker_4 (cap=3), должна fallback'нуться на ближайшего.
	id4 := c.AssignSpeaker(AudioFeatures{RMS: 2200, ZCR: 0.12})
	if id4 < 1 || id4 > 3 {
		t.Fatalf("4th utterance must reuse one of 1..3, got %d", id4)
	}

	// Snapshot подтверждает что centroids ровно 3.
	snap := c.Snapshot()
	if len(snap) != cap {
		t.Fatalf("expected %d centroids after cap, got %d", cap, len(snap))
	}
}

// TestRMSClusterer_Reset — после Reset() centroids пустые, nextID=1.
func TestRMSClusterer_Reset(t *testing.T) {
	c := NewRMSClusterer(0.25, 8)
	c.AssignSpeaker(AudioFeatures{RMS: 1000, ZCR: 0.05})
	c.AssignSpeaker(AudioFeatures{RMS: 5000, ZCR: 0.30})
	if got := len(c.Snapshot()); got != 2 {
		t.Fatalf("pre-reset centroids wrong: %d, expected 2", got)
	}

	c.Reset()
	if got := len(c.Snapshot()); got != 0 {
		t.Fatalf("post-reset centroids must be empty, got %d", got)
	}

	// После reset'а первая новая utterance снова получает speaker_1.
	id := c.AssignSpeaker(AudioFeatures{RMS: 3000, ZCR: 0.15})
	if id != 1 {
		t.Fatalf("post-reset first utterance must be speaker_1, got %d", id)
	}
}

// TestRMSClusterer_CentroidDrift — повторяющиеся similar features
// должны pull центроид EMA-style, не открывая новый speakerID даже
// при небольшом drift'е.
func TestRMSClusterer_CentroidDrift(t *testing.T) {
	c := NewRMSClusterer(0.25, 8)

	// Baseline speaker. После 5 utterance'ов centroid должен drift'нуться
	// в среднюю позицию и стабилизироваться.
	ids := make([]int, 0, 5)
	for i := 0; i < 5; i++ {
		// Small RMS variation: 1000 → 1200 ramp; clusterer должен
		// considered "тот же speaker".
		f := AudioFeatures{RMS: 1000 + float64(50*i), ZCR: 0.06}
		ids = append(ids, c.AssignSpeaker(f))
	}
	for i, id := range ids {
		if id != 1 {
			t.Fatalf("utterance %d got speaker_%d, expected 1 (drift should not split)", i, id)
		}
	}
	snap := c.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 centroid after EMA drift, got %d", len(snap))
	}
	if snap[0].Count != 5 {
		t.Fatalf("centroid count wrong: %d, expected 5", snap[0].Count)
	}
}

// TestExtractFeatures_FromPCM — verify feature extractor returns sensible
// numbers для synthesized PCM16. Sine wave at 200Hz (low-pitched) →
// expected ZCR ≈ 2*200/sample_rate = 0.025 для 16kHz.
func TestExtractFeatures_FromPCM(t *testing.T) {
	// 16kHz mono, 1 second of 200Hz sine wave at amplitude ~3000.
	const sr = 16000
	const freq = 200.0
	const amp = 3000.0
	samples := sr
	pcm := make([]byte, samples*2)
	for i := 0; i < samples; i++ {
		v := int16(amp * math.Sin(2*math.Pi*freq*float64(i)/float64(sr)))
		binary.LittleEndian.PutUint16(pcm[i*2:i*2+2], uint16(v))
	}
	f := ExtractFeatures(pcm)

	// RMS sine wave = amp/sqrt(2) ≈ 2121. Tolerance ±5%.
	expectedRMS := amp / math.Sqrt2
	if math.Abs(f.RMS-expectedRMS)/expectedRMS > 0.05 {
		t.Fatalf("RMS off: got %.1f expected ~%.1f", f.RMS, expectedRMS)
	}

	// ZCR for sine wave = 2 zero crossings per period × freq / sr.
	expectedZCR := 2 * freq / float64(sr)
	if math.Abs(f.ZCR-expectedZCR)/expectedZCR > 0.1 {
		t.Fatalf("ZCR off: got %.4f expected ~%.4f", f.ZCR, expectedZCR)
	}
}

// TestExtractFeatures_Empty — zero / too-short input returns zero features
// без panic'а.
func TestExtractFeatures_Empty(t *testing.T) {
	if f := ExtractFeatures(nil); f.RMS != 0 || f.ZCR != 0 {
		t.Fatalf("empty PCM should give zero features, got %+v", f)
	}
	if f := ExtractFeatures([]byte{0x01}); f.RMS != 0 || f.ZCR != 0 {
		t.Fatalf("single-byte PCM should give zero features, got %+v", f)
	}
}
