import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function RouteLoader() {
    return (_jsx("div", { className: "fixed inset-0 flex items-center justify-center bg-slate-950", role: "status", "aria-live": "polite", "aria-label": "Loading", children: _jsxs("div", { className: "flex flex-col items-center gap-4", children: [_jsx("div", { className: "h-12 w-12 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" }), _jsx("span", { className: "text-sm font-medium tracking-wide text-slate-400 animate-pulse", children: "Loading\u2026" })] }) }));
}
