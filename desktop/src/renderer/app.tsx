// Hash-based router. Each Electron window loads the same index.html with a
// different hash (#/compact, #/expanded, etc.); App reads the hash and
// mounts the corresponding screen. Keeps the build simple — no
// react-router, no history API.

import { useEffect, useState } from 'react';

import { AreaOverlayScreen } from './screens/area-overlay/AreaOverlayScreen';
import { CompactScreen } from './screens/compact/CompactScreen';
import { ExpandedScreen } from './screens/expanded/ExpandedScreen';
import { OnboardingScreen } from './screens/onboarding/OnboardingScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';

type Route = 'compact' | 'expanded' | 'settings' | 'onboarding' | 'area-overlay';

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'expanded' || h === 'settings' || h === 'onboarding' || h === 'area-overlay') return h;
  return 'compact';
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  switch (route) {
    case 'compact':
      return <CompactScreen />;
    case 'expanded':
      return <ExpandedScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'onboarding':
      return <OnboardingScreen />;
    case 'area-overlay':
      return <AreaOverlayScreen />;
  }
}
