// macOS system-audio capture pipeline.
//
// Spawns the AudioCaptureMac binary (see desktop/native/audio-mac/),
// reads raw 16kHz mono PCM16 from its stdout, and ships it to the
// transcription backend. The default ship path is a long-lived
// WebSocket (`/ws/transcription/stream`) — server accumulates 1-2s
// windows and pushes JSON deltas back. On WS connect failure, we
// fall back to the legacy batch endpoint (`POST /transcription`)
// which wraps each VAD-delimited chunk in WAV and round-trips
// through Whisper.
//
// Failure modes we surface clearly to the renderer:
//   - binary missing (dev build without `npm run build:native-mac`);
//   - Screen Recording permission denied;
//   - transcription backend 502 (e.g. GROQ_API_KEY not configured);
//   - WS connect failure → silent fallback to batch (logged to console).
//
// Not in scope in this iteration:
//   - Windows path (WASAPI loopback — separate native module);
//   - VAD to skip silent windows (next iteration — saves Groq minutes).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

import {
  createTranscriptionClient,
  createTranscriptionStreamClient,
  HttpClientError,
  type TranscriptionStreamHandle,
} from '../api/transcription';
import type { RuntimeConfig } from '../config/bootstrap';

/** Raw sample rate the Swift binary emits. Keep in sync with the
 *  SCStreamConfiguration.sampleRate value in AudioCapture.swift. */
const SAMPLE_RATE = 16_000;
/** 16-bit mono PCM — matches encodeWAV below and Whisper's preferred
 *  input. `2` is bytes per frame (single channel × 16 bits). */
const BYTES_PER_FRAME = 2;

// VAD-driven chunking replaces the old fixed-5s scheme. Swift emits
// PCM only while RMS > threshold and writes "BOUNDARY\n" on stderr
// when a ≥600ms silence ends an utterance. We flush on boundary for
// semantic cuts; a hard ceiling prevents a single long utterance
// from growing past Whisper's comfort zone.
// Снижено для более плотного realtime feel'а: max 1.5s вместо 3s.
// Whisper-turbo обрабатывает 1.5s chunk за ~400-700ms на Groq → юзер
// видит транскрипт каждую ~2s. min 0.5s — чтобы не слать миллисекундные
// фрагменты на каждый пик RMS.
const MIN_CHUNK_BYTES = SAMPLE_RATE * BYTES_PER_FRAME / 2; // 0.5s minimum
const MAX_CHUNK_BYTES = Math.floor(SAMPLE_RATE * BYTES_PER_FRAME * 1.5); // 1.5s hard cap

export type AudioCaptureState = 'idle' | 'starting' | 'running' | 'stopping';
export type AudioCaptureSource = 'system' | 'mic';

