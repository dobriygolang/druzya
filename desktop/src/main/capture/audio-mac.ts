// macOS system-audio capture pipeline.
//
// Spawns the AudioCaptureMac binary (see desktop/native/audio-mac/),
// reads raw 16kHz mono PCM16 from its stdout, accumulates N-second
// chunks, wraps each in a WAV header, and POSTs to /transcription.
// The resulting transcript text is emitted to renderers via an IPC
// event so a live-transcript widget can paint it.
//
// Failure modes we surface clearly to the renderer:
//   - binary missing (dev build without `npm run build:native-mac`);
//   - Screen Recording permission denied;
//   - transcription backend 502 (e.g. GROQ_API_KEY not configured);
//
// Not in scope in this iteration:
//   - Windows path (WASAPI loopback — separate native module);
//   - streaming STT (each chunk is a self-contained batch request);
//   - VAD to skip silent windows (next iteration — saves Groq minutes).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTranscriptionClient } from '../api/transcription';
import type { RuntimeConfig } from '../config/bootstrap';

/** Raw sample rate the Swift binary emits. Keep in sync with the
 *  SCStreamConfiguration.sampleRate value in AudioCapture.swift. */
const SAMPLE_RATE = 16_000;
/** 16-bit mono PCM — matches encodeWAV below and Whisper's preferred
 *  input. `2` is bytes per frame (single channel × 16 bits). */
const BYTES_PER_FRAME = 2;
/** Emit a chunk every N seconds. 5s is the sweet spot for Whisper:
 *  short enough to feel responsive, long enough that overhead
 *  (HTTP, model load) doesn't dominate latency. */
const CHUNK_SECONDS = 5;
const CHUNK_BYTES = SAMPLE_RATE * BYTES_PER_FRAME * CHUNK_SECONDS;

export type AudioCaptureState = 'idle' | 'starting' | 'running' | 'stopping';

export interface AudioCaptureEvents {
  onState: (state: AudioCaptureState) => void;
  /** Each successfully transcribed chunk. Text is the raw delta from
   *  Whisper for that 5s window; caller is expected to concatenate. */
  onTranscript: (text: string, windowSec: number) => void;
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

export interface AudioCaptureController {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  state: () => AudioCaptureState;
  isAvailable: () => boolean;
}

/**
 * Build a controller bound to the given runtime config + event sinks.
 * Only one controller instance per process is expected — call start()
 * / stop() to cycle the capture without reconstructing.
 */
export function createAudioCapture(
  cfg: RuntimeConfig,
  events: AudioCaptureEvents,
): AudioCaptureController {
  const transcriber = createTranscriptionClient(cfg);

  let proc: ChildProcessWithoutNullStreams | null = null;
  let state: AudioCaptureState = 'idle';
  // Explicit Buffer type — TS 5.7 otherwise narrows to
  // Buffer<ArrayBuffer> from alloc(0) and then widens via Buffer.concat
  // to Buffer<ArrayBufferLike>, producing an assignability mismatch.
  let buf: Buffer = Buffer.alloc(0);
  // chunkSeq is incremented only when a chunk's transcription finishes.
  // The `windowSec` event field uses this so the renderer can tell two
  // consecutive chunks apart and paint them as separate lines.
  let chunkSeq = 0;

  const setState = (s: AudioCaptureState) => {
    state = s;
    events.onState(s);
  };

  const transcribeChunk = async (pcm: Buffer) => {
    const wav = encodeWAV(pcm);
    try {
      const result = await transcriber.transcribe({
        audio: new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength),
        mime: 'audio/wav',
        filename: `chunk-${chunkSeq}.wav`,
        language: '',
        prompt: '',
      });
      chunkSeq += 1;
      if (result.text.trim()) {
        events.onTranscript(result.text, CHUNK_SECONDS);
      }
    } catch (err) {
      // Don't kill the capture on a single failed chunk — the next
      // one might succeed (flaky network, Groq 429). Surface it as a
      // non-fatal notice so the renderer can show "connection issue".
      events.onError(err instanceof Error ? err.message : String(err));
    }
  };

  const onPCMData = (chunk: Buffer) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    while (buf.length >= CHUNK_BYTES) {
      const pcm = buf.subarray(0, CHUNK_BYTES);
      buf = buf.subarray(CHUNK_BYTES);
      // Copy the subarray into its own buffer so the async transcribe
      // call doesn't hold a reference into our sliding window.
      const owned = Buffer.from(pcm);
      void transcribeChunk(owned);
    }
  };

  const flushRemainder = async () => {
    // At least 1s of audio worth keeping. Anything shorter is pure
    // filler from a stop-right-after-start click.
    if (buf.length >= SAMPLE_RATE * BYTES_PER_FRAME) {
      const owned = Buffer.from(buf);
      buf = Buffer.alloc(0);
      await transcribeChunk(owned);
    } else {
      buf = Buffer.alloc(0);
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

    proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', onPCMData);

    // stderr carries LEVEL: message lines from the Swift side. We
    // forward ERROR lines to onError and use READY to flip state from
    // starting→running; everything else goes to console for debugging.
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
        if (line.startsWith('ERROR:')) {
          events.onError(line.replace(/^ERROR:\s*/, ''));
        } else if (line.startsWith('READY:')) {
          // Not yet capturing — we still need to send "start\n".
        } else if (line.startsWith('INFO: capture started')) {
          setState('running');
        }
        // eslint-disable-next-line no-console
        console.log('[AudioCaptureMac]', line);
      }
    });

    proc.on('exit', (code, signal) => {
      // eslint-disable-next-line no-console
      console.log('[AudioCaptureMac] exited', { code, signal });
      void flushRemainder().finally(() => {
        proc = null;
        setState('idle');
      });
    });
    proc.on('error', (err) => {
      events.onError(`spawn failed: ${err.message}`);
      proc = null;
      setState('idle');
    });

    // The binary waits for "start\n" before opening the SCStream so
    // the TCC prompt fires from the user's explicit action, not merely
    // from launching the process.
    proc.stdin.write('start\n');
  };

  const stop: AudioCaptureController['stop'] = async () => {
    if (!proc || state === 'idle') return;
    setState('stopping');
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* pipe already closed — the 'exit' handler will clean up */
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
