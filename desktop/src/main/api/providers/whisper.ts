// Whisper transcription via OpenAI — BYOK-only.
//
// Voice input is a feature that naturally aligns with BYOK: audio never
// leaves the user's machine except to the chosen provider. We require
// an OpenAI key (Anthropic doesn't offer speech-to-text in their public
// API yet). If there is no key, the renderer keeps the voice button
// disabled with a hint.
//
// The helper sends a multipart/form-data POST to /v1/audio/transcriptions
// and returns the plain transcript string. We ask for text response
// format to avoid JSON-parsing overhead.

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function transcribe(args: {
  apiKey: string;
  audio: Uint8Array;
  mimeType: string;
  language?: string; // ISO-639-1, e.g. "ru". Omit for auto-detect.
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, audio, mimeType, language, signal } = args;

  // FormData + Blob are available in Electron main's undici-backed fetch.
  const form = new FormData();
  form.append('file', new Blob([audio as BlobPart], { type: mimeType }), 'voice.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  if (language) form.append('language', language);

  const resp = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`whisper ${resp.status}: ${text.slice(0, 200)}`);
  }
  // response_format=text returns plain text, no JSON wrapping.
  return (await resp.text()).trim();
}
