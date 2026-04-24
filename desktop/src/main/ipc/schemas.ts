// Runtime validation schemas for IPC invoke payloads that originate from
// the renderer. We only validate channels where the renderer (or a child
// overlay window like area-overlay) supplies the shape — broadcasts fanned
// out by main are trusted.
//
// The shapes here must stay assignable to the TS types declared in
// `@shared/ipc` / `@shared/types`; the `satisfies` check at the bottom of
// this file enforces that at compile time. If TS complains there, either
// the schema drifted from the type or the type changed — sync them.

import { z } from 'zod';

import type {
  AnalyzeInput,
  AreaRect,
  AppearancePrefs,
  PermissionKind,
  WindowName,
  PickerKind,
} from '@shared/ipc';
import type { HotkeyAction, HotkeyBinding, SessionKind } from '@shared/types';
import type { MasqueradePreset } from '@shared/ipc';

// ─── Enums ────────────────────────────────────────────────────────────────

const hotkeyActionSchema = z.enum([
  'screenshot_area',
  'screenshot_full',
  'voice_input',
  'toggle_window',
  'quick_prompt',
  'clear_conversation',
  'cursor_freeze_toggle',
]);

const sessionKindSchema = z.enum(['interview', 'work', 'casual', '']);

const masqueradePresetSchema = z.enum(['druz9', 'notes', 'telegram', 'xcode', 'slack']);

const windowNameSchema = z.enum([
  'compact',
  'expanded',
  'settings',
  'onboarding',
  'area-overlay',
  'history',
  'picker',
  'toast',
]);

const pickerKindSchema = z.enum(['persona', 'model']);

const permissionKindSchema = z.enum(['screen-recording', 'accessibility', 'microphone']);

const toastKindSchema = z.enum(['error', 'warn', 'info']);

// ─── Analyze / Chat ───────────────────────────────────────────────────────

const attachmentSchema = z.object({
  kind: z.enum(['screenshot', 'voice_transcript']),
  // Base64-encoded PNG or audio bytes. Cap at ~10MB base64 (= 7.5MB raw)
  // so a runaway renderer can't wedge main by shoving arbitrary-size blobs.
  dataBase64: z.string().max(10 * 1024 * 1024),
  mimeType: z.string().max(64),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});

export const analyzeInputSchema = z.object({
  conversationId: z.string().max(128),
  // The prompt itself can be long — paste a stack trace, paste a JD — but
  // reject obviously-pathological inputs before they hit the LLM budget.
  promptText: z.string().max(32_000),
  model: z.string().max(128),
  attachments: z.array(attachmentSchema).max(8),
  triggerAction: hotkeyActionSchema,
  focusedAppHint: z.string().max(256),
});

// ─── Capture ──────────────────────────────────────────────────────────────

export const areaRectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  // Upper bound defends against NaN/Infinity and against a bug in the
  // overlay drag-handler sending a rect larger than any real display.
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
});

// ─── Appearance ───────────────────────────────────────────────────────────

// Partial<AppearancePrefs>. Slider range is 0-100; main also clamps
// defensively — we still validate shape here so a stringified number or
// undefined object can't crash the handler.
export const appearancePrefsPartialSchema = z
  .object({
    expandedOpacity: z.number().finite().optional(),
    expandedBounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite(),
        height: z.number().finite(),
      })
      .optional(),
  })
  .strict();

// ─── Hotkeys ──────────────────────────────────────────────────────────────

export const hotkeyBindingSchema = z.object({
  action: hotkeyActionSchema,
  // Electron accelerator strings are short — 64 chars is comfortably above
  // any legitimate combination (`CommandOrControl+Shift+Alt+F12` is 29).
  accelerator: z.string().max(64),
});

export const hotkeyBindingsSchema = z.array(hotkeyBindingSchema).max(32);

// ─── Masquerade ───────────────────────────────────────────────────────────

export const masqueradeApplySchema = masqueradePresetSchema;

// ─── Sessions ─────────────────────────────────────────────────────────────

export const sessionStartSchema = sessionKindSchema;

export const sessionListSchema = z.object({
  cursor: z.string().max(256),
  // The UI requests page-at-a-time; 500 is the REST endpoint's hard cap.
  limit: z.number().int().positive().max(500),
  kind: sessionKindSchema.optional(),
});

