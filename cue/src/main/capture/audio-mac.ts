// macOS system-audio capture pipeline.
//
// Spawns the AudioCaptureMac binary (see cue/native/audio-mac/),
// reads raw 16kHz mono PCM16 from its stdout, and ships it to the
// transcription backend over a long-lived WebSocket
// (`/ws/transcription/stream`). The server accumulates 1-2s windows
// internally and pushes JSON deltas back; we just stream PCM at a
// steady ~200ms cadence and re-render as deltas arrive.
//
// Failure modes we surface clearly to the renderer:
//   - binary missing (dev build without `npm run build:native-mac`);
//   - Screen Recording / Microphone permission denied;
//   - WS connect failure (after STREAM_RECONNECT_MAX retries we give up
//     for the rest of this capture session and surface an error so the
//     user can stop+restart instead of silent failure).
//
// Not in scope in this iteration:
//   - Windows path (WASAPI loopback — separate native module);
//   - VAD to skip silent windows (server-side now via streaming).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

import {
  createTranscriptionStreamClient,
  type TranscriptionStreamHandle,
} from '../api/transcription';
import type { RuntimeConfig } from '../config/bootstrap';

/** Raw sample rate the Swift binary emits. Keep in sync with the
 *  SCStreamConfiguration.sampleRate value in AudioCapture.swift. */
const SAMPLE_RATE = 16_000;
/** 16-bit mono PCM — single channel × 16 bits = 2 bytes per frame. */
const BYTES_PER_FRAME = 2;

export type AudioCaptureState = 'idle' | 'starting' | 'running' | 'stopping';
export type AudioCaptureSource = 'system' | 'mic';

export interface AudioCaptureEvents {
  onState: (state: AudioCaptureState) => void;
  /** Each successfully transcribed delta from the streaming server.
   *  windowSec is the audio duration covered by the chunk (server-side
   *  windowing, typically 1-2s). isFinal=true marks an end-of-utterance
   *  boundary the renderer should commit; false = preliminary partial.
   *
   *  speakerId — C4 diarization label. For mic source: always 0 (the
   *  user, "Я"). For system source: 1..N clustered по голосам. May be
   *  undefined for backwards-compat / partial frames. */
  onTranscript: (text: string, windowSec: number, isFinal: boolean, speakerId?: number) => void;
  onError: (message: string) => void;
}

/**
 * Resolve the AudioCaptureMac binary path. In dev (electron-vite) we
 * live at cue/out/main/index.js, so __dirname points there and the
 * resources tree is at ../../resources/native. In a packaged app
 * electron-builder copies resources/ to the Contents/Resources path
 * which process.resourcesPath exposes.
 */
