import { useEffect, useRef, useState } from 'react';
/**
 * useFeed subscribes to the public sanctum feed at /ws/feed.
 * No auth — the feed only emits anonymized events.
 * Returns the last N events (newest first) and a connection status.
 */
export function useFeed({ url = defaultURL(), bufferSize = 25, useMock = import.meta.env.VITE_USE_MSW === 'true', } = {}) {
    const [events, setEvents] = useState([]);
    const [status, setStatus] = useState('connecting');
    const wsRef = useRef(null);
    useEffect(() => {
        if (useMock) {
            setStatus('open');
            const seed = [
                { kind: 'match_win', text: '⚔ Shadow_4821 won on the Algorithms arena', at: new Date().toISOString() },
                { kind: 'kata_done', text: '✦ Wraith_0913 extended a Daily Kata streak to 42 days (+90 XP)', at: new Date().toISOString() },
                { kind: 'node_unlocked', text: '◈ Ember_2714 unlocked "Consistent Hashing" (System Design)', at: new Date().toISOString() },
            ];
            setEvents(seed);
            return;
        }
        let retry = 0;
        let cancelled = false;
        const connect = () => {
            const ws = new WebSocket(url);
            wsRef.current = ws;
            setStatus('connecting');
            ws.addEventListener('open', () => {
                setStatus('open');
                retry = 0;
            });
            ws.addEventListener('message', (ev) => {
                try {
                    const parsed = JSON.parse(ev.data);
                    setEvents((prev) => [parsed, ...prev].slice(0, bufferSize));
                }
                catch {
                    // ignore malformed frame
                }
            });
            const close = () => {
                setStatus('closed');
                if (cancelled)
                    return;
                retry = Math.min(retry + 1, 6);
                setTimeout(connect, 500 * 2 ** retry);
            };
            ws.addEventListener('close', close);
            ws.addEventListener('error', () => ws.close());
        };
        connect();
        return () => {
            cancelled = true;
            wsRef.current?.close();
        };
    }, [url, bufferSize, useMock]);
    return { events, status };
}
function defaultURL() {
    if (typeof window === 'undefined')
        return '';
    const base = import.meta.env.VITE_WS_BASE ?? '';
    if (base)
        return `${base}/feed`;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/feed`;
}
