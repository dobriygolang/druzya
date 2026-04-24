// Russian dictionary — the default. Keep it honest and developer-speak;
// Druz9's primary audience is Russian-speaking devs.

import type { Dict } from './types';

export const ru: Dict = {
  ready: 'Готов',
  needLogin: 'Нужен вход',
  thinking: 'думает…',
  cursorLock: 'КУРСОР ЗАБЛОКИРОВАН',
  retake: 'Переделать',
  cancel: 'Отменить',
  send: 'Отправить',

  compactPlaceholder: 'Сообщение или вопрос…',
  compactPlaceholderWithShot: 'Добавь вопрос к скриншоту…',

  expandedModelReady: 'готов',
  expandedModelThinking: 'думает…',
  expandedEmptyCta: 'Нажми Cmd+Shift+S для скриншота',
  expandedEmptyHint: 'или напиши вопрос в compact-окно',

  onboardingWelcomeTitle: 'Druz9 Copilot',
  onboardingWelcomeBody:
    'Невидимый AI-помощник для разработчиков. Скриншот — и ответ рядом, пока ты делишь экран.',
  onboardingStart: 'Начать',
  onboardingPermsTitle: 'Разрешения macOS',
  onboardingPermsBody: 'Без них приложение не сможет работать полноценно.',
  onboardingLoginTitle: 'Вход в Druz9',
  onboardingLoginBody:
    'Откроем Telegram-бота. Жми в боте /start — мы узнаем об этом и продолжим сами.',
  onboardingLoginButton: 'Войти через Telegram',
  onboardingLoginCodeLabel: 'Этот код должен совпасть с тем, что пришлёт бот:',
  onboardingLoginReopen: 'Открыть бот ещё раз',
  onboardingLoginNewCode: 'Новый код',
  onboardingLoginWaiting: 'ждём подтверждения в Telegram…',
  onboardingLoginError: 'Не получилось войти',
  onboardingDoneTitle: 'Всё готово',
  onboardingDoneBody: 'Жми Cmd+Shift+S, чтобы задать первый вопрос по скриншоту.',
  onboardingDoneClose: 'Закрыть',

  settingsTabGeneral: 'Общее',
  settingsTabHotkeys: 'Горячие клавиши',
  settingsTabProviders: 'AI провайдеры',
  settingsTabAbout: 'О программе',

  next: 'Далее',
  back: 'Назад',
};
