// ConfirmDialog — reusable confirmation prompt with imperative API.
//
// Usage:
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: 'Delete this note?',
//     description: 'This action cannot be undone.',
//     destructive: true,
//     confirmLabel: 'Delete',
//   });
//   if (!ok) return;
//
// Provider must wrap the app tree (mounted near root in App.tsx).
// Built on top of Modal primitive — gets focus trap, scrim, Esc handling,
// body-scroll lock for free.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Modal } from './primitives/Modal';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // destructive=true styles the confirm button red (border + text on
  // transparent bg, per CLAUDE rule «#FF3B30 only as stroke/text»).
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setPending((cur) => {
      if (cur) cur.resolve(result);
      return null;
    });
  }, []);

  // Enter triggers confirm (when dialog open). Modal primitive already
  // handles Escape → onClose → close(false), so Esc means cancel by default.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => close(false)}
        title={pending?.title}
        description={pending?.description}
        size="sm"
        initialFocusRef={cancelBtnRef}
      >
        {pending && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 8,
            }}
          >
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={() => close(false)}
              className="focus-ring motion-press"
              style={btnGhost}
            >
              {pending.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="focus-ring motion-press"
              style={pending.destructive ? btnDestructive : btnPrimary}
            >
              {pending.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const btnGhost: React.CSSProperties = {
  ...captionMono,
  padding: '8px 14px',
  border: '1px solid var(--hair-2)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--ink-60)',
  cursor: 'pointer',
  transition:
    'color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
};

const btnPrimary: React.CSSProperties = {
  ...captionMono,
  padding: '8px 14px',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  background: 'var(--ink)',
  color: 'var(--bg)',
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
};

const btnDestructive: React.CSSProperties = {
  ...captionMono,
  padding: '8px 14px',
  border: '1.5px solid var(--red)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--red)',
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
};