export interface AudioCaptureEvents {
  onState: (state: AudioCaptureState) => void;
  /** Each successfully transcribed chunk. Text is the raw delta from
   *  Whisper for that VAD-delimited utterance; caller is expected to
   *  concatenate. windowSec is the audio duration of the chunk (1-3s
   *  depending on where the boundary fell). */
  onTranscript: (text: string, windowSec: number, isFinal: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Resolve the AudioCaptureMac binary path. In dev (electron-vite) we
 * live at desktop/out/main/index.js, so __dirname points there and the
 * resources tree is at ../../resources/native. In a packaged app
 * electron-builder copies resources/ to the Contents/Resources path
 * which process.resourcesPath exposes.
 */
function resolveBinaryPath(): string | null {
  const candidates = [
    // Packaged: electron-builder copies desktop/resources/native to
    // app.app/Contents/Resources/native via `extraResources`.
    join(process.resourcesPath ?? '', 'native', 'AudioCaptureMac'),
    // Dev: out/main/index.js → ../../resources/native.
    join(__dirname, '..', '..', 'resources', 'native', 'AudioCaptureMac'),
    // Hot-run via electron-vite dev: src/main lives at project root.
    join(process.cwd(), 'resources', 'native', 'AudioCaptureMac'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/**
 * Construct a minimal WAV header for a mono 16kHz PCM16 buffer.
 * Whisper (via Groq) accepts raw WAV without any extra chunks.
 * See https://docs.fileformat.com/audio/wav/.
 */
function encodeWAV(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * BYTES_PER_FRAME;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4); // file size - 8
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_FRAME, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// computeRMS — root-mean-square amplitude для 16-bit signed mono PCM.
// Returns 0..32767. Используется в transcribeChunk для skip'а silence-
// chunk'ов до того как они уйдут в Whisper (избегаем hallucinations
// «Субтитры делал DimaTorzok» которые модель генерит на тишине).
//
// O(n), но n = 1-3s аудио = 32-96kB — несколько микросекунд, не bottleneck.
function computeRMS(pcm: Buffer): number {
  const samples = pcm.length / 2;
  if (samples === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i);
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / samples);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Exp-backoff schedule for transcription 429s: 500 → 1000 → 2000 → 4000ms.
// 4 entries = up to 3 retries (first attempt is not part of this array).
// Total worst-case wall time: ~7.5s before we give up — still inside the
// chunk-arrival cadence, so the next chunk's retries don't pile up.
const TRANSCRIBE_BACKOFF_MS = [500, 1000, 2000, 4000] as const;
const TRANSCRIBE_MAX_RETRIES = 3;

export interface AudioCaptureController {
  /** Запустить capture (source задан при construct'е, см. createAudioCapture). */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  state: () => AudioCaptureState;
  isAvailable: () => boolean;
}

/**
 * Build a controller bound to the given runtime config + event sinks +
 * fixed audio source. Two controllers may live в одном main процессе
 * (один для system, один для mic) — оба spawn'ят независимые Swift
 * child processes и эмитят свои events.
 */
// Streaming-mode chunk cadence. Server batches into 1-2s windows
// internally — we just want to ship PCM as it lands without holding
// onto it. 200ms = sweet spot: small enough that the server's window
// fills smoothly, large enough that we don't drown in WS frame
// overhead (each frame is ~10 bytes of WS header + payload).
const STREAM_CHUNK_BYTES = Math.floor(SAMPLE_RATE * BYTES_PER_FRAME * 0.2); // 0.2s

// Streaming reconnect schedule. After 3 consecutive failures we give
// up на streaming and fall back permanently на batch endpoint for
// the rest of this capture session — рассчитываем что сервер просто
// не поддерживает WS endpoint (older deployment). 200 → 800 → 2400ms.
const STREAM_RECONNECT_MS = [200, 800, 2400] as const;
const STREAM_RECONNECT_MAX = 3;

export function createAudioCapture(
  cfg: RuntimeConfig,
  events: AudioCaptureEvents,
  source: AudioCaptureSource,
): AudioCaptureController {
  const transcriber = createTranscriptionClient(cfg);
  const streamClient = createTranscriptionStreamClient(cfg);

  let proc: ChildProcessWithoutNullStreams | null = null;
  let state: AudioCaptureState = 'idle';
  // Explicit Buffer type — TS 5.7 otherwise narrows to
  // Buffer<ArrayBuffer> from alloc(0) and then widens via Buffer.concat
  // to Buffer<ArrayBufferLike>, producing an assignability mismatch.
  let buf: Buffer = Buffer.alloc(0);
  let recordingDir: string | null = null;
  // chunkSeq is incremented only when a chunk's transcription finishes.
  // The `windowSec` event field uses this so the renderer can tell two
  // consecutive chunks apart and paint them as separate lines.
  let chunkSeq = 0;

  // Streaming state. When `stream` is non-null and isOpen() returns
  // true, all PCM goes through it; otherwise we fall back to the batch
  // transcribeChunk path. `streamFallback` flips permanently after
  // STREAM_RECONNECT_MAX failures — we stop trying streaming for the
  // rest of this capture session.
  let stream: TranscriptionStreamHandle | null = null;
  let streamFallback = false;
  let streamReconnectAttempts = 0;
  let streamSendBuf: Buffer = Buffer.alloc(0);

  const setState = (s: AudioCaptureState) => {
    state = s;
    events.onState(s);
  };

  /**
   * Open a streaming WS to the backend. Returns true on successful
   * open, false on any failure (in which case the caller should fall
   * back to the batch path). Wraps the streamClient.connect() Promise
   * with a 3s open-timeout — we don't want the user staring at a
   * silent transcript while a half-broken WS handshake hangs.
   */
  const connectStream = async (): Promise<boolean> => {
    if (streamFallback) return false;
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };
      const openTimeout = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn(`[AudioCaptureMac:${source}] WS open timeout, falling back to batch`);
        try { stream?.close(1006, 'open-timeout'); } catch { /* noop */ }
        stream = null;
        settle(false);
      }, 3000);

      streamClient.connect(
        {
          onOpen: () => {
            clearTimeout(openTimeout);
            streamReconnectAttempts = 0;
            // eslint-disable-next-line no-console
            console.log(`[AudioCaptureMac:${source}] streaming WS open`);
            settle(true);
          },
          onMessage: (msg) => {
            switch (msg.type) {
              case 'final':
              case 'partial': {
                const text = msg.text?.trim() ?? '';
                if (!text) return;
                const dur = typeof msg.duration === 'number' ? msg.duration : 0;
                events.onTranscript(text, dur, msg.type === 'final');
                chunkSeq += 1;
                return;
              }
              case 'error':
                // Server-side hiccup on a single window — log but don't
                // surface to UI (would spam during transient failures).
                // eslint-disable-next-line no-console
                console.warn(`[AudioCaptureMac:${source}] stream warning: ${msg.message ?? ''}`);
                return;
              case 'pong':
                return;
            }
          },
          onClose: (code, reason) => {
            clearTimeout(openTimeout);
            stream = null;
            // eslint-disable-next-line no-console
            console.log(`[AudioCaptureMac:${source}] stream closed`, { code, reason });
            // Clean close (1000) when WE called close() during stop();
            // server close (1005/1006/1011 etc) → reconnect attempt.
            if (state === 'running' && code !== 1000) {
              tryReconnectStream();
            }
            settle(false);
          },
          onError: (err) => {
            // Surface only if we never even opened — once running, error
            // events fire in tandem with close, no need to double-log.
            // eslint-disable-next-line no-console
            console.warn(`[AudioCaptureMac:${source}] stream transport error:`, err.message);
          },
        },
        {
          language: cfg.defaultLocale || 'ru',
          prompt:
            cfg.defaultLocale === 'en'
              ? 'Live meeting transcript. Technical discussion: software, AI, code.'
              : 'Запись встречи: технический разговор о софте, AI, коде, druzya, druz9, copilot, Hone, Cue.',
        },
      )
        .then((handle) => {
          if (!handle) {
            // No valid session — caller falls back to batch which
            // handles 401 itself (refresh path).
            clearTimeout(openTimeout);
            settle(false);
            return;
          }
          stream = handle;
        })
        .catch((err: unknown) => {
          clearTimeout(openTimeout);
          // eslint-disable-next-line no-console
          console.warn(`[AudioCaptureMac:${source}] stream connect failed:`, err instanceof Error ? err.message : String(err));
          settle(false);
        });
    });
  };

