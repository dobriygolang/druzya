// syncEvents.ts — Phase C-6.2 SSE client.
//
// Открывает long-lived EventSource на /api/v1/sync/events. На каждое
// сообщение от server'а вызывает onEvent. Auto-reconnect — встроенный в
// EventSource, browser сам делает retry с exponential backoff.
//
// Auth: EventSource НЕ позволяет custom headers (стандарт), поэтому
// bearer-token и device-id передаются через query-string. Backend
// auth-middleware принимает оба варианта (Authorization header И
// ?token= query). Для device-id мы передаём `?deviceId=...` если
// зарегистрирован.

import { API_BASE_URL, DEV_BEARER_TOKEN } from './config';
import { useSessionStore } from '../stores/session';

export interface SyncEvent {
  kind: 'sync_change' | 'yjs_append';
  table?: string;       // для sync_change
  entityKind?: 'notes' | 'whiteboards'; // для yjs_append
  parentId?: string;    // для yjs_append
  originDeviceId?: string;
}

export interface SyncEventStream {
  close: () => void;
}

interface OpenOpts {
  onEvent: (e: SyncEvent) => void;
  /** Optional callback на (re)connect — UI может показать «connected» pill. */
  onOpen?: () => void;
  /** Optional callback на error/disconnect. EventSource auto-reconnects, но
   *  callback полезен для UI feedback («reconnecting…»). */
  onError?: () => void;
}

export function openSyncEventStream(opts: OpenOpts): SyncEventStream {
  const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  try {
    const did = window.localStorage.getItem('hone:device-id');
    if (did) params.set('deviceId', did);
  } catch {
    /* private mode */
  }
  const url = `${API_BASE_URL}/api/v1/sync/events?${params.toString()}`;

  let closed = false;
  let es: EventSource | null = null;

  const connect = () => {
    if (closed) return;
    es = new EventSource(url, { withCredentials: false });
    es.onopen = () => {
      if (opts.onOpen) opts.onOpen();
    };
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as SyncEvent;
        opts.onEvent(parsed);
      } catch {
        /* malformed event — ignore */
      }
    };
    es.onerror = () => {
      if (opts.onError) opts.onError();
      // EventSource сам reconnects'ит. Нам не надо ничего делать. На
      // permanent failure (e.g. 401 device_revoked) browser will keep
      // trying — that's acceptable, transport interceptor in fetch path
      // обработает auth-revoke когда юзер сделает обычный API call.
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (es) {
        es.close();
        es = null;
      }
    },
  };
}
