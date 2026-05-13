// Diarization — rudimentary per-utterance speaker clustering.
// Goal: «лучше чем 'они' — но не Pyannote-grade».
//
// Pipeline: каждое end-of-utterance окно из streaming WS handler'а →
// извлекаем дешёвые audio features (RMS + ZCR) на PCM16 mono LE →
// online k-means-style clustering. Per session держим up-to maxSpeakers
// centroid'ов; новая utterance либо привязывается к ближайшему (если
// расстояние < threshold), либо открывает новый speakerID.
//
// Trade-offs (явные):
//   - НЕ используем FFT/spectral centroid → no deep speaker fingerprint;
//     RMS+ZCR различают voice/silence + умеренно loudness/pitch'е, но
//     two voices on identical loudness + similar speech rate collapse'ятся.
//     Pyannote-grade требует ECAPA-TDNN embedding (50MB model + Python),
//     out of scope для bg-streaming process.
//   - Incremental, no batch re-cluster: первая utterance задаёт centroid
//     speaker_1. Если у юзера долгая тишина и speaker_1 «дрейфует»
//     (далеко из centroid), он попадает в speaker_2 — UI manual relabel
//     для merge'а.
//   - Mic source НЕ проходит через diarizer (caller'у Skip'ает): mic =
//     всегда speaker 0 ("Я"). System source → speaker 1..N.
//
// Storage: diarizer per-session, in-memory, не persist'ится между
// reconnects (renderer cleanly stops capture → session over). Cue
// renderer client-side держит human-readable label'ы поверх speaker_id
// (см. cue/src/renderer/stores/audio-capture.ts).
package domain

import (
	"encoding/binary"
	"math"
	"sync"
	"time"
)

// AudioFeatures — fingerprint одного utterance window'а. Cheap-to-compute
// набор: RMS (loudness) + ZCR (zero-crossings, грубый pitch/voicedness
// proxy). Normalized to [0..1] before clustering (см. normalize()).
type AudioFeatures struct {
	// RMS — root-mean-square amplitude. [0..1] после normalize'а.
	// Pre-normalize range: 0..16383 (PCM16 ~half-scale).
	RMS float64
	// ZCR — zero-crossing rate per sample. [0..1] после normalize'а.
	// Pre-normalize range: 0..0.5 (rate Nyquist'а — больше нет смысла).
	ZCR float64
}

// SpeakerCentroid — running average features assigned to speaker_id.
// EMA-style update: новая utterance pull'ит centroid в свою сторону
// с lr=1/Count (затухает по мере накопления).
type SpeakerCentroid struct {
	// ID — sequential speaker number per session. 1, 2, 3... 0 reserved
	// для mic source (the user "Я"), не выдаётся clusterer'ом.
	ID int
	// Features — running mean of all utterances в этом cluster'е.
	Features AudioFeatures
	// Count — кол-во utterance'ов assigned, для EMA learning rate.
	Count int
	// LastSeen — wall-clock когда последняя utterance assigned. Не
	// используется для eviction (max-speakers cap handle'ит), но
	// surfaceable в debug / future Pyannote-grade swap.
	LastSeen time.Time
}

// Diarizer — port для clustering algorithm. Stateful per session.
// Зачем интерфейс при одной реализации: legкость mock'а в WS handler
// тестах + future-proofing для Pyannote embedding swap'а.
type Diarizer interface {
	// AssignSpeaker — главный entry. Возвращает speakerID для данной
	// utterance: либо ID существующего centroid'а (closest within
	// threshold), либо новый ID если distance > threshold или
	// centroids ещё пустые. При maxSpeakers reached — assign'ит
	// ближайшего даже если distance > threshold (нельзя infinite
	// расти).
	AssignSpeaker(features AudioFeatures) (speakerID int)
	// Reset — clear all centroids. Вызывается при WS reset / start
	// нового utterance batch'а; обычно НЕ нужно, но handler может
	// reset'нуть если detected discontinuity (e.g. новый user joined
	// the call mid-session — отдельный signal).
	Reset()
}

// RMSClusterer — реализация Diarizer'а на RMS + ZCR + Euclidean
// distance. Thread-safe (per-session, но defensive — WS dispatch
// goroutines могут call concurrent'но).
type RMSClusterer struct {
	mu          sync.Mutex
	centroids   []SpeakerCentroid
	threshold   float64 // Euclidean distance threshold в normalized space [0..1].
	maxSpeakers int     // Hard cap. Empirics: typical interview = 2, group meeting = 4-6, 8 — safety.
	nextID      int
}

// NewRMSClusterer — конструктор с дефолтами. threshold=0.25 эмпирически
// подобран на synthetic data: разные voices обычно >0.4, same speaker
// drift <0.15. maxSpeakers=8 — гость в interview (3-4) + headroom.
//
// Если threshold=0 → используется default 0.25. maxSpeakers=0 → 8.
func NewRMSClusterer(threshold float64, maxSpeakers int) *RMSClusterer {
	if threshold <= 0 {
		threshold = 0.25
	}
	if maxSpeakers <= 0 {
		maxSpeakers = 8
	}
	return &RMSClusterer{
		threshold:   threshold,
		maxSpeakers: maxSpeakers,
		nextID:      1, // 0 reserved for mic source
	}
}

