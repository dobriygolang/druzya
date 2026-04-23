// BYOK — Bring Your Own Key section in Settings → AI Providers.
//
// UX contract: keys never appear in the renderer. On save, we hand the
// raw string straight to IPC and then discard it from React state. The
// presence map from main is the only thing we persist in the store.

import { useEffect, useState } from 'react';

import { eventChannels, type ByokPresence, type ByokProvider } from '@shared/ipc';
import { IconCheck, IconKey, IconShield } from '../../components/icons';
import { Button, StatusDot } from '../../components/primitives';

const providers: Array<{
  id: ByokProvider;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'GPT-4o, GPT-4o mini и другие. Ключ: sk-…',
    placeholder: 'sk-proj-…',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude Sonnet 4, Opus 4. Ключ: sk-ant-…',
    placeholder: 'sk-ant-api03-…',
  },
];

export function ByokSection() {
  const [presence, setPresence] = useState<ByokPresence>({ openai: false, anthropic: false });

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const p = await window.druz9.byok.list();
        if (!disposed) setPresence(p);
      } catch {
        /* empty presence is a safe default */
      }
    })();
    const unsub = window.druz9.on<ByokPresence>(eventChannels.byokChanged, (p) => {
      if (!disposed) setPresence(p);
    });
    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '12px 16px',
          background: 'var(--d-gradient-hero-soft)',
          border: '1px solid var(--d-line)',
          borderRadius: 10,
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--d-text-2)',
        }}
      >
        <IconShield size={16} />
        <div>
          <strong style={{ color: 'var(--d-text)' }}>Свои API-ключи.</strong> Ключи шифруются в
          macOS Keychain. На наш сервер не уходит ничего — ни ключ, ни запросы, ни ответы.
          Инференс идёт напрямую к провайдеру, квота Druz9 не расходуется.
        </div>
      </div>

      {providers.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p.id}
          label={p.label}
          hint={p.hint}
          placeholder={p.placeholder}
          present={presence[p.id]}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function ProviderRow({
  provider,
  label,
  hint,
  placeholder,
  present,
}: {
  provider: ByokProvider;
  label: string;
  hint: string;
  placeholder: string;
  present: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok'; detail: string }
    | { kind: 'err'; detail: string }
  >({ kind: 'idle' });

  const reset = () => {
    setDraft('');
    setStatus({ kind: 'idle' });
    setEditing(false);
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setStatus({ kind: 'pending' });
    const r = await window.druz9.byok.save(provider, key);
    // Drop the key from React state immediately — ok or not, we never
    // want to keep the plaintext around longer than necessary.
    setDraft('');
    if (r.ok) {
      setStatus({ kind: 'ok', detail: r.detail });
      setTimeout(reset, 1500);
    } else {
      setStatus({ kind: 'err', detail: r.detail });
    }
  };

  const removeKey = async () => {
    await window.druz9.byok.delete(provider);
  };

  const test = async () => {
    setStatus({ kind: 'pending' });
    const r = await window.druz9.byok.test(provider);
    setStatus(r.ok ? { kind: 'ok', detail: r.detail } : { kind: 'err', detail: r.detail });
  };

  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--d-bg-2)',
        border: '1px solid var(--d-line)',
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: present ? 'rgba(52, 199, 89, 0.12)' : 'var(--d-accent-soft)',
            color: present ? 'var(--d-green)' : 'var(--d-accent)',
            flexShrink: 0,
          }}
        >
          {present ? <IconCheck size={16} /> : <IconKey size={16} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {label}
            {present && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--f-mono)',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: 'rgba(52, 199, 89, 0.12)',
                  color: 'var(--d-green)',
                }}
              >
                ваш ключ активен
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--d-text-3)', marginTop: 2 }}>
            {present ? 'Ключ в Keychain. Запросы идут напрямую к провайдеру.' : hint}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {present ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void test()}>
                Проверить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void removeKey()}>
                Удалить
              </Button>
            </>
          ) : editing ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              Отмена
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
              Добавить ключ
            </Button>
          )}
        </div>
      </div>

      {editing && !present && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') reset();
            }}
            placeholder={placeholder}
            style={{
              flex: 1,
              height: 32,
              padding: '0 10px',
              fontSize: 12,
              fontFamily: 'var(--f-mono)',
              background: 'var(--d-bg-1)',
              border: '1px solid var(--d-line)',
              borderRadius: 'var(--r-inner)',
              color: 'var(--d-text)',
              outline: 'none',
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void save()}
            disabled={!draft.trim() || status.kind === 'pending'}
          >
            {status.kind === 'pending' ? 'Проверка…' : 'Сохранить'}
          </Button>
        </div>
      )}

      {status.kind !== 'idle' && status.kind !== 'pending' && (
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: status.kind === 'ok' ? 'var(--d-green)' : 'var(--d-red)',
          }}
        >
          <StatusDot state={status.kind === 'ok' ? 'ready' : 'error'} size={6} />
          <span>{status.detail}</span>
        </div>
      )}
    </div>
  );
}
