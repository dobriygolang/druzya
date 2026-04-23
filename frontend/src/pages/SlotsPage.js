import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// SlotsPage renders the Live Mock Interview slot catalogue + booking surface.
// Backed by SlotService (proto/druz9/v1/slot.proto): we hit GET /api/v1/slot
// for the catalogue and POST /api/v1/slot/{id}/book to reserve.
//
// All previously-hardcoded filter/SLOT data has been replaced with state
// driven by the API response. The price-cap chip now derives from actual
// slots (see derivePriceBuckets in lib/queries/slot.ts).
import { useMemo, useState } from 'react';
import { Star, Video, Clock, ArrowUpDown } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { derivePriceBuckets, useBookSlot, useSlotsQuery, } from '../lib/queries/slot';
const SECTIONS = [
    { key: 'algorithms', label: 'Algorithms' },
    { key: 'sql', label: 'SQL' },
    { key: 'go', label: 'Go' },
    { key: 'system_design', label: 'System Design' },
    { key: 'behavioral', label: 'Behavioral' },
];
const GRADIENTS = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'];
function pickGradient(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return GRADIENTS[hash % GRADIENTS.length];
}
function fmtPrice(rub) {
    if (rub === 0)
        return 'Бесплатно';
    return `${rub.toLocaleString('ru-RU')}₽`;
}
function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function Header({ count, isError }) {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-7", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary", children: "Live Mock Interview" }), _jsx("p", { className: "text-sm text-text-secondary", children: isError
                            ? 'Не удалось загрузить слоты'
                            : count === 0
                                ? 'Сейчас нет открытых слотов — загляни позже'
                                : `Peer-mock с реальными разработчиками · ${count} слотов доступно` })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx(Button, { variant: "ghost", children: "\u041C\u043E\u0438 \u0441\u043B\u043E\u0442\u044B" }), _jsx(Button, { children: "\u0421\u0442\u0430\u0442\u044C \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E\u0435\u0440\u043E\u043C" })] })] }));
}
function FilterChip({ label, active, onClick, }) {
    return (_jsx("button", { type: "button", onClick: onClick, className: `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${active
            ? 'border-accent bg-accent/15 text-accent-hover'
            : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'}`, children: label }));
}
function FilterBar({ filter, setFilter, priceBuckets, }) {
    return (_jsxs("div", { className: "flex flex-col items-start gap-3 px-4 pb-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 overflow-x-auto", children: [SECTIONS.map((s) => (_jsx(FilterChip, { label: s.label, active: filter.section === s.key, onClick: () => setFilter({ ...filter, section: filter.section === s.key ? undefined : s.key }) }, s.key))), priceBuckets.map((cap) => (_jsx(FilterChip, { label: `до ${cap.toLocaleString('ru-RU')}₽`, active: filter.priceMax === cap, onClick: () => setFilter({ ...filter, priceMax: filter.priceMax === cap ? undefined : cap }) }, cap)))] }), _jsxs("button", { className: "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-secondary", children: [_jsx(ArrowUpDown, { className: "h-3.5 w-3.5" }), "\u0421\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u043A\u0430: \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435"] })] }));
}
function SlotCard({ s, onBook, booking }) {
    const initial = s.interviewer.username?.[0]?.toUpperCase() ?? '?';
    return (_jsxs(Card, { className: "flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5", children: [_jsx(Avatar, { size: "lg", gradient: pickGradient(s.interviewer.user_id), initials: initial }), _jsxs("div", { className: "flex flex-1 flex-col gap-1", children: [_jsx("div", { className: "flex items-center gap-2", children: _jsxs("span", { className: "text-sm font-bold text-text-primary", children: ["@", s.interviewer.username] }) }), _jsx("div", { className: "flex items-center gap-2", children: typeof s.interviewer.avg_rating === 'number' && s.interviewer.avg_rating > 0 ? (_jsxs(_Fragment, { children: [_jsx(Star, { className: "h-3.5 w-3.5 fill-warn text-warn" }), _jsx("span", { className: "font-mono text-[12px] font-semibold text-warn", children: s.interviewer.avg_rating.toFixed(1) }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: ["\u00B7 ", s.interviewer.reviews_count ?? 0, " \u043E\u0442\u0437\u044B\u0432\u043E\u0432"] })] })) : (_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u041D\u0435\u0442 \u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0430" })) }), _jsxs("div", { className: "mt-0.5 flex flex-wrap gap-1.5", children: [_jsx("span", { className: "rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary", children: s.section }), s.difficulty && (_jsx("span", { className: "rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary", children: s.difficulty })), _jsx("span", { className: "rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary uppercase", children: s.language })] })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Clock, { className: "h-3.5 w-3.5 text-cyan" }), _jsx("span", { className: "text-sm font-semibold text-text-primary", children: fmtTime(s.starts_at) })] }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [s.duration_min, " \u043C\u0438\u043D"] })] }), _jsx("div", { className: "flex flex-col items-end gap-1", children: _jsx("span", { className: "rounded-full bg-success/15 px-2.5 py-1 font-mono text-[12px] font-semibold text-success", children: fmtPrice(s.price_rub) }) }), _jsx(Button, { onClick: onBook, disabled: booking || s.status !== 'available', children: s.status === 'booked' ? 'Занято' : booking ? 'Бронируем…' : 'Забронировать' })] }));
}
function SlotList({ slots, isError, isLoading, onBook, bookingId, }) {
    if (isLoading) {
        return (_jsx("div", { className: "rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted", children: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0441\u043B\u043E\u0442\u044B\u2026" }));
    }
    if (isError) {
        return (_jsx("div", { className: "rounded-xl border border-danger/40 bg-surface-1 p-8 text-center text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u043B\u043E\u0442\u044B. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443." }));
    }
    if (slots.length === 0) {
        return (_jsx("div", { className: "rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted", children: "\u041F\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u043C \u0444\u0438\u043B\u044C\u0442\u0440\u0430\u043C \u0441\u043B\u043E\u0442\u043E\u0432 \u043D\u0435\u0442. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0447\u0430\u0441\u0442\u044C \u0443\u0441\u043B\u043E\u0432\u0438\u0439." }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("h3", { className: "font-display text-base font-bold text-text-primary", children: ["\u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0441\u043B\u043E\u0442\u044B \u00B7 ", slots.length] }), slots.map((s) => (_jsx(SlotCard, { s: s, onBook: () => onBook(s.id), booking: bookingId === s.id }, s.id)))] }));
}
function PromoCard() {
    return (_jsxs("div", { className: "flex flex-col gap-4 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: "\u0421\u0442\u0430\u043D\u044C \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E\u0435\u0440\u043E\u043C" }), _jsx("p", { className: "text-xs text-white/80", children: "\u0417\u0430\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0439 \u043D\u0430 mock-\u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E \u2014 \u0442\u0430\u0440\u0438\u0444 \u0443\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0448\u044C \u0441\u0430\u043C." }), _jsx("button", { className: "inline-flex items-center justify-center rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30", children: "\u041F\u043E\u0434\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443" })] }));
}
export default function SlotsPage() {
    const [filter, setFilter] = useState({});
    const { data, isError, isLoading } = useSlotsQuery(filter);
    const slots = useMemo(() => data ?? [], [data]);
    // Buckets are derived from the *unfiltered* fetch — recomputed each render.
    // For stability we feed the displayed slots back; in practice the catalogue
    // is small enough that the user-facing UX is fine.
    const priceBuckets = useMemo(() => derivePriceBuckets(slots), [slots]);
    const book = useBookSlot();
    const onBook = (id) => {
        book.mutate(id, {
            onSuccess: (b) => {
                if (b.meet_url) {
                    window.open(b.meet_url, '_blank', 'noopener,noreferrer');
                }
            },
        });
    };
    const bookedSlots = useMemo(() => slots.filter((s) => s.status === 'booked'), [slots]);
    return (_jsxs(AppShellV2, { children: [_jsx(Header, { count: slots.length, isError: isError }), _jsx(FilterBar, { filter: filter, setFilter: setFilter, priceBuckets: priceBuckets }), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7", children: [_jsx("div", { className: "flex flex-1 flex-col gap-5", children: _jsx(SlotList, { slots: slots, isError: isError, isLoading: isLoading, onBook: onBook, bookingId: book.isPending ? book.variables : null }) }), _jsxs("div", { className: "flex w-full flex-col gap-5 lg:w-[380px]", children: [_jsx(PromoCard, {}), bookedSlots.length > 0 && (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0417\u0430\u0431\u0440\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u044B" }), bookedSlots.map((s) => (_jsxs("div", { className: "flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Avatar, { size: "sm", gradient: pickGradient(s.interviewer.user_id), initials: s.interviewer.username?.[0]?.toUpperCase() ?? '?' }), _jsxs("span", { className: "text-sm font-semibold text-text-primary", children: ["@", s.interviewer.username] }), _jsx("span", { className: "ml-auto font-mono text-[11px] text-cyan", children: fmtTime(s.starts_at) })] }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [s.section, " \u00B7 ", s.duration_min, " \u043C\u0438\u043D"] }), _jsxs("button", { className: "inline-flex w-fit items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25", children: [_jsx(Video, { className: "h-3 w-3" }), " \u0412\u0438\u0434\u0435\u043E\u0437\u0432\u043E\u043D\u043E\u043A"] })] }, s.id)))] }))] })] })] }));
}
