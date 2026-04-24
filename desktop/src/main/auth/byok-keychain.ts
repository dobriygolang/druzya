// Per-provider BYOK key storage. Keys sit in the OS Keychain under the
// same service as the Druz9 session tokens — different accounts.
//
// The renderer NEVER receives raw key material. This module is used only
// by main-process code that constructs LLM requests on the user's behalf.
// `list()` returns presence booleans and nothing else.

// createRequire — see ../auth/keychain.ts for the rationale.
import { createRequire } from 'node:module';
const keytar = createRequire(import.meta.url)('keytar') as typeof import('keytar');

const SERVICE = 'app.druzya.copilot';

export type ByokProvider = 'openai' | 'anthropic';

const accountName: Record<ByokProvider, string> = {
  openai: 'byok-openai',
  anthropic: 'byok-anthropic',
};

/** Shape validation — catches copy-paste mistakes before the network. */
const keyShape: Record<ByokProvider, RegExp> = {
  // OpenAI keys: "sk-proj-…" or legacy "sk-…", base64-ish payload, min 20 chars.
  openai: /^sk-[A-Za-z0-9_\-]{20,}$/,
  // Anthropic: "sk-ant-api03-…"
  anthropic: /^sk-ant-[A-Za-z0-9_\-]{30,}$/,
};

export function validateKeyShape(provider: ByokProvider, key: string): string | null {
  if (!key) return 'empty key';
  if (!keyShape[provider].test(key.trim())) {
    return `key does not match ${provider} format`;
  }
  return null;
}

export async function saveKey(provider: ByokProvider, key: string): Promise<void> {
  await keytar.setPassword(SERVICE, accountName[provider], key.trim());
}

/** Main-process-only. Never expose over IPC. */
export async function loadKey(provider: ByokProvider): Promise<string | null> {
  return keytar.getPassword(SERVICE, accountName[provider]);
}

export async function deleteKey(provider: ByokProvider): Promise<void> {
  await keytar.deletePassword(SERVICE, accountName[provider]);
}

/** Presence-only snapshot suitable for the renderer. */
export async function listPresence(): Promise<Record<ByokProvider, boolean>> {
  const [o, a] = await Promise.all([loadKey('openai'), loadKey('anthropic')]);
  return { openai: !!o, anthropic: !!a };
}