// AssignSpeaker implements Diarizer.
func (c *RMSClusterer) AssignSpeaker(features AudioFeatures) int {
	norm := normalize(features)
	c.mu.Lock()
	defer c.mu.Unlock()

	// Cold start — первая utterance создаёт speaker_1.
	if len(c.centroids) == 0 {
		id := c.nextID
		c.nextID++
		c.centroids = append(c.centroids, SpeakerCentroid{
			ID:       id,
			Features: norm,
			Count:    1,
			LastSeen: time.Now(),
		})
		return id
	}

	// Find closest centroid by Euclidean distance в normalized space.
	bestIdx := -1
	bestDist := math.Inf(1)
	for i, cent := range c.centroids {
		d := distance(cent.Features, norm)
		if d < bestDist {
			bestDist = d
			bestIdx = i
		}
	}

	// Within threshold → assign existing speaker. EMA-update centroid.
	if bestDist <= c.threshold {
		c.centroids[bestIdx].Count++
		c.centroids[bestIdx].Features = emaUpdate(c.centroids[bestIdx].Features, norm, c.centroids[bestIdx].Count)
		c.centroids[bestIdx].LastSeen = time.Now()
		return c.centroids[bestIdx].ID
	}

	// Threshold exceeded — open new speaker if budget allows.
	if len(c.centroids) < c.maxSpeakers {
		id := c.nextID
		c.nextID++
		c.centroids = append(c.centroids, SpeakerCentroid{
			ID:       id,
			Features: norm,
			Count:    1,
			LastSeen: time.Now(),
		})
		return id
	}

	// Budget exhausted — collapse в closest даже выше threshold. UI
	// manual relabel = escape hatch для misassignment'а.
	c.centroids[bestIdx].Count++
	c.centroids[bestIdx].Features = emaUpdate(c.centroids[bestIdx].Features, norm, c.centroids[bestIdx].Count)
	c.centroids[bestIdx].LastSeen = time.Now()
	return c.centroids[bestIdx].ID
}

// Reset implements Diarizer. Clears all centroids and ID counter.
func (c *RMSClusterer) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.centroids = c.centroids[:0]
	c.nextID = 1
}

// Snapshot returns current centroid list. For debug / metrics; do not
// rely on order — clusterer may reorganize internally в будущем.
func (c *RMSClusterer) Snapshot() []SpeakerCentroid {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]SpeakerCentroid, len(c.centroids))
	copy(out, c.centroids)
	return out
}

// Compile-time guard.
var _ Diarizer = (*RMSClusterer)(nil)

// ─────────────────────────────────────────────────────────────────────────
// Feature extraction (PCM16 mono LE → features).
// ─────────────────────────────────────────────────────────────────────────

// ExtractFeatures — compute AudioFeatures из raw PCM16 mono little-endian
// bytes. Empty / too-short input → zero features (clusterer'у не вредит,
// просто будет assigned куда-нибудь).
//
// Single-pass: считаем sum-of-squares (RMS) и zero-crossing count
// параллельно. ZCR взвешен per-sample (not per-second) — масштаб stable
// для разных window lengths.
func ExtractFeatures(pcm []byte) AudioFeatures {
	samples := len(pcm) / 2
	if samples < 2 {
		return AudioFeatures{}
	}
	var sumSq float64
	var crossings int
	// Process first sample (sumSq only — no prev для crossings).
	prev := int16(binary.LittleEndian.Uint16(pcm[0:2])) //nolint:gosec // PCM16 bit-pattern round-trip
	{
		f := float64(prev)
		sumSq += f * f
	}
	for i := 2; i+1 < len(pcm); i += 2 {
		s := int16(binary.LittleEndian.Uint16(pcm[i : i+2])) //nolint:gosec // PCM16 bit-pattern round-trip
		// Sign change → zero crossing. 0 trated как positive (consistent),
		// чтобы synthetic sine wave (которая проходит через ровно 0)
		// counted'ились correctly: sample=0 потом sample<0 → crossing.
		if (prev < 0) != (s < 0) {
			crossings++
		}
		f := float64(s)
		sumSq += f * f
		prev = s
	}
	rms := math.Sqrt(sumSq / float64(samples))
	zcr := float64(crossings) / float64(samples)
	return AudioFeatures{RMS: rms, ZCR: zcr}
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers: normalize, distance, EMA update.
// ─────────────────────────────────────────────────────────────────────────

// rmsScale / zcrScale — empirical normalization constants. RMS [0..maxInt16]
// → [0..1]; ZCR [0..0.5] → [0..1]. Slightly compressive (saturate above
// ~half-scale loudness — speech RMS rarely > 8000 in PCM16).
const (
	rmsScale = 8000.0
	zcrScale = 0.4
)

// normalize squashes raw AudioFeatures в [0..1] space для distance comparison.
// Clamped above scale — loud speech не должна wreck centroid'а на linear scale.
func normalize(f AudioFeatures) AudioFeatures {
	rms := f.RMS / rmsScale
	if rms > 1 {
		rms = 1
	}
	if rms < 0 {
		rms = 0
	}
	zcr := f.ZCR / zcrScale
	if zcr > 1 {
		zcr = 1
	}
	if zcr < 0 {
		zcr = 0
	}
	return AudioFeatures{RMS: rms, ZCR: zcr}
}

// distance — Euclidean в normalized 2D space.
func distance(a, b AudioFeatures) float64 {
	dr := a.RMS - b.RMS
	dz := a.ZCR - b.ZCR
	return math.Sqrt(dr*dr + dz*dz)
}

// emaUpdate — exponential moving average pull. lr=1/n даёт running mean
// если все samples весятся равно; на старте centroid быстро адаптируется
// (n=2 → 50/50 mix), к 10-й utterance — почти stable (lr=0.1).
func emaUpdate(centroid, sample AudioFeatures, n int) AudioFeatures {
	if n <= 1 {
		return sample
	}
	lr := 1.0 / float64(n)
	return AudioFeatures{
		RMS: centroid.RMS*(1-lr) + sample.RMS*lr,
		ZCR: centroid.ZCR*(1-lr) + sample.ZCR*lr,
	}
}
