import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function WSStatus({ status, className = '' }) {
    const live = status === 'open';
    const reconnecting = status === 'connecting' || status === 'reconnecting';
    const label = live ? 'Live' : reconnecting ? 'Reconnecting...' : 'Offline';
    const dot = live ? 'bg-success' : reconnecting ? 'bg-warn' : 'bg-text-muted';
    const text = live ? 'text-success' : reconnecting ? 'text-warn' : 'text-text-muted';
    return (_jsxs("span", { className: [
            'inline-flex items-center gap-1.5 rounded-full bg-surface-2/80 px-2 py-0.5 font-mono text-[10px] font-semibold',
            text,
            className,
        ].join(' '), children: [_jsx("span", { className: `h-1.5 w-1.5 rounded-full ${dot} ${live ? 'animate-pulse' : ''}` }), label] }));
}
export default WSStatus;
