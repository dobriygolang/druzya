// Screenshot capture → analyze.start/.chat round-trip used both from the
// camera icon button and the ⌘K command palette action. Pulled out of
// ExpandedScreen so both call sites can share the optimistic-bubble race
// fix (broadcast vs invoke response).

import { useConversationStore } from '../../../stores/conversation';
import { usePersonaStore } from '../../../stores/persona';

export async function captureAndSend(
  conversationId: string,
  promptText: string,
  setDraft: (s: string) => void,
  model: string,
) {
  try {
    const shot = await window.druz9.capture.screenshotArea();
    if (!shot) return; // user cancelled
    const ipc = conversationId ? window.druz9.analyze.chat : window.druz9.analyze.start;
    const handle = await ipc({
      conversationId,
      promptText,
      model,
      attachments: [
        {
          kind: 'screenshot',
          dataBase64: shot.dataBase64,
          mimeType: shot.mimeType,
          width: shot.width,
          height: shot.height,
        },
      ],
      triggerAction: 'screenshot_area',
      focusedAppHint: '',
      personaSystemPrompt: usePersonaStore.getState().active.system_prompt,
    });
    // Main broadcasts `userTurnStarted` before the handle returns, but
    // push and invoke-response travel independently — the push can lose
    // the race on some Electron builds. If the broadcast already ran
    // applyTurn, streamId will match; skip. Otherwise paint here.
    if (useConversationStore.getState().streamId !== handle.streamId) {
      useConversationStore.getState().beginTurn({
        promptText,
        hasScreenshot: true,
        screenshotDataUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
        streamId: handle.streamId,
      });
    }
    setDraft('');
  } catch (err) {
    // CI1: silent fail во время real interview = trust break. Restore
    // draft + surface toast как в send()/auto-send. Юзер видит prompt и
    // может re-trigger screenshot через тот же hotkey.
    // eslint-disable-next-line no-console
    console.error('screenshot failed', err);
    setDraft(promptText);
    const msg = (err as Error)?.message || 'screenshot failed';
    void window.druz9.toast.show(`AI: ${msg}`, 'error').catch(() => {});
  }
}
