// Desktop wrapper for POST /api/v1/transcription. The audio crosses the
// IPC boundary as a Uint8Array (zero-copy via transferable buffers);
// main assembles multipart/form-data here and POSTs to the backend
// with the user's bearer from keychain.

import { getValidSession } from '../auth/refresh';
import type { RuntimeConfig } from '../config/bootstrap';

export interface TranscribeInput {
  /** Raw audio bytes. webm/opus from MediaRecorder is the default. */
  audio: Uint8Array;
  mime: string;
  filename: string;
  /** BCP-47 hint ("ru", "en"). Empty string = provider auto-detect. */
  language: string;
  /** Optional bias phrase for domain vocabulary. */
  prompt: string;
}

export interface TranscribeResult {
  text: string;
  language: string;
  duration: number;
}

export interface TranscriptionClient {
  transcribe: (input: TranscribeInput) => Promise<TranscribeResult>;
}

export function createTranscriptionClient(cfg: RuntimeConfig): TranscriptionClient {
  const url = (p: string) => `${cfg.apiBaseURL.replace(/\/+$/, '')}${p}`;

  return {
    transcribe: async (input) => {
      const s = await getValidSession({ apiBaseURL: cfg.apiBaseURL });
      const headers: Record<string, string> = {};
      if (s) headers.Authorization = `Bearer ${s.accessToken}`;

      // Node 20 has global FormData + Blob. The Uint8Array's underlying
      // ArrayBuffer may be a SharedArrayBuffer (TS widens it since 5.7);
      // slice() always returns a plain ArrayBuffer, which matches the
      // Blob constructor's BlobPart signature.
      const form = new FormData();
      const ab = input.audio.buffer.slice(
        input.audio.byteOffset,
        input.audio.byteOffset + input.audio.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: input.mime || 'audio/webm' });
      form.append('audio', blob, input.filename || 'audio.webm');
      if (input.language) form.append('language', input.language);
      if (input.prompt) form.append('prompt', input.prompt);

      const resp = await fetch(url('/api/v1/transcription'), {
        method: 'POST',
        headers, // fetch sets multipart boundary automatically; don't override Content-Type.
        body: form,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`POST /transcription: ${resp.status} ${text.slice(0, 200)}`);
      }
      const raw = (await resp.json()) as Record<string, unknown>;
      return {
        text: String(raw.text ?? ''),
        language: String(raw.language ?? ''),
        duration: Number(raw.duration ?? 0),
      };
    },
  };
}
