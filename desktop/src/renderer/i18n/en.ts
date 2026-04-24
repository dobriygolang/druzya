// English dictionary. Kept terse — matches the Russian register:
// developer-direct, not marketing-slick.

import type { Dict } from './types';

export const en: Dict = {
  ready: 'Ready',
  needLogin: 'Sign in needed',
  thinking: 'thinking…',
  cursorLock: 'CURSOR LOCK',
  retake: 'Retake',
  cancel: 'Cancel',
  send: 'Send',

  compactPlaceholder: 'Message or question…',
  compactPlaceholderWithShot: 'Add a question to the screenshot…',

  expandedModelReady: 'ready',
  expandedModelThinking: 'thinking…',
  expandedEmptyCta: 'Press Cmd+Shift+S for a screenshot',
  expandedEmptyHint: 'or type a question in the compact window',

  onboardingWelcomeTitle: 'Cue',
  onboardingWelcomeBody:
    'A stealth AI assistant for developers. Take a screenshot and get the answer next to it — while your screen is shared.',
  onboardingStart: 'Get started',
  onboardingPermsTitle: 'macOS permissions',
  onboardingPermsBody: "We can't function without these.",
  onboardingLoginTitle: 'Sign in to Cue',
  onboardingLoginBody:
    "We'll open the Telegram bot. Tap /start in the bot — we'll catch the confirmation and continue.",
  onboardingLoginButton: 'Sign in via Telegram',
  onboardingLoginCodeLabel: 'This code should match what the bot sends you:',
  onboardingLoginReopen: 'Open the bot again',
  onboardingLoginNewCode: 'New code',
  onboardingLoginWaiting: 'waiting for the Telegram confirmation…',
  onboardingLoginError: "Couldn't sign in",
  onboardingDoneTitle: "You're set",
  onboardingDoneBody: 'Press Cmd+Shift+S to ask your first question about a screenshot.',
  onboardingDoneClose: 'Close',

  settingsTabGeneral: 'General',
  settingsTabHotkeys: 'Hotkeys',
  settingsTabProviders: 'AI providers',
  settingsTabAbout: 'About',

  next: 'Next',
  back: 'Back',
};
