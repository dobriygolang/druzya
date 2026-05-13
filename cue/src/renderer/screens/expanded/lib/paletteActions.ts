// Builds the list of Action's for ⌘K palette from the current expanded
// screen context (messages.length, hasSummary, callbacks). Conditional
// actions (Export / Save / Summary) hide when not relevant (no messages
// / no ready report).

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
    { id: 'history', label: 'История чатов', hint: 'Открыть список прошлых разговоров', run: ctx.openHistory },
    { id: 'persona', label: 'Сменить persona', hint: '⌥1..⌥9 — быстрый switch', run: ctx.openPersonaPicker },
    { id: 'model', label: 'Сменить модель', run: ctx.openModelPicker },
    { id: 'screenshot', label: 'Сделать скриншот области', shortcut: '⌘⇧S', run: ctx.screenshot },
    { id: 'settings', label: 'Открыть настройки', run: ctx.openSettings },
  ];
  if (ctx.hasSummary) {
    list.push({ id: 'summary', label: 'Открыть Summary', hint: 'Отчёт по сессии', run: ctx.openSummary });
  }
  if (ctx.hasMessages) {
    list.push(
      { id: 'export-md', label: 'Экспорт в Markdown', hint: 'Сохранить чат в .md файл', run: ctx.exportMarkdown },
      { id: 'save-hone', label: 'Сохранить в Hone', hint: 'Перенести как заметку', run: ctx.saveToHone },
      { id: 'clear-chat', label: 'Очистить чат', hint: 'Начать новый разговор', run: ctx.clearChat },
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
      label: 'Обновить план',
      hint: 'Pro 990₽/mo · Cerebras priority · 8h sessions',
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
    label: 'Проверить подписку',
    hint: 'Обновить статус плана с сервера',
    run: ctx.refreshQuota,
  });
  list.push({ id: 'quit', label: 'Выйти из Cue', shortcut: '⌘Q', run: ctx.quitApp });
  return list;
}