  /**
   * Fire-and-forget reconnect after an unexpected close. Schedules
   * the next attempt with exp backoff; flips streamFallback once
   * STREAM_RECONNECT_MAX is exhausted, after which all subsequent
   * audio goes through the batch path until stop() resets state.
   */
  const tryReconnectStream = () => {
    if (streamFallback) return;
    if (streamReconnectAttempts >= STREAM_RECONNECT_MAX) {
      streamFallback = true;
      // eslint-disable-next-line no-console
      console.warn(`[AudioCaptureMac:${source}] streaming gave up after ${STREAM_RECONNECT_MAX} attempts, batch fallback active`);
      return;
    }
    const delayMs = STREAM_RECONNECT_MS[streamReconnectAttempts];
    streamReconnectAttempts += 1;
    setTimeout(() => {
      if (state !== 'running') return;
      void connectStream();
    }, delayMs);
  };

  const transcribeChunk = async (pcm: Buffer) => {
    const wav = encodeWAV(pcm);
    const windowSec = pcm.length / (SAMPLE_RATE * BYTES_PER_FRAME);
    const seq = chunkSeq;

    // Silence-pre-filter: считаем RMS на 16-bit mono PCM. Если ниже
    // порога — chunk почти пустой, Whisper на нём всё равно
    // hallucinate'нёт классику («Субтитры делал DimaTorzok»). Skip
    // экономит API-call + предотвращает поток мусора в renderer.
    // Threshold 200 — ~ -42dBFS, эмпирически: тихая речь ~ RMS 1000+,
    // тишина в комнате ~ 30-150.
    const rms = computeRMS(pcm);
    if (rms < 200) {
      chunkSeq += 1;
      return;
    }
    if (recordingDir) {
      void writeFile(join(recordingDir, `chunk-${seq.toString().padStart(4, '0')}.wav`), wav).catch((err) => {
        events.onError(`failed to save local recording chunk: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    // Retry loop: 429 (rate-limited) is the common failure mode under
    // burst load — Groq permit pool is per-second and a long meeting
    // can produce 2-3 chunks/sec from system+mic combined. We retry up
    // to TRANSCRIBE_MAX_RETRIES times with exp backoff; if the server
    // sent a Retry-After header we honor it (clamped to keep us inside
    // the same chunk's life expectancy).
    //
    // Importantly, this Promise is fired by `void transcribeChunk(...)`
    // and never awaited at the caller — capture loop continues
    // accepting new PCM in parallel with the retry sleeps, so a slow
    // chunk never blocks fresh ones.
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt <= TRANSCRIBE_MAX_RETRIES) {
      try {
        const result = await transcriber.transcribe({
          audio: new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength),
          mime: 'audio/wav',
          filename: `chunk-${seq}.wav`,
          // Hint Whisper языком явно — без подсказки на 1-2 секундных
          // chunk'ах модель ловит "Russian с английским акцентом" и
          // подставляет рандомные слова. cfg.defaultLocale выставляется
          // через DRUZ9_DEFAULT_LOCALE (default 'ru'); юзер-override
          // приедет когда сделаем Settings → Voice locale.
          language: cfg.defaultLocale || 'ru',
          // Prompt — bias к domain-vocab. Whisper использует первые ~224
          // токена prompt'а как "вы только что слышали это" контекст.
          // Обозначаем что речь — meeting, технический разговор; помогает
          // не превращать «Druz9» в «другие», «копилот» в «копилку», etc.
          prompt: cfg.defaultLocale === 'en'
            ? 'Live meeting transcript. Technical discussion: software, AI, code.'
            : 'Запись встречи: технический разговор о софте, AI, коде, druzya, druz9, copilot, Hone, Cue.',
        });
        chunkSeq += 1;
        if (result.text.trim()) {
          // Whisper-pipeline: каждый chunk = одна final-фраза по
          // определению (мы уже flush'нули по boundary-VAD'у). Apple
          // pipeline эмитит partials отдельно (см. ниже).
          events.onTranscript(result.text, windowSec, true);
        }
        return; // success — exit the retry loop
      } catch (err) {
        lastErr = err;
        // Only retry on 429. Other 4xx (auth, validation) won't fix
        // themselves and will just burn quota; 5xx may be transient
        // but we don't have a way to distinguish "DB hiccup" from
        // "config bug" so we conservatively don't retry those either.
        const isRateLimit = err instanceof HttpClientError && err.status === 429;
        if (!isRateLimit || attempt >= TRANSCRIBE_MAX_RETRIES) break;

        // Server hint takes priority. Clamp to 8s — beyond that the
        // chunk is no longer "live" enough to be useful in the live
        // transcript, and we're better off dropping it.
        const serverRetryMs = err instanceof HttpClientError
          ? Math.min(err.retryAfterSeconds * 1000, 8000)
          : 0;
        const backoffMs = serverRetryMs > 0
          ? serverRetryMs
          : TRANSCRIBE_BACKOFF_MS[attempt];
        // eslint-disable-next-line no-console
        console.log(
          `[AudioCaptureMac:${source}] transcription rate-limited, ` +
          `backing off ${backoffMs}ms (attempt ${attempt + 1}/${TRANSCRIBE_MAX_RETRIES})`,
        );
        await sleep(backoffMs);
        attempt += 1;
      }
    }
    // All retries exhausted (or terminal non-429 error). Drop chunk
    // silently — surfacing it would spam the renderer with "connection
    // issue" toasts during a long Groq incident; the next chunk will
    // try again. We still bump seq so the renderer's chunkSeq grows
    // monotonically (no holes that look like state bugs).
    chunkSeq += 1;
    if (lastErr instanceof HttpClientError && lastErr.status === 429) {
      // eslint-disable-next-line no-console
      console.warn(
        `[AudioCaptureMac:${source}] transcription dropped after ${TRANSCRIBE_MAX_RETRIES} retries (429)`,
      );
    } else if (lastErr) {
      // Non-429: surface ONCE per chunk so the user sees real backend/
      // network problems (auth expired, DNS down, etc.). Same UX as
      // before for non-rate-limit failures.
      events.onError(lastErr instanceof Error ? lastErr.message : String(lastErr));
    }
  };

  const flushBuffer = (reason: 'boundary' | 'max' | 'stop') => {
    // Streaming mode: don't ship batched WAV; just signal the boundary
    // so server knows to flush its current window. The pending PCM
    // is already in flight (chunked at STREAM_CHUNK_BYTES).
    if (stream && stream.isOpen()) {
      // Flush whatever tail bytes remain in the streaming buf.
      if (streamSendBuf.length > 0) {
        try {
          stream.send(new Uint8Array(streamSendBuf.buffer, streamSendBuf.byteOffset, streamSendBuf.byteLength));
        } catch { /* socket closed mid-send — onClose will handle */ }
        streamSendBuf = Buffer.alloc(0);
      }
      if (reason !== 'max') {
        try {
          stream.sendCtl({ type: reason === 'stop' ? 'reset' : 'final' });
        } catch { /* noop */ }
      }
      // Clear batch buf — we never accumulated for batch in this mode.
      buf = Buffer.alloc(0);
      return;
    }
    // Batch fallback path — original behaviour.
    if (buf.length < MIN_CHUNK_BYTES) {
      // Too short to be a useful utterance. Discard on stop (stop
      // click right after start); keep on boundary (next boundary
      // may extend it further); keep on max (shouldn't happen —
      // we're below min but max triggered, probably a buggy event).
      if (reason === 'stop') buf = Buffer.alloc(0);
      return;
    }
    const owned = Buffer.from(buf);
    buf = Buffer.alloc(0);
    void transcribeChunk(owned);
  };

  const onPCMData = (chunk: Buffer) => {
    // Streaming path — chunked send at ~200ms cadence to keep WS
    // throughput steady but not noisy. Server batches to its own
    // 1-2s window; we just need to ship.
    if (stream && stream.isOpen()) {
      streamSendBuf = streamSendBuf.length === 0 ? chunk : Buffer.concat([streamSendBuf, chunk]);
      while (streamSendBuf.length >= STREAM_CHUNK_BYTES) {
        const slice = streamSendBuf.subarray(0, STREAM_CHUNK_BYTES);
        try {
          stream.send(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength));
        } catch { /* socket closed mid-send — onClose handles */ }
        streamSendBuf = Buffer.from(streamSendBuf.subarray(STREAM_CHUNK_BYTES));
      }
      // Local recording continuation in streaming mode (debug aid).
      if (recordingDir) {
        // Light-touch: only if user has set a recording dir; we keep
        // the same wav-chunk-NNNN convention as batch but without the
        // pre-chunk WAV header (raw PCM). Skipped for MVP to avoid
        // fan-out: streaming + raw-PCM recording can be added later.
      }
      return;
    }
    // Batch fallback — original VAD-window accumulation.
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    if (buf.length >= MAX_CHUNK_BYTES) {
      flushBuffer('max');
    }
  };

  const start: AudioCaptureController['start'] = async () => {
    if (state !== 'idle') return;

    const bin = resolveBinaryPath();
    if (!bin) {
      events.onError(
        'AudioCaptureMac binary not found. Run `cd desktop/native/audio-mac && ./build.sh`.',
      );
      return;
    }

    setState('starting');
    chunkSeq = 0;
    buf = Buffer.alloc(0);
    streamSendBuf = Buffer.alloc(0);
    streamFallback = false;
    streamReconnectAttempts = 0;
    recordingDir = join(
      app.getPath('userData'),
      'recordings',
      source,
      `meeting-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    );
    await mkdir(recordingDir, { recursive: true });

    // Try streaming first. Fire-and-forget: if it opens, onPCMData will
    // notice stream.isOpen() === true and route audio that way; if it
    // never opens (timeout / 401 / server doesn't expose endpoint),
    // streamFallback flips and we silently use the batch path. We do
    // NOT await — Swift binary spawn happens in parallel so the user
    // doesn't pay 3s open-timeout latency on top of TCC prompts.
    void connectStream().then((ok) => {
      if (!ok) {
        streamFallback = true;
        // eslint-disable-next-line no-console
        console.log(`[AudioCaptureMac:${source}] streaming unavailable, using batch endpoint`);
      }
    });

    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Safety net: если в течение 5s после spawn'а Swift не успел крикнуть
    // INFO: capture started / mic capture started — значит он залип на TCC
    // prompt'е (Microphone / Screen Recording denied или notDetermined).
    // Без watchdog'а UI оставался бы в state='starting' навсегда.
    let startWatchdog: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (state === 'starting') {
        const what = source === 'system'
          ? 'системному звуку (Screen Recording)'
          : 'микрофону (Microphone)';
        events.onError(`Не удалось получить доступ к ${what}. macOS должен был показать запрос — разреши и нажми снова.`);
        try { proc?.kill('SIGTERM'); } catch { /* already dead */ }
        proc = null;
        setState('idle');
      }
      startWatchdog = null;
    }, 5000);

    proc.stdout.on('data', onPCMData);

    // stderr carries LEVEL: message lines from the Swift side. PCM stream
    // mode: BOUNDARY=flush chunk to Whisper, ERROR=surface, INFO=state.
    let stderrBuf = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (s: string) => {
      stderrBuf += s;
      let nl = stderrBuf.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuf.slice(0, nl).trim();
        stderrBuf = stderrBuf.slice(nl + 1);
        nl = stderrBuf.indexOf('\n');
        if (!line) continue;
        if (line === 'BOUNDARY') {
          flushBuffer('boundary');
          continue;
        }
        if (line.startsWith('ERROR:')) {
          events.onError(line.replace(/^ERROR:\s*/, ''));
          if (state === 'starting') {
            if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
            try { proc?.kill('SIGTERM'); } catch { /* already dead */ }
            proc = null;
            setState('idle');
          }
        } else if (line.startsWith('READY:')) {
          // Not yet capturing — we still need to send the start command.
        } else if (line.startsWith('INFO: capture started') || line.startsWith('INFO: mic capture started')) {
          if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
          setState('running');
        }
        // eslint-disable-next-line no-console
        console.log(`[AudioCaptureMac:${source}]`, line);
      }
    });

