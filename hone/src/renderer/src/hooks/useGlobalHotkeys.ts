// useGlobalHotkeys — global keyboard listener для Hone hotkeys.
//
// ⌘K — toggle command palette.
// ⌘S (без shift) — broadcast `hone:toggle-sidebar` (Notes/Editor/Boards
//      слушают и сворачивают свою sidebar'у).
// Esc — закрывает первую открытую модалку или возвращает на home.
// Plain letters (T/N/B/E/S/R/W/A/L/M/Comma) — page navigation toggle.
//
// e.code (физический keycode) используется вместо e.key — чтобы работать
// на русской и английской раскладках одинаково. Все Cmd/Ctrl/Alt комбинации
// (кроме ⌘K и ⌘S) пропускаются — browser default'ы (copy, paste и т.д.).
//
// Hotkeys disabled когда: фокус в input/textarea/contentEditable, palette
// открыта, или onboarding открыт.
import { useEffect } from 'react';

import type { PageId } from '../components/Palette';

export interface GlobalHotkeysDeps {
  page: PageId;
  paletteOpen: boolean;
  copilotOpen: boolean;
  onboardingOpen: boolean;
  statsOpen: boolean;
  englishVisible: boolean;

  setPaletteOpen: (next: (p: boolean) => boolean) => void;
  setCopilotOpen: (open: boolean) => void;
  setStatsOpen: (open: boolean) => void;
  dismissOnboarding: () => void;
  goHome: () => void;
  open: (id: PageId) => void;
  openStats: () => void;
}

export function useGlobalHotkeys(deps: GlobalHotkeysDeps): void {
  const {
    page,
    paletteOpen,
    copilotOpen,
    onboardingOpen,
    statsOpen,
    englishVisible,
    setPaletteOpen,
    setCopilotOpen,
    setStatsOpen,
    dismissOnboarding,
    goHome,
    open,
    openStats,
  } = deps;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isText =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as HTMLElement).isContentEditable);

      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      // ⌘S — global sidebar toggle. Каждая страница (Notes / Editor /
      // SharedBoards) слушает `hone:toggle-sidebar` window event и сворачивает
      // свою sidebar'у. Раньше юзер должен был кликать collapse-arrow.
      if (isMod && e.key.toLowerCase() === 's' && !e.shiftKey) {
        // Не вызываем preventDefault для НЕ-text контекста — но в text input
        // ⌘S обычно reserved для browser save. Мы фильтруем isText выше во
        // внешнем path letter-shortcuts'е, тут же ⌘S ловится до этого фильтра.
        // Для безопасности фильтруем сами.
        if (!isText) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('hone:toggle-sidebar'));
          return;
        }
      }
      // Copilot ⌘⇧Space hotkey удалён по просьбе юзера — Copilot UI не
      // используется. Оставляем сам компонент в дереве (см. App), но
      // глобального hotkey нет; openImpl(`copilot`) из Palette всё ещё
      // работает если кто-то его дёрнет, но в палитре action тоже скрыт.

      if (e.key === 'Escape') {
        if (onboardingOpen) {
          dismissOnboarding();
          return;
        }
        if (copilotOpen) {
          setCopilotOpen(false);
          return;
        }
        if (paletteOpen) {
          setPaletteOpen(() => false);
          return;
        }
        if (statsOpen) {
          setStatsOpen(false);
          return;
        }
        if (page !== 'home') {
          goHome();
          return;
        }
        return;
      }
      // Hotkey-nav должна работать через overlays — open сам
      // закроет stats overlay при переключении.
      if (isText || paletteOpen || onboardingOpen) return;

      // (2026-05-12 D4) Canvas-conflict guard для shared_boards / editor
      // снят — обе страницы переехали в web. Hone hotkeys больше не
      // конфликтуют с Excalidraw / CodeMirror.

      // КРИТИЧНО: skip ALL letter-navigation когда любой modifier нажат.
      // Раньше юзер давил ⌘C в DevTools console чтобы скопировать error
      // — App'ов handler ловил `e.code='KeyC'` → `open('editor')` →
      // copy не срабатывал (browser default уже отменён или React batch
      // забрал focus). Letter-shortcuts ТОЛЬКО для plain-key presses
      // (no Cmd/Ctrl/Alt). ⌘K/⌘S обработаны ВЫШЕ; всё остальное —
      // browser default (copy, paste, etc).
      if (isMod || e.altKey) return;

      // Используем `e.code` (физический keycode) вместо `e.key` (зависит от
      // layout'а). Это нужно потому что юзер на русской раскладке давит
      // physical-key 'B' получит `e.key='и'` — и наш switch не сработает.
      // С `e.code='KeyB'` shortcut срабатывает на ОБОИХ layouts identically.
      // Comma — `e.code='Comma'` тоже layout-independent.
      // Toggle semantics: pressing the same key while the target page/overlay
      // is already showing returns to home. Lets the user dismiss without
      // hunting for ESC or moving the mouse.
      const code = e.code;
      const toggleTo = (id: PageId | 'stats') => {
        if (id === 'stats') {
          if (statsOpen) {
            setStatsOpen(false);
          } else {
            openStats();
          }
          return;
        }
        if (page === id) {
          goHome();
        } else {
          open(id);
        }
      };
      if (code === 'KeyT') toggleTo('today');
      else if (code === 'KeyN') toggleTo('notes');
      // KeyB / KeyE — Boards / Editor migrated to web solo (D4 Stream F,
      // 2026-05-12). Hone hotkey открывает new browser tab; deep-link
      // авто-логинит через cookie session если юзер залогинен в web.
      else if (code === 'KeyB') {
        void window.hone?.shell.openExternal('https://druz9.online/whiteboard/new');
      }
      else if (code === 'KeyE') {
        void window.hone?.shell.openExternal('https://druz9.online/editor/new');
      }
      else if (code === 'KeyS') toggleTo('stats');
      // KeyP — released (was podcasts; D5 migrated to web /podcasts).
      else if (code === 'KeyR' && englishVisible) toggleTo('reading');
      else if (code === 'KeyW' && englishVisible) toggleTo('writing');
      else if (code === 'KeyA') toggleTo('assignments');
      else if (code === 'KeyL' && englishVisible) toggleTo('listening');
      else if (code === 'KeyK' && englishVisible) toggleTo('speaking');
      else if (code === 'KeyM') toggleTo('calendar');
      else if (code === 'Comma') toggleTo('settings');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, copilotOpen, onboardingOpen, page, statsOpen, englishVisible]);
}
