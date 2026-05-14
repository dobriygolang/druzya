// Builds the list of Action's for ⌘K palette from the current expanded
// screen context (messages.length, hasSummary, callbacks). Conditional
// actions (Export / Save / Summary) hide when not relevant (no messages
// / no ready report).

import { translate } from '@d9-i18n';
import type { Action } from '../../../components/CommandPalette';

export function buildPaletteActions(ctx: {
  hasMessages: boolean;
  hasSummary: boolean;
  isFreePlan: boolean;
  openHistory: () => void;
  openSettings: () => void;
  openPersonaPicker: () => void;
  openModelPicker: () => void;
  openSummary: () => void;
  showPaywall: () => void;
  refreshQuota: () => void;
  exportMarkdown: () => void;
  saveToHone: () => void;
  screenshot: () => void;
  clearChat: () => void;
  quitApp: () => void;
}): Action[] {
  const list: Action[] = [
    { id: 'history', label: translate('cue.palette.history_label'), hint: translate('cue.palette.history_hint'), run: ctx.openHistory },
    { id: 'persona', label: translate('cue.palette.persona_label'), hint: translate('cue.palette.persona_hint'), run: ctx.openPersonaPicker },
    { id: 'model', label: translate('cue.palette.model_label'), run: ctx.openModelPicker },
    { id: 'screenshot', label: translate('cue.palette.screenshot_label'), shortcut: '⌘⇧S', run: ctx.screenshot },
    { id: 'settings', label: translate('cue.palette.settings_label'), run: ctx.openSettings },
  ];
  if (ctx.hasSummary) {
    list.push({ id: 'summary', label: translate('cue.palette.summary_label'), hint: translate('cue.palette.summary_hint'), run: ctx.openSummary });
  }
  if (ctx.hasMessages) {
    list.push(
      { id: 'export-md', label: translate('cue.palette.export_md_label'), hint: translate('cue.palette.export_md_hint'), run: ctx.exportMarkdown },
      { id: 'save-hone', label: translate('cue.palette.save_hone_label'), hint: translate('cue.palette.save_hone_hint'), run: ctx.saveToHone },
      { id: 'clear-chat', label: translate('cue.palette.clear_chat_label'), hint: translate('cue.palette.clear_chat_hint'), run: ctx.clearChat },
    );
  }
  // Subscription actions — always surfaced so users can find them via search.
  // X2 (P0) — palette upgrade теперь open'ит unified UpgradeModal с general
  // context'ом (юзер искал «upgrade» в palette → значит explicit intent,
  // не near-cap auto-trigger). PaywallModal остаётся для rate_limited
  // auto-pop'а — это разные voronkы конверсии.
  if (ctx.isFreePlan) {
    list.push({
      id: 'upgrade',
      label: translate('cue.palette.upgrade_label'),
      hint: translate('cue.palette.upgrade_hint'),
      run: () => {
        void import('../../../components/UpgradeModal').then(({ requestUpgrade }) => {
          requestUpgrade({
            feature: 'general',
            label: 'an overview of Pro',
            benefit:
              'Pro unlocks unlimited LLM calls, 8h sessions, premium personas, Cerebras/Groq priority cascade and deep readiness analytics.',
          });
        });
      },
    });
  }
  list.push({
    id: 'refresh-quota',
    label: translate('cue.palette.refresh_quota_label'),
    hint: translate('cue.palette.refresh_quota_hint'),
    run: ctx.refreshQuota,
  });
  list.push({ id: 'quit', label: translate('cue.palette.quit_label'), shortcut: '⌘Q', run: ctx.quitApp });
  return list;
}