    proc.on('exit', (code, signal) => {
      // eslint-disable-next-line no-console
      console.log('[AudioCaptureMac] exited', { code, signal });
      if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
      flushBuffer('stop');
      proc = null;
      setState('idle');
    });
    proc.on('error', (err) => {
      if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
      events.onError(`spawn failed: ${err.message}`);
      proc = null;
      setState('idle');
    });

    // The binary waits for command before opening the stream so the TCC
    // prompt fires from the user's explicit action, not merely from
    // launching the process. Source задан при construct'е controller'а
    // (не выбирается runtime'ом) — это инвариант class'а.
    if (source === 'system') {
      proc.stdin.write('start-apple\n');
    } else {
      proc.stdin.write('start-mic\n');
    }
  };

  const stop: AudioCaptureController['stop'] = async () => {
    if (!proc || state === 'idle') return;
    setState('stopping');
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* pipe already closed — the 'exit' handler will clean up */
    }
    // Tear the streaming WS down cleanly first. We send any tail PCM
    // (in case the user cut off mid-utterance) and a `reset` ctl frame
    // so the server flushes its window before close. Then a clean 1000
    // close prevents tryReconnectStream from kicking in (it's gated
    // on code !== 1000).
    if (stream) {
      if (streamSendBuf.length > 0) {
        try {
          stream.send(new Uint8Array(streamSendBuf.buffer, streamSendBuf.byteOffset, streamSendBuf.byteLength));
        } catch { /* noop */ }
        streamSendBuf = Buffer.alloc(0);
      }
      try { stream.sendCtl({ type: 'reset' }); } catch { /* noop */ }
      try { stream.close(1000, 'capture stopped'); } catch { /* noop */ }
      stream = null;
    }
    // Give it 2s to drain; if it doesn't exit, SIGTERM.
    const p = proc;
    setTimeout(() => {
      if (p && !p.killed) p.kill('SIGTERM');
    }, 2000);
  };

  return {
    start,
    stop,
    state: () => state,
    isAvailable: () => resolveBinaryPath() !== null,
  };
}
