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
import { SettingsScreen } from './screens/settings/SettingsScreen';

type Route =
  | 'compact'
  | 'expanded'
  | 'settings'
  | 'onboarding'
  | 'area-overlay'
  | 'history';

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (
    h === 'expanded' ||
    h === 'settings' ||
    h === 'onboarding' ||
    h === 'area-overlay' ||
    h === 'history'
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

  // Area overlay is a raw drag-select UI; it deliberately skips the
  // paywall portal so modals don't appear over a fullscreen crosshair.
  if (route === 'area-overlay') return <AreaOverlayScreen />;

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
