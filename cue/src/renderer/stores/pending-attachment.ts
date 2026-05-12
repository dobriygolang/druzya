// Pending-attachment store — a screenshot the user captured but hasn't
// yet sent. Lets them type context, review the crop, retake if they
// miscropped, or discard without burning a request.
//
// One at a time by design. Taking a new screenshot replaces the
// pending one — matches how macOS's own screenshot tool behaves and
// avoids complex "queue" UX in the compact window.

import { create } from 'zustand';

export interface PendingAttachment {
  dataBase64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  /** When the capture happened — used to prune stale previews on close. */
  capturedAt: number;
}

interface State {
  pending: PendingAttachment | null;
  set: (p: PendingAttachment) => void;
  clear: () => void;
}

export const usePendingAttachmentStore = create<State>((set) => ({
  pending: null,
  set: (p) => set({ pending: p }),
  clear: () => set({ pending: null }),
}));
