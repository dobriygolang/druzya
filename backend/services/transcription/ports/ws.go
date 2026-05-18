// ws.go — WebSocket transcription endpoint.
//
//	GET /ws/transcription/stream?token=<JWT>
//
// Wire protocol:
//
//   - Client → Server: BinaryMessage frames carrying raw PCM16 mono
//     little-endian samples at 16kHz. Any frame size accepted; handler
//     accumulates until a window threshold is reached, then dispatches
//     to StreamingTranscriber. TextMessage frames carry JSON control
//     commands {"type":"reset"} → flushes & resets utterance, or
//     {"type":"prompt","text":"...","language":"ru"} → bias subsequent
//     windows.
//
//   - Server → Client: TextMessage frames with JSON deltas:
//     {"type":"partial","text":"...","duration":0.8} — preliminary text
//     (currently only first window of a multi-window utterance, see comment
//     in serveStream); {"type":"final","text":"...","duration":1.2} — final
//     text for the just-flushed window; {"type":"error","message":"..."} —
//     non-fatal warning. Connection close = end of session.
//
// Auth: token JWT в query string (?token=) ИЛИ Authorization: Bearer
// header — last one wins. WS upgrades cannot reliably read Authorization
// from browsers, поэтому в клиенте используем query-param.
//
// Rate limit: per-user N chunks/min (defaults to 600, ~10/s). Window
// dispatch уже сам по себе ограничен 1-2s окном на провайдере, но
// злонамеренный клиент мог бы спамить пустыми BinaryMessage'ами →
// держим явный rate-limiter поверх. ROOM FOR IMPROVEMENT: лимитировать
// AUDIO MINUTES на день вместо chunk-counts, но MVP-ok.

package ports

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/ratelimit"
	"druz9/transcription/app"
	"druz9/transcription/domain"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// streamChunkLimitPerMin — per-user inbound chunk cap. ~10 chunks/sec
// hard ceiling. Whisper batch latency is 100-700ms per window, так
// что в нормальном flow клиент шлёт ~3-5 chunks/sec — 600 даёт 2-3x
// headroom для micro-bursts (RMS spike right after silence + boundary
// flush в один тик). Превышение → server закрывает WS с code 1008.
const streamChunkLimitPerMin = 600

// minWindowBytes / maxWindowBytes — границы окна перед dispatch'ем.
// 16000 Hz × 2 bytes/frame × seconds.
//
// 1.0s минимум — Whisper-turbo на короче 0.8s склонен возвращать пустую
// строку или одну букву (модель видит "speech-like noise" но не успевает
// extract'нуть phoneme). 2.0s максимум — sweet spot для интерактивного
// transcript flow: latency на Groq ~400-700ms на 2s, юзер видит deltas
// каждые ~3s. Длиннее окна = меньше "live" feel'а.
const (
	streamSampleRate    = 16000
	streamBytesPerFrame = 2
	minWindowBytes      = streamSampleRate * streamBytesPerFrame * 1  // 1.0s
	maxWindowBytes      = streamSampleRate * streamBytesPerFrame * 2  // 2.0s
	maxBufferBytes      = streamSampleRate * streamBytesPerFrame * 30 // 30s safety cap (drop on overflow)
	silenceRMSCutoff    = 200                                         // ниже = drop window (silence pre-filter)
	wsPingInterval      = 30 * time.Second
	wsReadDeadline      = 120 * time.Second
	wsWriteTimeout      = 10 * time.Second

	// RMS diarizer params. 0 = use built-in defaults (threshold from
	// clusterer impl, unbounded speakers). Named for a single tuning knob.
	diarizerMinThreshold = 0.0
	diarizerMaxSpeakers  = 0
)

// TokenVerifier — locally-owned auth boundary. Adapter в monolith
// делегирует TokenIssuer.Parse (см. cmd/monolith/services/auth/verifiers.go).
type TokenVerifier interface {
	Verify(token string) (uuid.UUID, error)
}

// StreamHandler is the WS endpoint for live STT.
type StreamHandler struct {
	Tiered     *app.TieredTranscribe
	Streaming  domain.StreamingTranscriber
	Verifier   TokenVerifier
	Limiter    *ratelimit.RedisFixedWindow
	KillSwitch *killswitch.Switch
	Log        *slog.Logger

	Upgrader websocket.Upgrader
}

