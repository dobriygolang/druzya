// Package infra — StreamingTranscriber implementations. The MVP impl
// (GroqWhisperBatch) wraps a regular domain.Provider: PCM16 → WAV →
// batch transcribe. Whisper-on-Groq does NOT have a true streaming
// API (only the OpenAI/Groq REST `/audio/transcriptions` batch
// endpoint), but we expose the streaming-shaped interface so the
// WS port stays provider-agnostic and a future Deepgram/AssemblyAI
// impl can drop in without touching the handler.
//
// Sample rate / format invariants must match the desktop client:
// 16kHz mono PCM16, little-endian. См. desktop/src/main/capture/audio-mac.ts.
package infra

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"

	"druz9/transcription/domain"
)

// GroqWhisperBatch — Whisper-via-Groq impl of StreamingTranscriber.
// На каждое окно WAV-wrap'ит входной PCM и делегирует существующему
// Provider'у. Возвращаемый isPartial всегда false: после Provider.Transcribe
// у нас уже final fragment — handler сам решит, посылать ли его как
// partial (если это первая часть длинного utterance'а) или как final.
type GroqWhisperBatch struct {
	Inner domain.Provider
	// SampleRate — sample rate входного PCM. Default 16000 если 0.
	SampleRate int
}

// NewGroqWhisperBatch конструирует impl с дефолтным 16kHz.
func NewGroqWhisperBatch(inner domain.Provider) *GroqWhisperBatch {
	return &GroqWhisperBatch{Inner: inner, SampleRate: 16000}
}

// Name implements domain.StreamingTranscriber.
func (g *GroqWhisperBatch) Name() string { return "groq-batch" }

// TranscribeWindow implements domain.StreamingTranscriber. Принимает
// PCM16 mono в `in.Audio` (НЕ WAV — handler не должен заботиться о
// container format'е), оборачивает в WAV header и делегирует Provider'у.
//
// in.MIME / in.Filename перезаписываются на WAV — это дешевле чем
// пересмотреть Provider'ный multipart filename detection.
func (g *GroqWhisperBatch) TranscribeWindow(ctx context.Context, in domain.TranscribeInput) (domain.TranscribeResult, bool, error) {
	if g.Inner == nil {
		return domain.TranscribeResult{}, false, fmt.Errorf("groq-batch: nil inner provider")
	}
	if len(in.Audio) == 0 {
		return domain.TranscribeResult{}, false, domain.ErrEmptyAudio
	}

	wav := encodeWAV(in.Audio, g.sampleRate())
	wrapped := domain.TranscribeInput{
		Audio:    wav,
		Filename: "stream-window.wav",
		MIME:     "audio/wav",
		Language: in.Language,
		Prompt:   in.Prompt,
		Model:    in.Model,
	}
	res, err := g.Inner.Transcribe(ctx, wrapped)
	if err != nil {
		return domain.TranscribeResult{}, false, err
	}
	return res, false, nil
}

func (g *GroqWhisperBatch) sampleRate() int {
	if g.SampleRate <= 0 {
		return 16000
	}
	return g.SampleRate
}

// encodeWAV строит 44-байтный header для PCM16 mono. Mirrors клиентскую
// encodeWAV в audio-mac.ts один-в-один — оба должны выдавать тот же
// header чтобы провайдер не паниковал на mime/format mismatch.
func encodeWAV(pcm []byte, sampleRate int) []byte {
	const bytesPerFrame = 2 // 16-bit mono
	byteRate := sampleRate * bytesPerFrame
	header := make([]byte, 44)
	copy(header[0:4], []byte("RIFF"))
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+len(pcm)))
	copy(header[8:12], []byte("WAVE"))
	copy(header[12:16], []byte("fmt "))
	binary.LittleEndian.PutUint32(header[16:20], 16) // fmt chunk size
	binary.LittleEndian.PutUint16(header[20:22], 1)  // PCM
	binary.LittleEndian.PutUint16(header[22:24], 1)  // channels
	binary.LittleEndian.PutUint32(header[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(header[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(header[32:34], bytesPerFrame)
	binary.LittleEndian.PutUint16(header[34:36], 16) // bits per sample
	copy(header[36:40], []byte("data"))
	binary.LittleEndian.PutUint32(header[40:44], uint32(len(pcm)))
	var buf bytes.Buffer
	buf.Grow(44 + len(pcm))
	buf.Write(header)
	buf.Write(pcm)
	return buf.Bytes()
}

// Compile-time guard.
var _ domain.StreamingTranscriber = (*GroqWhisperBatch)(nil)
