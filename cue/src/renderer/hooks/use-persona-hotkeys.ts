// usePersonaHotkeys — window-scoped Alt+digit (⌥1..⌥9) для быстрого
// переключения persona по index в загруженном catalogue. Hint видно в
// expanded EmptyState ("Сменить персону · ⌥1"). Реализация раньше
// отсутствовала: список personas был, но keydown listener не было.
//
// Why renderer-scoped (а не Electron globalShortcut): персону нужно
// менять только когда юзер в Cue (compact/expanded). Глобальный шорткат
// ловил бы ⌥1 в IDE/браузере, ломая там Tab-switch который по дефолту
// привязан к ⌥1..⌥9 на mac. Минус: не работает когда окно не в фокусе,
// но это и не нужно для этого UX.
//
// Skip когда фокус на input/textarea (юзер набирает текст с ⌥-комбо
// для ввода европейских символов: ⌥e=é, ⌥u=ü etc).

import { useEffect } from 'react';

import { usePersonaStore } from '../stores/persona';

export function usePersonaHotkeys(): void {
  const list = usePersonaStore((s) => s.list);
  const setActive = usePersonaStore((s) => s.setActive);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Только Alt без модификаторов. e.metaKey/ctrlKey/shiftKey
      // комбо — это другие хоткеи приложения (⌘K palette, ⌘⇧S etc).
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Skip когда юзер печатает в input/textarea — ⌥-комбо нужны для
      // ввода спецсимволов (⌥e=é). Также contentEditable.
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;

      // Match Digit1..Digit9 через e.code. На macOS ⌥1 печатает '¡'
      // в e.key — code остаётся 'Digit1'.
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      const idx = parseInt(m[1], 10) - 1;
      const target2 = list[idx];
      if (!target2) return;
      e.preventDefault();
      setActive(target2.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, setActive]);
}
