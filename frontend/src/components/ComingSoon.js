import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ComingSoon — honest placeholder used when a gamification surface has no
// backend yet. Used for /tournament/:id and /cards while the real services
// (tournament + hero_cards) are out of scope for the MVP.
//
// We intentionally render zero hard-coded sample data — the goal of this
// component is to delete every "demo" scaffolding from the page above it, not
// to disguise it.
import { Sparkles } from 'lucide-react';
export function ComingSoon({ title, description, primaryCta, secondaryCta }) {
    return (_jsx("div", { className: "flex w-full items-center justify-center px-4 py-12 sm:px-8 lg:px-20", children: _jsxs("div", { className: "flex w-full max-w-[640px] flex-col items-center gap-5 rounded-2xl border border-border bg-surface-1 p-8 text-center", children: [_jsx("div", { className: "grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-pink/30", children: _jsx(Sparkles, { className: "h-6 w-6 text-accent-hover" }) }), _jsx("h2", { className: "font-display text-2xl font-bold text-text-primary", children: title }), _jsx("p", { className: "max-w-[480px] text-sm text-text-secondary", children: description }), (primaryCta || secondaryCta) && (_jsxs("div", { className: "flex flex-wrap items-center justify-center gap-3", children: [primaryCta && (_jsx("button", { type: "button", onClick: primaryCta.onClick, className: "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow hover:bg-accent/90", children: primaryCta.label })), secondaryCta && (_jsx("button", { type: "button", onClick: secondaryCta.onClick, className: "rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-text-secondary hover:border-border-strong hover:text-text-primary", children: secondaryCta.label }))] }))] }) }));
}
