// Hash-based router. Each Electron window loads the same index.html with a
// different hash (#/compact, #/expanded, etc.); App reads the hash and
// mounts the corresponding screen. Keeps the build simple — no
// react-router, no history API.

import { useEffect, useState } from 'react';

import { PaywallPortal } from './components/PaywallPortal';
import { AreaOverlayScreen } from './screens/area-overlay/AreaOverlayScreen';
import { CompactScreen } from './screens/compact/CompactScreen';
import { ExpandedScreen } from './screens/expanded/ExpandedScreen';
import { HistoryScreen } from './screens/history/HistoryScreen';
import { OnboardingScreen } from './screens/onboarding/OnboardingScreen';
import { PickerScreen } from './screens/picker/PickerScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { ToastScreen } from './screens/toast/ToastScreen';
import { useAppearanceStore } from './stores/appearance';

type Route =
  | 'compact'
  | 'expanded'
  | 'settings'
  | 'onboarding'
  | 'area-overlay'
  | 'history'
  | 'picker'
  | 'toast';

function readRoute(): Route {
  // Hash may carry a query string (e.g. #/picker?kind=model), strip it.
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (
    h === 'expanded' ||
    h === 'settings' ||
    h === 'onboarding' ||
    h === 'area-overlay' ||
    h === 'history' ||
    h === 'picker' ||
    h === 'toast'
  )
    return h;
  return 'compact';
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Single source of truth for window transparency. Runs per renderer
  // (each BrowserWindow is its own process) — bootstraps the slider value
  // from main, subscribes to `appearance:changed` broadcasts, and writes
  // it to `--d9-window-alpha` on :root. Any screen can paint its glass
  // with `oklch(... / var(--d9-window-alpha))` without knowing about the
  // store. Fire-and-forget — returns an unsub we wire via the cleanup.
  const bootstrapAppearance = useAppearanceStore((s) => s.bootstrap);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    void bootstrapAppearance().then((u) => {
      unsub = u;
    });
    return () => {
      if (unsub) unsub();
    };
  }, [bootstrapAppearance]);

  // Area overlay is a raw drag-select UI; it deliberately skips the
  // paywall portal so modals don't appear over a fullscreen crosshair.
  if (route === 'area-overlay') return <AreaOverlayScreen />;
  // Picker is a bare floating dropdown — no paywall portal underneath.
  if (route === 'picker') return <PickerScreen />;
  // Toast is a bare floating notification — also skips the paywall portal.
  if (route === 'toast') return <ToastScreen />;

  const screen =
    route === 'compact' ? <CompactScreen /> :
    route === 'expanded' ? <ExpandedScreen /> :
    route === 'settings' ? <SettingsScreen /> :
    route === 'history' ? <HistoryScreen /> :
    <OnboardingScreen />;

  return (
    <>
      {screen}
      <PaywallPortal />
    </>
  );
}
