// API config — где живёт Connect-RPC endpoint.
//
// Прод-инфраструктура: один хост `druz9.online` отдаёт и web, и
// Connect-RPC (nginx проксирует /druz9.v1.* → monolith). Отдельного
// `api.*` поддомена нет. druz9.ru → 301 на druz9.online (плановый,
// сейчас закомментирован в nginx до выпуска сертификата — см
// infra/nginx/nginx.prod.conf).
//
// Если когда-нибудь понадобится staging / локальный monolith — верни
// import.meta.env.VITE_DRUZ9_API_BASE обратно и выставляй через
// electron-vite.

export const API_BASE_URL = 'https://druz9.online';

// Публичный web — LoginScreen открывает `${WEB_BASE_URL}/login?desktop=…`
// в системном браузере для OAuth flow.
export const WEB_BASE_URL = 'https://druz9.online';

// DEV_BEARER_TOKEN — хатч для debug'а без OAuth flow. В стандартном
// юзер-сценарии логин через LoginScreen → druz9://auth deep-link.
export const DEV_BEARER_TOKEN: string | null =
  (import.meta.env.VITE_DRUZ9_DEV_TOKEN ?? '').trim() || null;
