// macOS permission helpers. Screen Recording and Accessibility both
// require the user to flip a switch in System Settings before the
// corresponding API starts returning real data; we detect the state via
// systemPreferences and hand-hold the user through opening the right
// pane.

import { shell, systemPreferences } from 'electron';

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
      // There is no API to trigger the Screen Recording prompt directly —
      // the OS only shows it when a capture attempt is made. We do a
      // throwaway capture via desktopCapturer.getSources in the caller,
      // which nudges the OS into displaying its dialog.
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
