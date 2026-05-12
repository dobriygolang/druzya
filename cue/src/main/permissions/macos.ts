// macOS permission helpers. Screen Recording and Accessibility both
// require the user to flip a switch in System Settings before the
// corresponding API starts returning real data; we detect the state via
// systemPreferences and hand-hold the user through opening the right
// pane.

import { desktopCapturer, shell, systemPreferences } from 'electron';

import type { PermissionKind, PermissionState } from '@shared/ipc';

export function checkPermissions(): PermissionState {
  if (process.platform !== 'darwin') {
    return {
      screenRecording: 'granted',
      accessibility: 'granted',
      microphone: 'granted',
    };
  }
  const screenRecording = systemPreferences.getMediaAccessStatus('screen') as PermissionState['screenRecording'];
  const microphone = systemPreferences.getMediaAccessStatus('microphone') as PermissionState['microphone'];
  // isTrustedAccessibilityClient(false) is a pure probe — does not prompt.
  const accessibility = systemPreferences.isTrustedAccessibilityClient(false)
    ? 'granted'
    : 'not-determined';
  return { screenRecording, accessibility, microphone };
}

export async function requestPermission(kind: PermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return;
  switch (kind) {
    case 'screen-recording':
      // macOS has no direct API to trigger the Screen Recording prompt.
      // Calling `desktopCapturer.getSources({ types: ['screen'] })` makes
      // a capture attempt, which is what macOS watches for — first call
      // registers the bundle in
      // System Settings → Privacy → Screen & System Audio Recording and
      // shows the TCC prompt. Without this, clicking "Разрешить" in
      // onboarding silently noops and the app never appears in the
      // system list (you reported this).
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      } catch {
        // Denied/not-determined both throw — that's fine, the side effect
        // (adding the bundle to the TCC list) happens either way.
      }
      return;
    case 'accessibility':
      // Passing true prompts.
      systemPreferences.isTrustedAccessibilityClient(true);
      return;
    case 'microphone':
      await systemPreferences.askForMediaAccess('microphone');
      return;
  }
}

export async function openPermissionPane(kind: PermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return;
  const paths: Record<PermissionKind, string> = {
    'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  };
  await shell.openExternal(paths[kind]);
}
