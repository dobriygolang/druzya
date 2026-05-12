// i18n types. We keep strings in a strongly-typed flat dictionary so a
// missing key is a compile error — no `t("somthing.typoed")` quietly
// falling back to the key at runtime. A small app like ours does not
// need react-intl or i18next; a dictionary + context is plenty.

export type Locale = 'ru' | 'en';

/**
 * Every user-facing string we need. Add a key here + fill it in ALL
 * locale dictionaries. TypeScript yells if a locale forgets one.
 */
export interface Dict {
  // status / small labels
  ready: string;
  needLogin: string;
  thinking: string;
  cursorLock: string;
  retake: string;
  cancel: string;
  send: string;

  // compact placeholders
  compactPlaceholder: string;
  compactPlaceholderWithShot: string;

  // expanded
  expandedModelReady: string;
  expandedModelThinking: string;
  expandedEmptyCta: string;
  expandedEmptyHint: string;

  // onboarding
  onboardingWelcomeTitle: string;
  onboardingWelcomeBody: string;
  onboardingStart: string;
  onboardingPermsTitle: string;
  onboardingPermsBody: string;
  onboardingLoginTitle: string;
  onboardingLoginBody: string;
  onboardingLoginButton: string;
  onboardingLoginCodeLabel: string;
  onboardingLoginReopen: string;
  onboardingLoginNewCode: string;
  onboardingLoginWaiting: string;
  onboardingLoginError: string;
  onboardingDoneTitle: string;
  onboardingDoneBody: string;
  onboardingDoneClose: string;

  // settings tabs
  settingsTabGeneral: string;
  settingsTabHotkeys: string;
  settingsTabProviders: string;
  settingsTabAbout: string;

  // misc
  next: string;
  back: string;
}
