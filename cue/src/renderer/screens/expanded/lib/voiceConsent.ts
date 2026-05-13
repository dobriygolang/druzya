// Voice consent gate.
//
// При первом нажатии «Слушать»/«Микрофон» показываем юзеру disclaimer
// что аудио уйдёт на сервер (Groq Whisper) для транскрипции и что
// записывать собеседников по Zoom/Meet без их согласия — на его
// ответственности (legal risk: GDPR EU, two-party consent в CA/IL).
// После accept — флаг в localStorage, больше не показываем.
//
// Используем native window.confirm (Electron показывает OS-modal),
// чтобы не плодить React-state для одноразового вопроса. Confirm
// блокирующий — запись стартует только после OK; на Cancel — no-op.

const VOICE_CONSENT_KEY = 'cue.voiceConsent.granted.v1';

export function hasVoiceConsent(): boolean {
  try {
    return window.localStorage.getItem(VOICE_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function requestVoiceConsent(onAccept: () => void): void {
  const ok = window.confirm(
    'Cue будет передавать аудио на сервер для транскрипции (Groq Whisper).\n\n' +
    'Если ты записываешь созвон с другими людьми (Zoom, Meet, Teams) — ' +
    'предупреди их и получи согласие. В некоторых странах (ЕС, Калифорния, ' +
    'Иллинойс) запись разговора без согласия всех участников — нарушение закона.\n\n' +
    'Продолжить?',
  );
  if (!ok) return;
  try {
    window.localStorage.setItem(VOICE_CONSENT_KEY, '1');
  } catch { /* localStorage недоступен — пользователь увидит prompt снова в следующий раз */ }
  onAccept();
}