// NewStreamHandler builds a handler with a permissive upgrader (Cue
// is the only client; CORS-сurroundings handled by chi middleware).
func NewStreamHandler(tiered *app.TieredTranscribe, streaming domain.StreamingTranscriber, verifier TokenVerifier, limiter *ratelimit.RedisFixedWindow, ks *killswitch.Switch, log *slog.Logger) *StreamHandler {
	return &StreamHandler{
		Tiered:     tiered,
		Streaming:  streaming,
		Verifier:   verifier,
		Limiter:    limiter,
		KillSwitch: ks,
		Log:        log,
		Upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// Handle is the chi handler for GET /ws/transcription/stream.
func (h *StreamHandler) Handle(w http.ResponseWriter, r *http.Request) {
	if h.KillSwitch != nil && h.KillSwitch.IsOn(r.Context(), killswitch.FeatureTranscription) {
		http.Error(w, "transcription temporarily disabled by operator", http.StatusServiceUnavailable)
		return
	}
	if h.Streaming == nil || h.Tiered == nil || h.Verifier == nil {
		http.Error(w, "streaming transcription not configured", http.StatusServiceUnavailable)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}
	uid, err := h.Verifier.Verify(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := h.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrader writes its own response on failure — just log.
		if h.Log != nil {
			h.Log.Warn("transcription.ws: upgrade failed", slog.Any("err", err))
		}
		return
	}

	// Hint params (forwarded to Whisper). Empty → provider auto-detect.
	language := r.URL.Query().Get("language")
	prompt := r.URL.Query().Get("prompt")
	// Source declared by the client — "mic" / "system". Used by the
	// diarizer: mic = always speaker 0 (the user "Я"), system = dynamic
	// speaker 1..N через RMS clustering. Empty / unknown → treated as
	// system (backwards-compat for any client that doesn't pass it yet).
	source := r.URL.Query().Get("source")
	if source != "mic" && source != "system" {
		source = "system"
	}

	h.serveStream(r.Context(), ws, uid, language, prompt, source)
}

// streamCtl — JSON envelope для control / response messages.
//
// SpeakerID semantics (C4):
//   - 0 → mic source / the user ("Я"). Never assigned by diarizer.
//   - 1..N → distinct voices in system audio, clustered per-utterance
//     via RMS + ZCR features. Stable within a session, NOT across
//     reconnects (client должен держать labels in renderer state).
//   - Omitted (zero-value на wire без omitempty? — мы используем
//     pointer-int omitempty) если diarization не активна / клиент
//     старый.
//
// Source — копия `source` query param: "mic" / "system". Помогает
// клиенту маршрутизировать delta в нужный slice без чтения локального
// state'а.
type streamCtl struct {
	Type      string  `json:"type"`                // "reset" | "prompt" | "ping" — client→server
	Text      string  `json:"text,omitempty"`      // server→client transcript / prompt update
	Message   string  `json:"message,omitempty"`   // server→client error message
	Language  string  `json:"language,omitempty"`  // language hint update or detected language
	Duration  float64 `json:"duration,omitempty"`  // window duration in seconds
	Source    string  `json:"source,omitempty"`    // "mic" | "system" (server→client only)
	SpeakerID int     `json:"speaker_id,omitempty"` // 0=mic/user, 1..N=clustered system speakers
}

func (h *StreamHandler) serveStream(rootCtx context.Context, ws *websocket.Conn, userID uuid.UUID, language, prompt, source string) {
	ctx, cancel := context.WithCancel(rootCtx)
	defer cancel()
	defer ws.Close()

	out := newStreamConn(ws, h.Log)
	// dispatchWG tracks every in-flight dispatchWindow goroutine. Wait
	// first (LIFO defer), then close(out.done) so writeLoop can drain
	// any remaining sends without racing dispatchWindow.
	var dispatchWG sync.WaitGroup
	defer close(out.done)
	defer dispatchWG.Wait()

	go out.writeLoop(ctx)

	// State for this connection. buffer accumulates PCM16 mono samples
	// across BinaryMessage frames; rmsLast keeps last computed RMS for
	// fast skip. promptOverride / languageOverride accept runtime updates
	// from {"type":"prompt"} control frames без reconnect.
	//
	// Diarizer — per-WS-connection RMS clusterer. Mic source НЕ feed'ит
	// clusterer (всегда speaker_id=0); system source — extracts features
	// from window PCM до WAV-encoding и assigns speaker_id 1..N.
	var (
		bufMu            sync.Mutex
		buf              []byte
		windowSeq        int
		languageOverride = language
		promptOverride   = prompt
		diarizer         = domain.NewRMSClusterer(diarizerMinThreshold, diarizerMaxSpeakers)
	)

	flushWindow := func(reason string) {
		bufMu.Lock()
		if len(buf) < minWindowBytes {
			bufMu.Unlock()
			return
		}
		owned := make([]byte, len(buf))
		copy(owned, buf)
		buf = buf[:0]
		windowSeq++
		seq := windowSeq
		bufMu.Unlock()

		// Silence pre-filter — same RMS threshold as desktop. Whisper
		// hallucinates classics ("Субтитры делал DimaTorzok") on silent
		// chunks; cheaper to skip server-side too.
		if rms := computeRMS(owned); rms < silenceRMSCutoff {
			return
		}

		// Speaker assignment: mic = 0 ("Я"), system = clustered 1..N.
		// Diarizer.AssignSpeaker non-blocking (in-memory math); safe в
		// serveStream goroutine — не делает I/O.
		var speakerID int
		if source == "system" {
			feats := domain.ExtractFeatures(owned)
			speakerID = diarizer.AssignSpeaker(feats)
		} // else mic: speakerID stays 0.

		dispatchWG.Add(1)
		go func() {
			defer dispatchWG.Done()
			h.dispatchWindow(ctx, out, userID, owned, languageOverride, promptOverride, seq, reason, source, speakerID)
		}()
	}

	// Set deadlines + pong handler (ai_mock/editor pattern).
	_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
	ws.SetPongHandler(func(string) error {
		_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
		return nil
	})

	for {
		if ctx.Err() != nil {
			return
		}
		mt, data, err := ws.ReadMessage()
		if err != nil {
			// Client closed or peer dead; flush any tail buffer and exit.
			flushWindow("close")
			return
		}
		_ = ws.SetReadDeadline(time.Now().Add(wsReadDeadline))

		// Rate-limit ANY inbound message (control + binary) — keeps
		// abusive clients from filling the read goroutine с control
		// no-op'ами. nil-safe в dev без Redis.
		if h.Limiter != nil {
			key := "rl:trans-stream:" + userID.String()
			res, err := h.Limiter.Allow(ctx, key, streamChunkLimitPerMin, time.Minute)
			if err == nil && !res.Allowed {
				out.send(streamCtl{
					Type:    "error",
					Message: "rate limited, retry in " + strconv.Itoa(res.RetryAfterSec) + "s",
				})
				return
			}
		}

		switch mt {
		case websocket.BinaryMessage:
			if len(data) == 0 {
				continue
			}
			bufMu.Lock()
			// Overflow guard — клиент молчит про boundary, мы же не
			// можем держать буфер навсегда. 30s — больше любого
			// разумного utterance, drop с warning.
			if len(buf)+len(data) > maxBufferBytes {
				buf = buf[:0]
				bufMu.Unlock()
				out.send(streamCtl{Type: "error", Message: "buffer overflow, dropping audio"})
				continue
			}
			buf = append(buf, data...)
			ready := len(buf) >= maxWindowBytes
			bufMu.Unlock()
			if ready {
				flushWindow("max")
			}

		case websocket.TextMessage:
			var ctl streamCtl
			if err := json.Unmarshal(data, &ctl); err != nil {
				continue
			}
			switch ctl.Type {
			case "reset":
				// Flush whatever we have, reset utterance boundary.
				// Diarizer state ПЕРЕжИВАЕТ reset — это просто end-of-
				// utterance signal, не "new conversation". Если клиент
				// хочет clear speakers (e.g. new call started), он сам
				// откроет новое WS соединение.
				flushWindow("reset")
				bufMu.Lock()
				buf = buf[:0]
				bufMu.Unlock()
			case "boundary":
				// Same as reset semantically — caller signals "end of
				// utterance". Cheap to support both names; future-proof.
				flushWindow("boundary")
			case "prompt":
				if ctl.Text != "" {
					promptOverride = ctl.Text
				}
				if ctl.Language != "" {
					languageOverride = ctl.Language
				}
			case "ping":
				out.send(streamCtl{Type: "pong"})
			default:
				// Unknown — ignore. Forward-compat.
			}

		default:
			// Close / Ping / Pong handled by gorilla automatically.
		}
	}
}

// dispatchWindow runs in its own goroutine: NEVER blocks the read loop.
// Multiple concurrent dispatches are fine — Groq accepts parallel calls,
// and out.writeLoop is FIFO so deltas stay in send-order even if window
// processing finishes out of order.
//
// source / speakerID — diarization labels assigned BEFORE this call (см.
// flushWindow). Carried through verbatim into out.send() so the client
// can route delta into the correct slice.
func (h *StreamHandler) dispatchWindow(ctx context.Context, out *streamConn, userID uuid.UUID, pcm []byte, language, prompt string, seq int, reason, source string, speakerID int) {
	durSec := float64(len(pcm)) / float64(streamSampleRate*streamBytesPerFrame)
	in := domain.TranscribeInput{
		Audio:    pcm,
		Filename: "stream-window.wav",
		MIME:     "audio/wav",
		Language: language,
		Prompt:   prompt,
	}
	// Tier-aware model selection happens BEFORE the streaming wrapper —
	// we duplicate the small piece of logic that TieredTranscribe.Do
	// does (resolve tier → set Model) so we can route the in.Model
	// hint into the streaming path. Keeps the WS code consistent с
	// tier-aware quality того же юзера в batch endpoint.
	if h.Tiered != nil && h.Tiered.Models != nil && h.Tiered.Tiers != nil {
		tier := "free"
		if resolved, err := h.Tiered.Tiers.ResolveTier(ctx, userID); err == nil && resolved != "" {
			tier = resolved
		}
		in.Model = h.Tiered.Models.ModelForTier(tier)
	}

	res, _, err := h.Streaming.TranscribeWindow(ctx, in)
	if err != nil {
		// Domain-level errors get a friendlier text; everything else
		// surfaces as a generic warning. We don't drop the connection
		// for a single window failure — caller can retry next chunk.
		msg := "transcription window failed"
		switch {
		case errors.Is(err, domain.ErrEmptyAudio):
			return // benign — silence after pre-filter race
		case errors.Is(err, domain.ErrTooLarge):
			msg = "window too large"
		case errors.Is(err, domain.ErrProviderUnavailable):
			msg = "provider unavailable"
		}
		if h.Log != nil {
			h.Log.WarnContext(ctx, "transcription.ws: window failed",
				slog.String("provider", h.Streaming.Name()),
				slog.Int("seq", seq),
				slog.String("reason", reason),
				slog.Float64("duration", durSec),
				slog.Any("err", err))
		}
		out.send(streamCtl{Type: "error", Message: msg})
		return
	}

	if strings.TrimSpace(res.Text) == "" {
		return
	}
	// MVP: каждый window = один "final" delta. Реальные partial'ы
	// потребуют streaming-нативной модели (Deepgram). Cue UI уже
	// поддерживает обе ветки (см. desktop side).
	//
	// Source + speaker_id carried verbatim — see flushWindow для assignment
	// logic. С `omitempty` на speaker_id: 0 → не сериализуется (mic uses
	// zero, but client может infer from source==mic; system never sends 0).
	out.send(streamCtl{
		Type:      "final",
		Text:      res.Text,
		Language:  res.Language,
		Duration:  res.Duration,
		Source:    source,
		SpeakerID: speakerID,
	})
}

// computeRMS — root-mean-square amplitude для PCM16 mono LE. Mirrors
// клиентскую computeRMS в audio-mac.ts; thresholds одинаковы.
func computeRMS(pcm []byte) float64 {
	samples := len(pcm) / 2
	if samples == 0 {
		return 0
	}
	var sumSq float64
	for i := 0; i+1 < len(pcm); i += 2 {
		s := int16(binary.LittleEndian.Uint16(pcm[i : i+2]))
		f := float64(s)
		sumSq += f * f
	}
	mean := sumSq / float64(samples)
	if mean <= 0 {
		return 0
	}
	return sqrtFast(mean)
}

// sqrtFast — math.Sqrt без import math (минимизируем deps пакета).
// Newton's method, 8 iterations sufficient для double precision на
// audio amplitude scale.
func sqrtFast(x float64) float64 {
	if x <= 0 {
		return 0
	}
	z := x / 2
	for i := 0; i < 8; i++ {
		z -= (z*z - x) / (2 * z)
	}
	return z
}

// ─────────────────────────────────────────────────────────────────────────
// streamConn — per-WS write goroutine с rate-limit-shaped buffer.
// ─────────────────────────────────────────────────────────────────────────

type streamConn struct {
	ws   *websocket.Conn
	out  chan streamCtl
	done chan struct{}
	log  *slog.Logger
}

func newStreamConn(ws *websocket.Conn, log *slog.Logger) *streamConn {
	return &streamConn{
		ws:   ws,
		out:  make(chan streamCtl, 64),
		done: make(chan struct{}),
		log:  log,
	}
}

func (c *streamConn) send(f streamCtl) {
	select {
	case c.out <- f:
	default:
		if c.log != nil {
			c.log.Warn("transcription.ws: drop frame, buffer full", slog.String("type", f.Type))
		}
	}
}

func (c *streamConn) writeLoop(ctx context.Context) {
	pinger := time.NewTicker(wsPingInterval)
	defer pinger.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			return
		case <-pinger.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case f := <-c.out:
			_ = c.ws.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			b, err := json.Marshal(f)
			if err != nil {
				continue
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		}
	}
}
