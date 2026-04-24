// Screenshot capture using Electron's desktopCapturer.
//
// MVP behavior: full-screen captures the primary display, then the
// renderer is expected to crop to the area selected via the overlay
// window. A native Swift helper (Phase 2+) will swap this for a proper
// CGWindowListCreateImage area capture so we don't briefly load a full
// screen into Chromium.

import { desktopCapturer, nativeImage, screen } from 'electron';

import type { CaptureResult } from '@shared/ipc';

export async function captureFullScreen(): Promise<CaptureResult> {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: width * 2, height: height * 2 }, // retina
  });
  const primarySource = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  if (!primarySource) {
    throw new Error('no screen source available');
  }
  const image = primarySource.thumbnail;
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

function toResult(image: Electron.NativeImage): CaptureResult {
  const size = image.getSize();
  const png = image.toPNG();
  return {
    dataBase64: png.toString('base64'),
    mimeType: 'image/png',
    width: size.width,
    height: size.height,
  };
}
