// FocusModeSection — Phase K Wave 15 (macOS Focus mode integration).
//
// Hone не блокирует приложения напрямую — это требовало бы accessibility
// permission'ов / kernel hooks. Вместо этого делегируем macOS-у:
//
//   1. Юзер открывает System Settings → Focus, создаёт новый Focus
//      (например, "Druz9 Focus") с собственными app/website-фильтрами
//      (Twitter, Reddit, YouTube…).
//   2. Юзер создаёт shortcut с именем (например, "Druz9 Focus On"),
//      action = "Set Focus" → выбирает "Druz9 Focus" с настройкой
//      "Turn On". В подавляющем большинстве случаев macOS сам
//      автоматически создаёт «Set Druz9 Focus» shortcut.
//   3. Юзер вписывает имя shortcut'а сюда.
//   4. Hone вызывает `shortcuts run "<name>"` на старте/завершении
//      pomodoro через main process (focus_mode.ts).
//
// Сохранение: localStorage `hone:focus:macos-mode-name`. Пустая строка
// = блокировка отключена (no-op).
import { useEffect, useState } from 'react';

export const FOCUS_MODE_NAME_KEY = 'hone:focus:macos-mode-name';

/** Returns the stored shortcut name (trimmed) or '' если не задано. */
export function readFocusModeName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(FOCUS_MODE_NAME_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function FocusModeSection() {
  const [value, setValue] = useState<string>(() => readFocusModeName());
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'ok' } | { kind: 'err'; msg: string }>(
    { kind: 'idle' },
  );

  // Persist on every change. Triming на write — пустое имя = выключено.
  useEffect(() => {
    try {
      window.localStorage.setItem(FOCUS_MODE_NAME_KEY, value.trim());
    } catch {
      /* ignore quota / private mode */
    }
  }, [value]);

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? '');

  const handleCheck = async () => {
    const name = value.trim();
    if (!name) {
      setStatus({ kind: 'err', msg: 'Сначала впишите имя shortcut.' });
      return;
    }
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge?.focusMode?.start) {
      setStatus({ kind: 'err', msg: 'IPC bridge недоступен.' });
      return;
    }
    setStatus({ kind: 'busy' });
    try {
      const res = await bridge.focusMode.start(name);
      if (res.ok) {
        setStatus({ kind: 'ok' });
      } else {
        setStatus({ kind: 'err', msg: res.error ?? 'Не удалось запустить shortcut.' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: 'err', msg });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--ink-60)',
          maxWidth: 580,
        }}
      >
        Hone может включать встроенный режим Focus macOS на время помодоро.
        Создай Focus в Системных настройках (например, заблокируй
        Twitter / Reddit / YouTube), затем сделай Shortcut «Set Focus → Turn On»
        и впиши его имя сюда. На старте сессии Hone выполнит{' '}
        <span className="mono" style={{ color: 'var(--ink-90)' }}>
          shortcuts run «имя»
        </span>
        , на завершении — повторный вызов выключит Focus.
      </p>
      {!isMac && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-40)',
            letterSpacing: '0.04em',
            padding: '6px 10px',
            border: '1px solid var(--ink-10)',
            borderRadius: 6,
          }}
        >
          ⓘ macOS only — на этой ОС функция будет no-op.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Druz9 Focus On"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (status.kind !== 'idle' && status.kind !== 'busy') setStatus({ kind: 'idle' });
          }}
          className="focus-ring"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            flex: 1,
            minWidth: 220,
            padding: '8px 12px',
            fontSize: 13,
            background: 'transparent',
            border: '1px solid var(--ink-10)',
            borderRadius: 8,
            color: 'var(--ink-90)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={status.kind === 'busy' || value.trim().length === 0}
          className="focus-ring"
          style={{
            padding: '8px 14px',
            fontSize: 12,
            background: 'transparent',
            border: '1px solid var(--ink-20)',
            borderRadius: 8,
            color: 'var(--ink-90)',
            cursor: status.kind === 'busy' ? 'default' : 'pointer',
            opacity: value.trim().length === 0 ? 0.5 : 1,
            fontFamily: 'inherit',
            letterSpacing: '0.04em',
          }}
        >
          {status.kind === 'busy' ? 'Проверяем…' : 'Проверить'}
        </button>
      </div>
      {status.kind === 'ok' && (
        <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
          Готово — shortcut отработал. Если Focus не включился, проверь что в
          shortcut'е выбран action «Set Focus → Druz9 Focus → Turn On».
        </div>
      )}
      {status.kind === 'err' && (
        <div className="mono" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 11.5, color: 'var(--red)' }}>
          <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 5, flex: '0 0 auto' }} />
          <span>{status.msg}</span>
        </div>
      )}
    </div>
  );
}