function resolveBinaryPath(): string | null {
  const candidates = [
    // Packaged: electron-builder copies cue/resources/native to
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

export interface AudioCaptureController {
  /** Запустить capture (source задан при construct'е, см. createAudioCapture). */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  state: () => AudioCaptureState;
  isAvailable: () => boolean;
}

// Streaming-mode chunk cadence. Server batches into 1-2s windows
// internally — we just want to ship PCM as it lands without holding
// onto it. 200ms = sweet spot: small enough that the server's window
// fills smoothly, large enough that we don't drown in WS frame
// overhead (each frame is ~10 bytes of WS header + payload).
const STREAM_CHUNK_BYTES = Math.floor(SAMPLE_RATE * BYTES_PER_FRAME * 0.2); // 0.2s

// Streaming reconnect schedule. After 3 consecutive failures we give
// up на streaming for the rest of this capture session and surface an
// error to the renderer — рассчитываем что сервер либо не поддерживает
// WS endpoint, либо что-то всерьёз сломано. 200 → 800 → 2400ms.
const STREAM_RECONNECT_MS = [200, 800, 2400] as const;
const STREAM_RECONNECT_MAX = 3;

/**
 * Build a controller bound to the given runtime config + event sinks +
 * fixed audio source. Two controllers may live в одном main процессе
 * (один для system, один для mic) — оба spawn'ят независимые Swift
 * child processes и эмитят свои events.
 */
export function createAudioCapture(
  cfg: RuntimeConfig,
  events: AudioCaptureEvents,
  source: AudioCaptureSource,
): AudioCaptureController {
  const streamClient = createTranscriptionStreamClient(cfg);

  let proc: ChildProcessWithoutNullStreams | null = null;
  let state: AudioCaptureState = 'idle';

  // Streaming state. When `stream` is non-null and isOpen() returns
  // true, all PCM goes through it. After STREAM_RECONNECT_MAX failures
  // we set `streamFailed` and surface an error — there is no fallback.
  let stream: TranscriptionStreamHandle | null = null;
  let streamFailed = false;
  let streamReconnectAttempts = 0;
  let streamSendBuf: Buffer = Buffer.alloc(0);

  const setState = (s: AudioCaptureState) => {
    state = s;
    events.onState(s);
  };

  /**
   * Open a streaming WS to the backend. Returns true on successful
   * open, false on any failure. Wraps the streamClient.connect() Promise
   * with a 3s open-timeout — we don't want the user staring at a silent
   * transcript while a half-broken WS handshake hangs.
   */
  const connectStream = async (): Promise<boolean> => {
    if (streamFailed) return false;
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };
      const openTimeout = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.warn(`[AudioCaptureMac:${source}] WS open timeout`);
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
                // Diarization (C4): backend tags each final delta с speaker_id.
                // Mic source server-side всегда speaker_id=0 (omitempty drops
                // его на wire), system source = 1..N. Если поле отсутствует
                // (старый сервер / partial frame), пробрасываем undefined —
                // renderer fall back'нётся на source-based label.
                const speakerId = typeof msg.speaker_id === 'number' ? msg.speaker_id : undefined;
                events.onTranscript(text, dur, msg.type === 'final', speakerId);
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
          // C4 diarization: backend uses source param to route speaker
          // labels. mic → always speaker 0 ("Я"), system → 1..N clustered.
          source,
        },
      )
        .then((handle) => {
          if (!handle) {
            // No valid session — surface so the user can re-login.
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
   * Fire-and-forget reconnect after an unexpected close. Schedules the
   * next attempt with exp backoff; flips streamFailed once
   * STREAM_RECONNECT_MAX is exhausted, after which we surface an error
   * to the renderer so the user knows transcription is dead.
   */
  const tryReconnectStream = () => {
    if (streamFailed) return;
    if (streamReconnectAttempts >= STREAM_RECONNECT_MAX) {
      streamFailed = true;
      // eslint-disable-next-line no-console
      console.warn(`[AudioCaptureMac:${source}] streaming gave up after ${STREAM_RECONNECT_MAX} attempts`);
      events.onError(`Транскрипция оборвана после ${STREAM_RECONNECT_MAX} попыток reconnect'а. Останови и запусти заново.`);
      return;
    }
    const delayMs = STREAM_RECONNECT_MS[streamReconnectAttempts];
    streamReconnectAttempts += 1;
    setTimeout(() => {
      if (state !== 'running') return;
      void connectStream();
    }, delayMs);
  };

  const onPCMData = (chunk: Buffer) => {
    // No streaming socket yet (still opening) or it failed → drop
    // chunks. We deliberately don't buffer: stale audio in a live
    // transcript is worse than a small gap.
    if (!stream || !stream.isOpen()) return;

    streamSendBuf = streamSendBuf.length === 0 ? chunk : Buffer.concat([streamSendBuf, chunk]);
    while (streamSendBuf.length >= STREAM_CHUNK_BYTES) {
      const slice = streamSendBuf.subarray(0, STREAM_CHUNK_BYTES);
      try {
        stream.send(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength));
      } catch { /* socket closed mid-send — onClose handles */ }
      streamSendBuf = Buffer.from(streamSendBuf.subarray(STREAM_CHUNK_BYTES));
    }
  };

  /**
   * Flush whatever PCM tail is left in streamSendBuf and signal the
   * server to close the current window. Called on Swift-emitted
   * BOUNDARY (semantic cut from VAD) and on stop().
   */
  const flushStream = (reason: 'boundary' | 'stop') => {
    if (!stream || !stream.isOpen()) return;
    if (streamSendBuf.length > 0) {
      try {
        stream.send(new Uint8Array(streamSendBuf.buffer, streamSendBuf.byteOffset, streamSendBuf.byteLength));
      } catch { /* socket closed mid-send — onClose will handle */ }
      streamSendBuf = Buffer.alloc(0);
    }
    try {
      stream.sendCtl({ type: reason === 'stop' ? 'reset' : 'final' });
    } catch { /* noop */ }
  };

  const start: AudioCaptureController['start'] = async () => {
    if (state !== 'idle') return;

    const bin = resolveBinaryPath();
    if (!bin) {
      events.onError(
        'AudioCaptureMac binary not found. Run `cd cue/native/audio-mac && ./build.sh`.',
      );
      return;
    }

    setState('starting');
    streamSendBuf = Buffer.alloc(0);
    streamFailed = false;
    streamReconnectAttempts = 0;
    // mkdir kept for future raw-PCM recording (debug aid). Currently no
    // chunks are written — streaming-only path doesn't materialise WAVs
    // to disk; if we need them again, hook into onPCMData.
    const recordingDir = join(
      app.getPath('userData'),
      'recordings',
      source,
      `meeting-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    );
    await mkdir(recordingDir, { recursive: true });

    // Open the stream BEFORE spawning Swift so the first PCM chunks land
    // on a ready socket. We still tolerate a slow open (3s timeout in
    // connectStream) — chunks during that window are dropped, which is
    // acceptable for a 200ms cadence.
    void connectStream().then((ok) => {
      if (!ok) {
        streamFailed = true;
        events.onError('Не удалось открыть streaming WS. Останови и запусти заново.');
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
    // mode: BOUNDARY=signal server to flush window, ERROR=surface,
    // INFO=state.
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
          flushStream('boundary');
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
      flushStream('stop');
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
      flushStream('stop');
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
