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
  const cropped = fullImage.crop(rect);
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