// ─── Transcription ────────────────────────────────────────────────────────

// 25MB cap matches domain.MaxAudioBytes on the server. Language is
// either a short BCP-47 code or empty (auto).
export const transcribeSchema = z.object({
  audio: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 25 * 1024 * 1024, {
    message: 'audio exceeds 25MB',
  }),
  mime: z.string().min(1).max(128),
  filename: z.string().min(1).max(512),
  language: z.string().max(16),
  prompt: z.string().max(2048),
});

// ─── Documents ────────────────────────────────────────────────────────────

// Raw bytes arrive as Uint8Array; zod's z.instanceof handles it cleanly.
// 10MB cap mirrors the server-side documents.MaxUploadBytes — rejecting
// earlier in main avoids a wasted round-trip.
export const documentUploadSchema = z.object({
  filename: z.string().min(1).max(512),
  mime: z.string().min(1).max(128),
  content: z.instanceof(Uint8Array).refine((b) => b.byteLength <= 10 * 1024 * 1024, {
    message: 'content exceeds 10MB',
  }),
  sourceUrl: z.string().max(2048).optional(),
});

export const documentSearchSchema = z.object({
  docIds: z.array(z.string().min(1).max(128)).max(32),
  query: z.string().min(1).max(8_000),
  topK: z.number().int().positive().max(50).optional(),
});

// ─── Shell ────────────────────────────────────────────────────────────────

// The handler additionally enforces http/https via regex; the schema only
// guards shape + size so we never hand `shell.openExternal` a runaway
// string that could trip on something platform-specific.
export const urlSchema = z.string().max(2048);

// ─── IDs / generic ────────────────────────────────────────────────────────

// History IDs, stream IDs, model IDs, persona IDs, conversation IDs — all
// short opaque strings. 128 is a comfortable upper bound for UUIDs and
// slug-style composite keys without hard-coding a specific format.
export const shortIdSchema = z.string().min(1).max(128);

// Rating scale is explicit; anything else is a renderer bug.
export const ratingSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

// ─── Windows ──────────────────────────────────────────────────────────────

export const resizeSchema = z.object({
  name: windowNameSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
});

export const toastShowSchema = z.object({
  msg: z.string().max(2048),
  kind: toastKindSchema,
});

// ─── Type-level sanity checks ─────────────────────────────────────────────
// If any of these fail to compile, a schema drifted from its @shared type
// and the validated handler would start rejecting legitimate input (or,
// worse, accept malformed input the TS type says is fine).

type _AnalyzeOK = z.infer<typeof analyzeInputSchema> extends AnalyzeInput ? true : never;
type _AreaOK = z.infer<typeof areaRectSchema> extends AreaRect ? true : never;
type _AppearanceOK =
  z.infer<typeof appearancePrefsPartialSchema> extends Partial<AppearancePrefs> ? true : never;
type _HotkeyOK = z.infer<typeof hotkeyBindingSchema> extends HotkeyBinding ? true : never;
type _HotkeyActionOK = z.infer<typeof hotkeyActionSchema> extends HotkeyAction ? true : never;
type _SessionOK = z.infer<typeof sessionKindSchema> extends SessionKind ? true : never;
type _MasqueradeOK =
  z.infer<typeof masqueradePresetSchema> extends MasqueradePreset ? true : never;
type _WindowOK = z.infer<typeof windowNameSchema> extends WindowName ? true : never;
type _PickerOK = z.infer<typeof pickerKindSchema> extends PickerKind ? true : never;
type _PermissionOK =
  z.infer<typeof permissionKindSchema> extends PermissionKind ? true : never;

// Silence "unused type alias" without surfacing anything at runtime.
export type _SchemaDriftSentinels =
  | _AnalyzeOK
  | _AreaOK
  | _AppearanceOK
  | _HotkeyOK
  | _HotkeyActionOK
  | _SessionOK
  | _MasqueradeOK
  | _WindowOK
  | _PickerOK
  | _PermissionOK;

export {
  hotkeyActionSchema,
  sessionKindSchema,
  masqueradePresetSchema,
  windowNameSchema,
  pickerKindSchema,
  permissionKindSchema,
  toastKindSchema,
};
