// API config — где живёт Connect-RPC endpoint. Хардкод на прод — у нас
// один production-environment (api.druz9.ru), локального monolith'а не
// запускаем из hone'а (в dev backend открываем отдельно на :8080 когда
// действительно нужно).
//
// Если когда-нибудь понадобится staging/local — возвращаем
// import.meta.env.VITE_DRUZ9_API_BASE обратно и выставляем через
// electron-vite. Пока не нужно.

export const API_BASE_URL = 'https://api.druz9.ru';

// Публичный web-адрес для OAuth redirect'а и deep-link'ов.
// druz9.online — алиас, держим как константу на случай ре-брендинга.
export const WEB_BASE_URL = 'https://druz9.ru';

// DEV_BEARER_TOKEN остаётся env-переменной — единственный кейс когда она
// нужна — smoke-test'ить CI против прода без OAuth flow. В стандартном
// юзер-сценарии логин через LoginScreen → druz9://auth deep-link.
export const DEV_BEARER_TOKEN: string | null =
  (import.meta.env.VITE_DRUZ9_DEV_TOKEN ?? '').trim() || null;
