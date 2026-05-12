// macos.test.ts — TCC probe + prompt routing.
//
// Permissions module isn't stealth itself, но без него Cue не может
// активировать ScreenCaptureKit (для system-audio) или Accessibility
// (для CursorHelper freeze). Regress permission detection и user'у
// показывается "permission required" forever — pre-launch UX killer.
//
// macOS-only path tested implicitly via process.platform shim; на CI
// runner Linux'е первая ветка возвращает all-granted и тест проверяет
// что граничная логика отвечает корректно.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  systemPreferences,
  desktopCapturer,
  shell,
} from 'electron';

import {
  checkPermissions,
  requestPermission,
  openPermissionPane,
} from '../macos';

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  setPlatform(originalPlatform);
  vi.mocked(systemPreferences.getMediaAccessStatus).mockReset();
  vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReset();
  vi.mocked(systemPreferences.askForMediaAccess).mockReset();
  vi.mocked(desktopCapturer.getSources).mockReset();
  vi.mocked(shell.openExternal).mockReset();
});

describe('checkPermissions', () => {
  it('returns granted-everything on non-darwin (linux/win runners)', () => {
    setPlatform('linux');
    expect(checkPermissions()).toEqual({
      screenRecording: 'granted',
      accessibility: 'granted',
      microphone: 'granted',
    });
  });

  it('on darwin combines getMediaAccessStatus + isTrustedAccessibilityClient', () => {
    setPlatform('darwin');
    vi.mocked(systemPreferences.getMediaAccessStatus).mockImplementation(
      (kind: string) => {
        if (kind === 'screen') return 'denied';
        if (kind === 'microphone') return 'granted';
        return 'not-determined';
      },
    );
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(
      false,
    );
    const result = checkPermissions();
    expect(result.screenRecording).toBe('denied');
    expect(result.microphone).toBe('granted');
    expect(result.accessibility).toBe('not-determined');
    // Sanity: probe was NOT a prompting call (false arg).
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(
      false,
    );
  });

  it('returns "granted" accessibility when isTrustedAccessibilityClient is true', () => {
    setPlatform('darwin');
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue(
      'granted',
    );
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(
      true,
    );
    expect(checkPermissions().accessibility).toBe('granted');
  });
});

describe('requestPermission', () => {
  it('no-ops on non-darwin', async () => {
    setPlatform('linux');
    await requestPermission('screen-recording');
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('screen-recording triggers desktopCapturer.getSources (TCC bundle registration)', async () => {
    setPlatform('darwin');
    vi.mocked(desktopCapturer.getSources).mockResolvedValue([]);
    await requestPermission('screen-recording');
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  });

  it('screen-recording swallows getSources rejection (denied still registers bundle)', async () => {
    setPlatform('darwin');
    vi.mocked(desktopCapturer.getSources).mockRejectedValue(
      new Error('denied'),
    );
    // Must not throw — the side-effect (TCC list registration) fires
    // either way.
    await expect(requestPermission('screen-recording')).resolves.toBeUndefined();
  });

  it('accessibility calls isTrustedAccessibilityClient(true) — prompts user', async () => {
    setPlatform('darwin');
    vi.mocked(systemPreferences.isTrustedAccessibilityClient).mockReturnValue(
      false,
    );
    await requestPermission('accessibility');
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(
      true,
    );
  });

  it('microphone calls askForMediaAccess', async () => {
    setPlatform('darwin');
    vi.mocked(systemPreferences.askForMediaAccess).mockResolvedValue(true);
    await requestPermission('microphone');
    expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith(
      'microphone',
    );
  });
});

describe('openPermissionPane', () => {
  it('opens the correct x-apple.systempreferences URL per kind', async () => {
    setPlatform('darwin');
    vi.mocked(shell.openExternal).mockResolvedValue();
    await openPermissionPane('screen-recording');
    expect(shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );

    await openPermissionPane('accessibility');
    expect(shell.openExternal).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    );

    await openPermissionPane('microphone');
    expect(shell.openExternal).toHaveBeenLastCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
  });

  it('no-ops on non-darwin', async () => {
    setPlatform('linux');
    await openPermissionPane('screen-recording');
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
