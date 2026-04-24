// Screenshot capture using Electron's desktopCapturer.
//
// MVP behavior: full-screen captures the primary display, then the
// renderer is expected to crop to the area selected via the overlay
// window. A native Swift helper (Phase 2+) will swap this for a proper
// CGWindowListCreateImage area capture so we don't briefly load a full
// screen into Chromium.

import { desktopCapturer, nativeImage, screen, systemPreferences } from 'electron';

import type { CaptureResult } from '@shared/ipc';

// Human-readable message for the 'denied' case. 'not-determined' does NOT
// use this — that status means the user hasn't seen the permission prompt
// yet, and the cure is to let desktopCapturer.getSources trigger it (NOT
// to bail early with a message the user can't act on).
//
// UI code (status row in compact) can pivot on the substring "Screen
// Recording" to render a "Открыть настройки" shortcut instead of a
// generic error toast.
export const screenRecordingDeniedMessage =
  'Screen Recording запрещён. Открой Системные настройки → Конфиденциальность и безопасность → Запись экрана и включи там Electron (или Druz9 Copilot в прод-билде).';

// checkScreenRecordingPermission returns null when capture is allowed OR
// when macOS hasn't decided yet (so the caller proceeds and lets
// desktopCapturer.getSources trigger the system prompt that adds our app
// to the permission list). Returns a typed Error only on a definitive
// 'denied' — that's the state where the system prompt will NEVER fire
// again and the user must flip the switch in Settings manually.
//
// Why we don't pre-emptively block on 'not-determined': macOS adds an
// app to Privacy → Screen Recording only the first time it attempts a
// capture API that needs the right. Bailing here would mean the app
// never shows up in the list at all — exactly the bug we're fixing
// (2026-04-24). Let Electron's desktopCapturer make the first attempt;
// the OS handles the prompt UX from there.
function checkScreenRecordingPermission(): Error | null {
  if (process.platform !== 'darwin') return null;
  const status = systemPreferences.getMediaAccessStatus('screen');
  switch (status) {
    case 'granted':
    case 'not-determined':
      // 'not-determined' → fall through: getSources() triggers the system
      // prompt that adds us to the permission list.
      return null;
    case 'denied':
    case 'restricted':
    default:
      return new Error(screenRecordingDeniedMessage);
  }
}

// ensureScreenRecordingPrompted is called once at app startup. If macOS
// has never asked the user about Screen Recording for this binary, we
// trigger the prompt NOW — before any stealth window exists — so the
// system dialog is visible and clickable. Once the user picks (Allow or
// Deny), macOS remembers the choice keyed to the binary's code signature
// (or, in dev, the unsigned binary's path + inode).
//
// On 'granted' / 'denied' / 'restricted' we return immediately — nothing
// to do. On 'not-determined' we fire a minimal getSources call whose
// only purpose is the side-effect of showing the prompt; the caller
// doesn't need the result.
//
// Safe to call even if desktopCapturer throws — we swallow errors so
// startup never fails on a capture probe.
export async function ensureScreenRecordingPrompted(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return;
  if (status === 'not-determined') {
    // First run ever — trigger the system prompt. macOS shows it once;
    // if the user dismisses or denies, status flips to 'denied' and
    // we never get another prompt for this binary signature.
    //
    // Why NOT thumbnailSize: 1x1: Electron optimizes away the capture
    // (returns an empty thumbnail from its source-enumeration cache
    // without actually invoking the OS capture API). No capture call
    // means no system prompt. Use 128x128 so the call is real but
    // still negligible — we throw the thumbnail away.
    try {
      await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 128, height: 128 },
      });
    } catch {
      /* prompt is fire-and-forget; any error here is fine */
    }
    return;
  }
  // status === 'denied' | 'restricted'. There is NO programmatic way
  // back into the system prompt — it fires exactly once per binary.
  // We deliberately DO NOT auto-open the Settings pane here: stealing
  // focus at app start is hostile UX. The actual capture handler
  // (captureFullScreen / captureArea) throws screenRecordingDeniedMessage
  // when the user finally tries ⌘⇧A, and the compact's status row
  // renders that message. That's the moment the user cares — not boot.
  // eslint-disable-next-line no-console
  console.warn(
    '[capture] Screen Recording permission denied. User will see an in-app error when attempting capture.',
  );
}

export async function captureFullScreen(): Promise<CaptureResult> {
  const permErr = checkScreenRecordingPermission();
  if (permErr) throw permErr;

  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * 2, height: height * 2 }, // retina
  });
  const primarySource = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  if (!primarySource) {
    // Empty sources on macOS usually means the ScreenCaptureKit path got
    // mis-wired — Electron 33's default flags `ScreenCaptureKitPickerScreen`
    // can route through a system picker that never appears to the user and
    // so never returns. We disable those flags at main/index.ts; if this
    // branch still fires, it's a genuine "no displays" case (rare) and
    // worth surfacing rather than silently returning an empty image.
    throw new Error('desktopCapturer returned no screen sources (check Screen Recording permission)');
  }
  const image = primarySource.thumbnail;
  if (image.isEmpty()) {
    // Another failure mode: ScreenCaptureKit returns a placeholder empty
    // bitmap when permission was revoked between process start and this
    // call. Surface it instead of sending 1×1 transparent PNG to the LLM.
    throw new Error(screenRecordingDeniedMessage);
  }
  return toResult(image);
}

/**
 * Area capture: renderer shows a crosshair overlay, emits the chosen rect,
 * this helper crops a full-screen capture to it. In Phase 3 we'll replace
 * this with a direct native API call.
 */
export async function captureArea(rect: { x: number; y: number; width: number; height: number }): Promise<CaptureResult> {
  const full = await captureFullScreen();
  const fullImage = nativeImage.createFromDataURL(`data:${full.mimeType};base64,${full.dataBase64}`);
  // The overlay reports the rect in logical (CSS) pixels, but the full
  // capture is requested at 2× for retina. Scale the crop to match the
  // raw image space so the output frames exactly the user's selection.
  const primary = screen.getPrimaryDisplay();
  const imgSize = fullImage.getSize();
  const sx = imgSize.width / primary.size.width;
  const sy = imgSize.height / primary.size.height;
  const scaled = {
    x: Math.round(rect.x * sx),
    y: Math.round(rect.y * sy),
    width: Math.max(1, Math.round(rect.width * sx)),
    height: Math.max(1, Math.round(rect.height * sy)),
  };
  const cropped = fullImage.crop(scaled);
  return toResult(cropped);
}

// Max side in pixels for the image we actually send to the LLM. Vision
// models (GPT-4o, Claude, Qwen-VL) internally resize anything larger
// anyway, so sending a raw 3840×2400 retina grab just wastes tokens and
// bandwidth. 1280 keeps text in screenshots legible while cutting the
// base64 payload roughly 6-8× vs. the retina source.
const MAX_IMAGE_SIDE = 1280;

function toResult(image: Electron.NativeImage): CaptureResult {
  const resized = downscale(image, MAX_IMAGE_SIDE);
  const size = resized.getSize();
  const png = resized.toPNG();
  return {
    dataBase64: png.toString('base64'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
  };
}

function downscale(image: Electron.NativeImage, maxSide: number): Electron.NativeImage {
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  if (longest <= maxSide) return image;
  const scale = maxSide / longest;
  return image.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    quality: 'good',
  });
}
