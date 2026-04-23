import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /atlas — интерактивный skill-progress tracker.
//
// Исходная страница была декоративным SVG без смысла. Теперь она:
//   1. Показывает 5 визуальных состояний нод (locked / available / in-progress
//      / mastered / decaying), отражающих реальный прогресс пользователя.
//   2. Отдаёт правый drawer с «Решено N из M», статусом decay, списком
//      рекомендованных ката и связанными нодами при клике на любой узел.
//   3. Поддерживает pan/zoom мышью + кнопками сверху для удобства на больших
//      деревьях.
//   4. Имеет filter bar: search by name + chip-фильтры по category / status.
//   5. Empty-state CTA «Начни с Two Sum →» если у пользователя пока ноль
//      открытых нод.
//
// Источник правды — `useAtlasQuery` (REST GET /api/v1/profile/me/atlas).
// Бэкенд в Wave-2 расширен полями recommended_kata, last_solved_at,
// solved_count, total_count — см. proto/druz9/v1/profile.proto и
// backend/services/profile/app/atlas.go.
import { useState, useMemo, useRef, useCallback, useEffect, } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, RotateCcw, Hexagon, AlertCircle, X, Search, ZoomIn, ZoomOut, Maximize2, CheckCircle2, Lock, Flame, Clock, ArrowRight, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { useAtlasQuery, } from '../lib/queries/profile';
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
const CANVAS_W = 960;
const CANVAS_H = 700;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;
const RADIUS_INNER = 140;
const RADIUS_OUTER = 260;
const NODE_SIZE_NORMAL = 56;
const NODE_SIZE_KEYSTONE = 72;
const NODE_SIZE_CENTER = 96;
function nodeState(n) {
    if (n.decaying)
        return 'decaying';
    if (n.unlocked && n.progress >= 80)
        return 'mastered';
    if (n.unlocked && n.progress > 0)
        return 'in_progress';
    if (n.unlocked)
        return 'available';
    if (n.progress > 0)
        return 'in_progress';
    return 'locked';
}
const STATE_LABEL = {
    locked: 'Заблокирован',
    available: 'Доступен',
    in_progress: 'В процессе',
    mastered: 'Освоен',
    decaying: 'Затухает',
};
const STATE_COLOR = {
    locked: 'border border-border bg-surface-2',
    available: 'bg-accent text-text-primary',
    in_progress: 'bg-bg border-2 border-dashed border-accent-hover ring-2 ring-accent/30 animate-pulse',
    mastered: 'bg-success text-text-primary shadow-glow',
    decaying: 'bg-bg border-2 border-warn ring-2 ring-warn/40 animate-pulse',
};
function edgeState(from, to) {
    if (!from || !to)
        return 'faded';
    if (from.unlocked && to.unlocked)
        return 'solid';
    if (from.unlocked)
        return 'dashed';
    return 'faded';
}
function computeLayout(atlas) {
    const positions = new Map();
    const center = atlas.nodes.find((n) => n.key === atlas.center_node);
    const others = atlas.nodes.filter((n) => n.key !== atlas.center_node);
    const outer = others.filter((n) => n.kind === 'keystone' || n.kind === 'ascendant');
    const inner = others.filter((n) => n.kind !== 'keystone' && n.kind !== 'ascendant');
    if (center) {
        positions.set(center.key, {
            node: center,
            x: CENTER_X,
            y: CENTER_Y,
            size: NODE_SIZE_CENTER,
        });
    }
    const placeRing = (list, radius, size) => {
        if (list.length === 0)
            return;
        const step = (2 * Math.PI) / list.length;
        list.forEach((n, idx) => {
            const angle = -Math.PI / 2 + step * idx;
            positions.set(n.key, {
                node: n,
                x: CENTER_X + radius * Math.cos(angle),
                y: CENTER_Y + radius * Math.sin(angle),
                size,
            });
        });
    };
    placeRing(outer, RADIUS_OUTER, NODE_SIZE_KEYSTONE);
    placeRing(inner, RADIUS_INNER, NODE_SIZE_NORMAL);
    return positions;
}
function shortLabel(title) {
    const main = title.split(':')[0].trim();
    const words = main.split(/\s+/).filter(Boolean);
    if (words.length === 1)
        return words[0].slice(0, 4).toUpperCase();
    return words
        .slice(0, 3)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');
}
function sectionLabel(section) {
    const map = {
        SECTION_ALGORITHMS: 'Алгоритмы',
        SECTION_SQL: 'SQL',
        SECTION_GO: 'Go / Backend',
        SECTION_SYSTEM_DESIGN: 'System Design',
        SECTION_BEHAVIORAL: 'Behavioral',
        SECTION_CONCURRENCY: 'Concurrency',
        SECTION_DATA_STRUCTURES: 'Data Structures',
        algorithms: 'Алгоритмы',
        sql: 'SQL',
        go: 'Go / Backend',
        system_design: 'System Design',
        behavioral: 'Behavioral',
    };
    return map[section] ?? section;
}
const CATEGORIES = [
    {
        key: 'algorithms',
        label: 'Algorithms',
        sections: ['SECTION_ALGORITHMS', 'algorithms'],
    },
    {
        key: 'data_structures',
        label: 'Data Structures',
        sections: ['SECTION_DATA_STRUCTURES', 'data_structures'],
    },
    {
        key: 'system_design',
        label: 'System Design',
        sections: ['SECTION_SYSTEM_DESIGN', 'system_design'],
    },
    {
        key: 'backend',
        label: 'Backend',
        sections: ['SECTION_GO', 'SECTION_SQL', 'go', 'sql'],
    },
    {
        key: 'concurrency',
        label: 'Concurrency',
        sections: ['SECTION_CONCURRENCY'],
    },
];
const STATUS_FILTERS = [
    { key: 'all', label: 'Все' },
    { key: 'locked', label: 'Закрытые' },
    { key: 'available', label: 'Доступные' },
    { key: 'in_progress', label: 'В процессе' },
    { key: 'mastered', label: 'Освоенные' },
    { key: 'decaying', label: 'Затухающие' },
];
function daysSince(iso) {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        return null;
    const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    return days < 0 ? 0 : days;
}
// ── NodeShape — кликабельный «узел» с одним из 5 визуальных состояний.
function NodeShape({ pos, selected, faded, onClick, }) {
    const { node, x, y, size } = pos;
    const state = nodeState(node);
    const stateClass = STATE_COLOR[state];
    const shapeStyle = node.kind === 'keystone' || node.kind === 'ascendant'
        ? { clipPath: HEX_CLIP }
        : {};
    const selectedRing = selected ? 'ring-4 ring-cyan ring-offset-2 ring-offset-bg z-10' : '';
    const fadedClass = faded ? 'opacity-25' : '';
    const masteredCheck = state === 'mastered' && (_jsx("span", { className: "absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-success text-bg shadow", children: _jsx(CheckCircle2, { className: "h-3.5 w-3.5" }) }));
    const lockBadge = state === 'locked' && (_jsx("span", { className: "absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-surface-3 text-text-muted", children: _jsx(Lock, { className: "h-3 w-3" }) }));
    return (_jsxs("button", { type: "button", onClick: onClick, className: `absolute grid place-items-center font-display font-bold transition-transform hover:scale-110 ${stateClass} ${selectedRing} ${fadedClass}`, style: {
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
            borderRadius: node.kind === 'keystone' || node.kind === 'ascendant' ? 0 : size / 2,
            ...shapeStyle,
        }, "aria-label": `${node.title} — ${STATE_LABEL[state]}`, children: [_jsx("span", { className: "px-1 text-center font-mono text-[9px] uppercase tracking-[0.06em]", children: shortLabel(node.title) }), masteredCheck, lockBadge] }));
}
// ── ConnectionLine — рисует ребро prereq → unlock с тремя состояниями.
// Также, если оба unlocked, добавляется маленькая стрелочка в середине, чтобы
// направление было читаемо.
function ConnectionLine({ x1, y1, x2, y2, state, }) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    let cls = '';
    if (state === 'solid')
        cls = 'bg-accent h-[2px]';
    else if (state === 'dashed')
        cls = 'h-px bg-[length:8px_1px] bg-no-repeat bg-[linear-gradient(to_right,theme(colors.accent.hover/.7)_50%,transparent_50%)]';
    else
        cls = 'bg-border h-px opacity-30';
    return (_jsx("div", { className: `absolute origin-left ${cls}`, style: {
            left: x1,
            top: y1,
            width: len,
            transform: `rotate(${angle}deg)`,
        } }));
}
// ── FilterBar — search + category chips + status chips. Поддерживает «сброс».
function FilterBar({ query, setQuery, category, setCategory, status, setStatus, }) {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-8 lg:px-20", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "relative flex-1 max-w-md", children: [_jsx(Search, { className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" }), _jsx("input", { type: "text", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E \u043D\u0430\u0432\u044B\u043A\u0430\u2026", className: "h-9 w-full rounded-md border border-border bg-bg pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" })] }), (query || category !== 'all' || status !== 'all') && (_jsx(Button, { variant: "ghost", size: "sm", onClick: () => {
                            setQuery('');
                            setCategory('all');
                            setStatus('all');
                        }, children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C" }))] }), _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [_jsx(FilterChip, { active: category === 'all', onClick: () => setCategory('all'), label: "\u0412\u0441\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u0438" }), CATEGORIES.map((c) => (_jsx(FilterChip, { active: category === c.key, onClick: () => setCategory(c.key), label: c.label }, c.key)))] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: STATUS_FILTERS.map((s) => (_jsx(FilterChip, { active: status === s.key, onClick: () => setStatus(s.key), label: s.label, tone: s.key === 'mastered' ? 'success' : s.key === 'decaying' ? 'warn' : 'default' }, s.key))) })] }));
}
function FilterChip({ active, onClick, label, tone = 'default', }) {
    const base = 'rounded-full px-3 py-1 text-xs uppercase transition-colors';
    const activeCls = tone === 'success'
        ? 'border-success/60 bg-success/15 text-success border'
        : tone === 'warn'
            ? 'border-warn/60 bg-warn/15 text-warn border'
            : 'border-accent bg-accent/15 text-text-primary border';
    const inactiveCls = 'border border-border bg-surface-2 text-text-secondary hover:border-border-strong';
    return (_jsx("button", { type: "button", onClick: onClick, className: `${base} ${active ? activeCls : inactiveCls}`, children: label }));
}
// ── ZoomControls — pan/zoom через transform: scale + drag. Mini-mape не
// делаем (брифа — «опционально»). Reset возвращает scale=1, offset=(0,0).
function ZoomControls({ scale, setScale, reset, }) {
    return (_jsxs("div", { className: "absolute right-4 top-4 z-20 flex flex-col gap-1 rounded-md border border-border bg-surface-1/90 p-1 backdrop-blur", children: [_jsx("button", { type: "button", onClick: () => setScale(Math.min(2, scale + 0.15)), "aria-label": "Zoom in", className: "rounded p-1.5 text-text-secondary hover:bg-surface-2", children: _jsx(ZoomIn, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", onClick: () => setScale(Math.max(0.5, scale - 0.15)), "aria-label": "Zoom out", className: "rounded p-1.5 text-text-secondary hover:bg-surface-2", children: _jsx(ZoomOut, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", onClick: reset, "aria-label": "Reset view", className: "rounded p-1.5 text-text-secondary hover:bg-surface-2", children: _jsx(Maximize2, { className: "h-4 w-4" }) })] }));
}
// ── GraphCanvas — собственно интерактивный граф. Pan через mousedown + drag,
// zoom через ZoomControls (или wheel, если хочется потом).
function GraphCanvas({ atlas, selectedKey, onSelect, highlightKeys, }) {
    const layout = useMemo(() => computeLayout(atlas), [atlas]);
    const positions = Array.from(layout.values());
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef(null);
    const onMouseDown = (e) => {
        // Не перехватываем клик по узлу — он обработается своим onClick.
        if (e.target.closest('button'))
            return;
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            ox: offset.x,
            oy: offset.y,
        };
    };
    const onMouseMove = (e) => {
        if (!dragRef.current)
            return;
        setOffset({
            x: dragRef.current.ox + (e.clientX - dragRef.current.startX),
            y: dragRef.current.oy + (e.clientY - dragRef.current.startY),
        });
    };
    const stopDrag = () => {
        dragRef.current = null;
    };
    const reset = useCallback(() => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    }, []);
    return (_jsxs("div", { className: "relative flex-1 overflow-hidden bg-bg", style: { minHeight: 720, cursor: dragRef.current ? 'grabbing' : 'grab' }, onMouseDown: onMouseDown, onMouseMove: onMouseMove, onMouseUp: stopDrag, onMouseLeave: stopDrag, children: [_jsx(ZoomControls, { scale: scale, setScale: setScale, reset: reset }), _jsx("div", { className: "pointer-events-none absolute", style: {
                    width: 800,
                    height: 800,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'radial-gradient(ellipse at center, #2D1B4D 0%, transparent 70%)',
                    opacity: 0.55,
                } }), _jsxs("div", { className: "relative", style: {
                    width: CANVAS_W,
                    height: CANVAS_H,
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: 'center center',
                    margin: '0 auto',
                }, children: [atlas.edges.map((e, idx) => {
                        const a = layout.get(e.from);
                        const b = layout.get(e.to);
                        if (!a || !b)
                            return null;
                        return (_jsx(ConnectionLine, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, state: edgeState(a.node, b.node) }, `${e.from}-${e.to}-${idx}`));
                    }), positions.map((p) => (_jsx(NodeShape, { pos: p, selected: p.node.key === selectedKey, faded: highlightKeys !== null && !highlightKeys.has(p.node.key), onClick: () => onSelect(p.node.key) }, p.node.key)))] })] }));
}
// ── NodeDrawer — правый drawer с прогрессом, decay, рекомендациями, related.
// На mobile — full-width снизу. Закрывается клавишей Esc и кликом по подложке.
function NodeDrawer({ atlas, node, onClose, onSelectNeighbour, }) {
    // Esc — close.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    const state = nodeState(node);
    const days = daysSince(node.last_solved_at);
    const solved = node.solved_count ?? 0;
    const total = node.total_count ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((solved / total) * 100)) : node.progress;
    const recommended = node.recommended_kata ?? [];
    // Связанные ноды: prereq (edge.to === node.key) и unlocks (edge.from === node.key).
    const prereqs = atlas.edges
        .filter((e) => e.to === node.key)
        .map((e) => atlas.nodes.find((n) => n.key === e.from))
        .filter((n) => Boolean(n));
    const unlocks = atlas.edges
        .filter((e) => e.from === node.key)
        .map((e) => atlas.nodes.find((n) => n.key === e.to))
        .filter((n) => Boolean(n));
    // CTA «Решить рекомендованное сейчас» — пушит на первый рекомендованный
    // ката. Если нет рекомендаций (новая, ещё не настроенная нода) — вместо
    // этого ведёт на /arena с фильтром по секции.
    const primaryHref = recommended.length > 0
        ? `/daily/kata/${encodeURIComponent(recommended[0].id)}`
        : `/arena?skill=${encodeURIComponent(node.key)}`;
    return (_jsxs("div", { className: "fixed inset-0 z-50 flex items-stretch justify-end", role: "dialog", "aria-modal": "true", children: [_jsx("div", { className: "absolute inset-0 bg-black/40", onClick: onClose, role: "button", tabIndex: -1, "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" }), _jsxs("aside", { className: "relative h-full w-full max-w-[440px] overflow-y-auto bg-surface-1 shadow-card", children: [_jsxs("div", { className: "sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-5 py-3", children: [_jsx("span", { className: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase ${stateBadgeClass(state)}`, children: STATE_LABEL[state] }), _jsx("button", { type: "button", onClick: onClose, className: "rounded-md p-1.5 text-text-secondary hover:bg-surface-2", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { className: "h-4 w-4" }) })] }), _jsxs("div", { className: "flex flex-col gap-5 p-5", children: [_jsxs("div", { children: [_jsx("h2", { className: "font-display text-[22px] font-bold leading-tight text-text-primary", children: node.title }), _jsxs("span", { className: "mt-0.5 block font-mono text-xs text-text-muted", children: [sectionLabel(node.section), " \u00B7 ", node.kind] })] }), node.description && (_jsx("p", { className: "rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary", children: node.description })), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted", children: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441" }), _jsx("span", { className: "font-mono text-xs text-text-secondary", children: total > 0 ? `${solved} из ${total} задач` : `${pct}%` })] }), _jsx("div", { className: "h-2 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: `h-full rounded-full ${state === 'mastered'
                                                ? 'bg-gradient-to-r from-success to-cyan'
                                                : state === 'decaying'
                                                    ? 'bg-gradient-to-r from-warn to-danger'
                                                    : 'bg-gradient-to-r from-cyan to-accent'}`, style: { width: `${pct}%` } }) })] }), (node.decaying || days !== null) && (_jsxs("div", { className: `flex items-start gap-3 rounded-lg p-3 ${node.decaying ? 'bg-warn/10 border border-warn/30' : 'bg-surface-2'}`, children: [node.decaying ? (_jsx(Flame, { className: "h-4 w-4 shrink-0 text-warn" })) : (_jsx(Clock, { className: "h-4 w-4 shrink-0 text-text-muted" })), _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-sm text-text-primary", children: node.decaying
                                                    ? `Ты не решал эту тему ${days ?? '?'} дней — знание тает`
                                                    : days === 0
                                                        ? 'Решал сегодня'
                                                        : `Последняя задача: ${days ?? '?'} дн. назад` }), node.decaying && (_jsx("span", { className: "text-xs text-text-muted", children: "\u0420\u0435\u0448\u0438 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u0437\u0430\u0434\u0430\u0447\u0443, \u0447\u0442\u043E\u0431\u044B \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C decay." }))] })] })), recommended.length > 0 ? (_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted", children: "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043A\u0430\u0442\u0430" }), _jsx("ul", { className: "flex flex-col gap-1.5", children: recommended.slice(0, 5).map((k) => (_jsx(KataItem, { k: k }, k.id))) })] })) : (_jsxs("div", { className: "rounded-lg bg-surface-2 p-3 text-xs text-text-muted", children: ["\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u043A\u0430\u0442\u0430 \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u0442\u0435\u043C\u044B \u0435\u0449\u0451 \u043D\u0435 \u0440\u0430\u0437\u043C\u0435\u0447\u0435\u043D \u2014 \u043F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u043E\u0442\u043A\u0440\u044B\u0442\u044C", ' ', _jsx(Link, { to: "/arena", className: "text-accent hover:underline", children: "\u0410\u0440\u0435\u043D\u0443 \u0441 \u0444\u0438\u043B\u044C\u0442\u0440\u043E\u043C \u043F\u043E \u0442\u0435\u043C\u0435" }), "."] })), _jsx(Link, { to: primaryHref, className: "block", children: _jsx(Button, { size: "md", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "w-full", children: recommended.length > 0
                                        ? 'Решить рекомендованное сейчас'
                                        : 'Открыть на Арене' }) }), (prereqs.length > 0 || unlocks.length > 0) && (_jsxs("div", { className: "flex flex-col gap-3 border-t border-border pt-4", children: [prereqs.length > 0 && (_jsx(RelatedGroup, { title: "\u041E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u044D\u0442\u043E\u043C\u0443", nodes: prereqs, onClick: onSelectNeighbour })), unlocks.length > 0 && (_jsx(RelatedGroup, { title: "\u042D\u0442\u043E\u0442 \u0443\u0437\u0435\u043B \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442", nodes: unlocks, onClick: onSelectNeighbour }))] }))] })] })] }));
}
function stateBadgeClass(state) {
    switch (state) {
        case 'mastered':
            return 'bg-success/15 text-success';
        case 'decaying':
            return 'bg-warn/15 text-warn';
        case 'in_progress':
            return 'bg-accent/15 text-accent-hover';
        case 'available':
            return 'bg-cyan/15 text-cyan';
        default:
            return 'bg-surface-2 text-text-muted';
    }
}
function KataItem({ k }) {
    const diffColor = k.difficulty === 'easy'
        ? 'text-success'
        : k.difficulty === 'medium'
            ? 'text-warn'
            : 'text-danger';
    return (_jsx("li", { children: _jsxs(Link, { to: `/daily/kata/${encodeURIComponent(k.id)}`, className: "flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary transition-colors hover:border-accent", children: [_jsxs("div", { className: "flex min-w-0 flex-col", children: [_jsx("span", { className: "truncate", children: k.title }), _jsxs("span", { className: `font-mono text-[10px] uppercase ${diffColor}`, children: [k.difficulty, k.estimated_minutes ? ` · ~${k.estimated_minutes} мин` : ''] })] }), _jsx(ArrowRight, { className: "h-4 w-4 shrink-0 text-text-muted" })] }) }));
}
function RelatedGroup({ title, nodes, onClick, }) {
    return (_jsxs("div", { children: [_jsx("span", { className: "font-mono text-[10px] font-semibold uppercase tracking-wider text-text-muted", children: title }), _jsx("div", { className: "mt-1.5 flex flex-wrap gap-1.5", children: nodes.map((n) => (_jsx("button", { type: "button", onClick: () => onClick(n.key), className: "rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-primary hover:border-accent", children: n.title }, n.key))) })] }));
}
// ── HeaderStrip / GraphSkeleton / EmptyProgressCTA / LegendStrip
function HeaderStrip({ unlocked, total, isError, onRetry, }) {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-6", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]", children: "Skill Atlas" }), _jsx("p", { className: "font-mono text-xs text-text-muted", children: isError ? 'Не удалось загрузить' : `${unlocked} / ${total} узлов открыто` })] }), _jsx("div", { className: "flex items-center gap-2", children: isError && (_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(RotateCcw, { className: "h-3.5 w-3.5" }), onClick: onRetry, children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })) })] }));
}
function GraphSkeleton() {
    const ring = Array.from({ length: 6 }).map((_, idx) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * idx) / 6;
        return {
            x: CENTER_X + RADIUS_OUTER * Math.cos(angle),
            y: CENTER_Y + RADIUS_OUTER * Math.sin(angle),
        };
    });
    return (_jsx("div", { className: "relative flex-1 overflow-auto bg-bg", style: { minHeight: 720, padding: 40 }, children: _jsxs("div", { className: "relative", style: { width: CANVAS_W, height: CANVAS_H }, children: [_jsx("div", { className: "absolute animate-pulse rounded-full bg-surface-2", style: {
                        left: CENTER_X - NODE_SIZE_CENTER / 2,
                        top: CENTER_Y - NODE_SIZE_CENTER / 2,
                        width: NODE_SIZE_CENTER,
                        height: NODE_SIZE_CENTER,
                    } }), ring.map((p, i) => (_jsx("div", { className: "absolute animate-pulse rounded-md bg-surface-2", style: {
                        left: p.x - NODE_SIZE_KEYSTONE / 2,
                        top: p.y - NODE_SIZE_KEYSTONE / 2,
                        width: NODE_SIZE_KEYSTONE,
                        height: NODE_SIZE_KEYSTONE,
                    } }, i)))] }) }));
}
function EmptyProgressCTA() {
    // Брифа: «Если у пользователя ещё ноль unlocked — большой CTA «Начни с Two
    // Sum →» в центре атласа». ID two-sum совпадает с recommendedKataByNode для
    // algo_basics + class_core (см. backend atlas.go).
    return (_jsx("div", { className: "flex flex-1 items-center justify-center bg-bg p-8", children: _jsxs("div", { className: "flex max-w-lg flex-col items-center gap-5 text-center", children: [_jsx("span", { className: "grid h-16 w-16 place-items-center rounded-full bg-accent/15 text-accent-hover", children: _jsx(Sparkles, { className: "h-7 w-7" }) }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: "\u0410\u0442\u043B\u0430\u0441 \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0420\u0435\u0448\u0438 \u043F\u0435\u0440\u0432\u0443\u044E \u0437\u0430\u0434\u0430\u0447\u0443 \u2014 \u0438 \u0441\u044E\u0434\u0430 \u043F\u0440\u0438\u0434\u0443\u0442 \u043F\u0435\u0440\u0432\u044B\u0435 \u043D\u0430\u0432\u044B\u043A\u0438. \u0410\u0442\u043B\u0430\u0441 \u043F\u043E\u043A\u0430\u0436\u0435\u0442, \u0447\u0442\u043E \u0442\u044B \u0443\u0436\u0435 \u043E\u0441\u0432\u043E\u0438\u043B, \u043A\u0430\u043A\u0438\u0435 \u0442\u0435\u043C\u044B \u0441\u0442\u043E\u0438\u0442 \u043F\u043E\u0434\u0442\u044F\u043D\u0443\u0442\u044C \u0438 \u043A\u0430\u043A\u0438\u0435 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0435 \u0448\u0430\u0433\u0438 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u044B." })] }), _jsx(Link, { to: "/daily/kata/two-sum", children: _jsx(Button, { size: "md", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), children: "\u041D\u0430\u0447\u043D\u0438 \u0441 Two Sum" }) })] }) }));
}
function LegendStrip() {
    return (_jsxs("div", { className: "flex h-14 items-center gap-4 overflow-x-auto border-t border-border bg-surface-1 px-4 sm:gap-6 sm:px-8 lg:px-20", children: [_jsx(LegendDot, { cls: "bg-accent", label: "\u0414\u043E\u0441\u0442\u0443\u043F\u0435\u043D" }), _jsx(LegendDot, { cls: "bg-bg border-2 border-dashed border-accent-hover", label: "\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0435" }), _jsx(LegendDot, { cls: "bg-success", label: "\u041E\u0441\u0432\u043E\u0435\u043D" }), _jsx(LegendDot, { cls: "bg-bg border-2 border-warn", label: "\u0417\u0430\u0442\u0443\u0445\u0430\u0435\u0442" }), _jsx(LegendDot, { cls: "border border-border bg-surface-2", label: "\u0417\u0430\u043A\u0440\u044B\u0442" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Hexagon, { className: "h-4 w-4 fill-warn text-warn" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "Keystone" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Hexagon, { className: "h-4 w-4 fill-pink text-pink" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "Ascendant" })] })] }));
}
function LegendDot({ cls, label }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `h-3.5 w-3.5 rounded-full ${cls}` }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: label })] }));
}
// ── AtlasPage — оркестратор. Мостит filter bar → highlight set → drawer.
export default function AtlasPage() {
    const { data: atlas, isError, isLoading, refetch } = useAtlasQuery();
    const total = atlas?.nodes.length ?? 0;
    const unlocked = atlas?.nodes.filter((n) => n.unlocked).length ?? 0;
    const [selectedKey, setSelectedKey] = useState(null);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [status, setStatus] = useState('all');
    // highlightKeys = подсвеченные ноды по фильтрам. null = «нет активных
    // фильтров, не приглушаем». Иначе — set ключей, остальные ноды get faded.
    const highlightKeys = useMemo(() => {
        if (!atlas)
            return null;
        const noFilters = !query.trim() && category === 'all' && status === 'all';
        if (noFilters)
            return null;
        const cat = CATEGORIES.find((c) => c.key === category);
        const q = query.trim().toLowerCase();
        const keys = new Set();
        for (const n of atlas.nodes) {
            if (cat && !cat.sections.includes(n.section))
                continue;
            if (q && !n.title.toLowerCase().includes(q))
                continue;
            if (status !== 'all' && nodeState(n) !== status)
                continue;
            keys.add(n.key);
        }
        return keys;
    }, [atlas, query, category, status]);
    const isProgressEmpty = !!atlas && atlas.nodes.length > 0 && unlocked === 0;
    const selectedNode = atlas && selectedKey ? atlas.nodes.find((n) => n.key === selectedKey) ?? null : null;
    return (_jsxs(AppShellV2, { children: [_jsxs("div", { className: "flex flex-col", children: [_jsx(HeaderStrip, { unlocked: unlocked, total: total, isError: isError, onRetry: () => void refetch() }), !isLoading && !isError && atlas && atlas.nodes.length > 0 && (_jsx(FilterBar, { query: query, setQuery: setQuery, category: category, setCategory: setCategory, status: status, setStatus: setStatus })), _jsx("div", { className: "flex flex-col lg:flex-row", children: isLoading ? (_jsx(GraphSkeleton, {})) : isError || !atlas ? (_jsx("div", { className: "flex flex-1 items-center justify-center bg-bg p-8", children: _jsxs("div", { className: "flex max-w-md flex-col items-center gap-3 text-center", children: [_jsx(AlertCircle, { className: "h-8 w-8 text-danger" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0430\u0442\u043B\u0430\u0441. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u2014 \u0435\u0441\u043B\u0438 \u043E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u0435\u0442\u0441\u044F, \u043F\u0440\u043E\u0432\u0435\u0440\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435." }), _jsx(Button, { variant: "primary", icon: _jsx(RotateCcw, { className: "h-3.5 w-3.5" }), onClick: () => void refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }) })) : atlas.nodes.length === 0 ? (_jsx(EmptyProgressCTA, {})) : isProgressEmpty ? (
                        // Граф есть, но прогресса нет — показываем CTA + сам граф ниже,
                        // чтобы пользователь видел будущую карту.
                        _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx(EmptyProgressCTA, {}), _jsx(GraphCanvas, { atlas: atlas, selectedKey: selectedKey, onSelect: setSelectedKey, highlightKeys: highlightKeys })] })) : (_jsx(GraphCanvas, { atlas: atlas, selectedKey: selectedKey, onSelect: setSelectedKey, highlightKeys: highlightKeys })) }), _jsx(LegendStrip, {})] }), selectedNode && atlas && (_jsx(NodeDrawer, { atlas: atlas, node: selectedNode, onClose: () => setSelectedKey(null), onSelectNeighbour: (k) => setSelectedKey(k) }))] }));
}
