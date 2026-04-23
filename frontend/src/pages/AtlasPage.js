import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /atlas — skill graph пользователя.
//
// Источник правды — `profile.GetMyAtlas` (REST: GET /api/v1/profile/me/atlas)
// через `useAtlasQuery` (queries/profile.ts). Ответ — { center_node, nodes,
// edges }; nodes несут kind = "keystone" | "ascendant" | "normal", флаги
// unlocked / decaying и progress.
//
// Раньше страница была захардкожена на 22 поддельных узла с pixel-coordinates
// «top: 90, left: 500» и витиеватыми лейблами «Sliding Window Sage». Сейчас
// — детерминированный radial-layout, считающийся на лету по реальному
// каталогу: keystones и ascendants — на внешнем кольце, normal — на внутреннем,
// центральный узел — в середине. Если бэк добавит новый skill, он автоматически
// окажется в правильной зоне без ручной правки координат.
//
// Loading: skeleton со skeleton-ring узлов. Error: retry-CTA. Empty: пустое
// состояние с пояснением.
import { useState, useMemo } from 'react';
import { Sparkles, RotateCcw, TrendingUp, Unlock, Hexagon, AlertCircle, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { useAtlasQuery } from '../lib/queries/profile';
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
// CANVAS_W / CANVAS_H — фиксированный логический размер графа. Реальный
// контейнер скроллится; absolute-positioning внутри использует эти числа
// как basis. radius_inner / outer выбраны так, чтобы 6–10 keystones и
// 10–20 normal-узлов влезли без визуальных коллизий.
const CANVAS_W = 960;
const CANVAS_H = 700;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;
const RADIUS_INNER = 140;
const RADIUS_OUTER = 260;
const NODE_SIZE_NORMAL = 56;
const NODE_SIZE_KEYSTONE = 72;
const NODE_SIZE_CENTER = 96;
// computeLayout — детерминированный полярный layout.
//   - центральный узел (по center_node) — в центре.
//   - keystones и ascendants — равномерно по внешнему кольцу.
//   - normal — равномерно по внутреннему.
// Один и тот же массив nodes даёт ту же раскладку на каждом рендере, что
// важно для пользовательской привычки.
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
    // -π/2 — старт сверху, по часовой стрелке. Гарантирует «ALGO сверху»
    // как в дизайне, без жёстких координат.
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
function nodeStateColor(n) {
    if (n.unlocked) {
        if (n.kind === 'keystone')
            return { fill: 'bg-warn/90', ring: '', label: 'text-bg' };
        if (n.kind === 'ascendant')
            return { fill: 'bg-pink', ring: '', label: 'text-bg' };
        return { fill: 'bg-accent', ring: '', label: 'text-text-primary' };
    }
    if (n.progress > 0) {
        return { fill: 'bg-bg', ring: 'border-2 border-dashed border-accent-hover', label: 'text-accent-hover' };
    }
    return { fill: 'bg-surface-2', ring: 'border border-border', label: 'text-text-muted' };
}
function NodeShape({ pos, selected, onClick, }) {
    const { node, x, y, size } = pos;
    const { fill, ring, label } = nodeStateColor(node);
    const shapeStyle = node.kind === 'keystone' || node.kind === 'ascendant'
        ? { clipPath: HEX_CLIP }
        : {};
    const glow = node.unlocked ? 'shadow-glow' : '';
    const selectedRing = selected ? 'ring-2 ring-cyan ring-offset-2 ring-offset-bg' : '';
    const decay = node.decaying ? 'opacity-60' : '';
    return (_jsx("button", { type: "button", onClick: onClick, className: `absolute grid place-items-center font-display font-bold transition-transform hover:scale-110 ${fill} ${ring} ${glow} ${selectedRing} ${decay}`, style: {
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
            borderRadius: node.kind === 'keystone' || node.kind === 'ascendant' ? 0 : size / 2,
            ...shapeStyle,
        }, "aria-label": node.title, children: _jsx("span", { className: `px-1 text-center font-mono text-[9px] uppercase tracking-[0.06em] ${label}`, children: shortLabel(node.title) }) }));
}
// shortLabel — даёт краткий ярлык 2–3 буквы. Для сегмента «Алгоритмы:
// основы» вернёт «АЛГ». Не пытается быть умным: первые буквы слов из
// первого « : »-сегмента.
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
function ConnectionLine({ x1, y1, x2, y2, highlighted, }) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (_jsx("div", { className: `absolute origin-left ${highlighted ? 'bg-accent' : 'bg-border'}`, style: {
            left: x1,
            top: y1,
            width: len,
            height: highlighted ? 2 : 1,
            transform: `rotate(${angle}deg)`,
        } }));
}
function HeaderStrip({ unlocked, total, isError, onRetry, }) {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-6", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]", children: "Skill Atlas" }), _jsx("p", { className: "font-mono text-xs text-text-muted", children: isError ? 'Не удалось загрузить' : `${unlocked} / ${total} узлов открыто` })] }), _jsx("div", { className: "flex items-center gap-2", children: isError && (_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(RotateCcw, { className: "h-3.5 w-3.5" }), onClick: onRetry, children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })) })] }));
}
function GraphSkeleton() {
    // Простой shimmer-каркас: центральный узел + 6 «keystones» по кругу.
    // Не пытается имитировать конкретное дерево пользователя.
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
function GraphCanvas({ atlas, selectedKey, onSelect, }) {
    const layout = useMemo(() => computeLayout(atlas), [atlas]);
    const positions = Array.from(layout.values());
    return (_jsxs("div", { className: "relative flex-1 overflow-auto bg-bg", style: { minHeight: 720, padding: 40 }, children: [_jsx("div", { className: "pointer-events-none absolute", style: {
                    width: 800,
                    height: 800,
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'radial-gradient(ellipse at center, #2D1B4D 0%, transparent 70%)',
                    opacity: 0.7,
                } }), _jsxs("div", { className: "relative", style: { width: CANVAS_W, height: CANVAS_H }, children: [atlas.edges.map((e, idx) => {
                        const a = layout.get(e.from);
                        const b = layout.get(e.to);
                        if (!a || !b)
                            return null;
                        const highlighted = a.node.unlocked && b.node.unlocked;
                        return (_jsx(ConnectionLine, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, highlighted: highlighted }, `${e.from}-${e.to}-${idx}`));
                    }), positions.map((p) => (_jsx(NodeShape, { pos: p, selected: p.node.key === selectedKey, onClick: () => onSelect(p.node.key) }, p.node.key)))] })] }));
}
function NodeDetails({ node }) {
    if (!node) {
        return (_jsxs("aside", { className: "flex w-full shrink-0 flex-col gap-3 border-t border-border bg-surface-1 p-6 lg:w-[380px] lg:border-l lg:border-t-0", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0412\u042B\u0411\u0415\u0420\u0418 \u0423\u0417\u0415\u041B" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041A\u043B\u0438\u043A\u043D\u0438 \u043D\u0430 \u043B\u044E\u0431\u043E\u0439 \u0443\u0437\u0435\u043B \u0433\u0440\u0430\u0444\u0430 \u0441\u043B\u0435\u0432\u0430, \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C \u0435\u0433\u043E \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435, \u044D\u0444\u0444\u0435\u043A\u0442\u044B \u0438 \u043F\u0440\u0435\u0434\u0443\u0441\u043B\u043E\u0432\u0438\u044F." })] }));
    }
    const kindLabel = node.kind === 'keystone' ? 'Keystone'
        : node.kind === 'ascendant' ? 'Ascendant'
            : 'Notable';
    const stateLabel = node.unlocked
        ? 'Открыт'
        : node.progress > 0
            ? `В процессе · ${node.progress}%`
            : 'Закрыт';
    return (_jsxs("aside", { className: "flex w-full shrink-0 flex-col gap-5 border-t border-border bg-surface-1 p-6 lg:w-[380px] lg:border-l lg:border-t-0", children: [_jsx("div", { children: _jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: kindLabel.toUpperCase() }) }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("h2", { className: "font-display text-[24px] font-bold leading-tight text-text-primary", children: node.title }), _jsxs("span", { className: "font-mono text-xs text-text-muted", children: [sectionLabel(node.section), " \u00B7 ", stateLabel] })] }), _jsx("div", { className: "rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-text-secondary", children: node.description || 'Описание узла появится позже.' }), node.unlocked && (_jsxs("div", { className: "flex flex-col gap-2.5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0421\u0422\u0410\u0422\u0423\u0421" }), _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-success/15", children: _jsx(Unlock, { className: "h-3.5 w-3.5 text-success" }) }), _jsx("span", { className: "text-[13px] text-text-secondary", children: "\u0423\u0437\u0435\u043B \u043E\u0442\u043A\u0440\u044B\u0442" })] }), node.decaying && (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-warn/15", children: _jsx(AlertCircle, { className: "h-3.5 w-3.5 text-warn" }) }), _jsx("span", { className: "text-[13px] text-text-secondary", children: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0437\u0430\u0442\u0443\u0445\u0430\u0435\u0442 \u2014 \u0440\u0435\u0448\u0438 \u0437\u0430\u0434\u0430\u0447\u0443 \u0438\u0437 \u0441\u0435\u043A\u0446\u0438\u0438, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0430\u0442\u044C." })] }))] })), !node.unlocked && (_jsxs("div", { className: "flex flex-col gap-2.5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u041F\u0420\u041E\u0413\u0420\u0415\u0421\u0421" }), _jsx("div", { className: "h-2 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: `${Math.max(0, Math.min(100, node.progress))}%` } }) }), _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-accent/15", children: _jsx(TrendingUp, { className: "h-3.5 w-3.5 text-accent-hover" }) }), _jsxs("span", { className: "text-[13px] text-text-secondary", children: ["\u0420\u0435\u0448\u0430\u0439 \u0437\u0430\u0434\u0430\u0447\u0438 \u0441\u0435\u043A\u0446\u0438\u0438 \u00AB", sectionLabel(node.section), "\u00BB, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0443\u0437\u0435\u043B."] })] })] }))] }));
}
function sectionLabel(section) {
    // Бэк присылает enum-строку SECTION_ALGORITHMS / SECTION_SQL / etc.
    const map = {
        SECTION_ALGORITHMS: 'Алгоритмы',
        SECTION_SQL: 'SQL',
        SECTION_GO: 'Go',
        SECTION_SYSTEM_DESIGN: 'System Design',
        SECTION_BEHAVIORAL: 'Behavioral',
        algorithms: 'Алгоритмы',
        sql: 'SQL',
        go: 'Go',
        system_design: 'System Design',
        behavioral: 'Behavioral',
    };
    return map[section] ?? section;
}
function LegendStrip() {
    return (_jsxs("div", { className: "flex h-14 items-center gap-4 overflow-x-auto border-t border-border bg-surface-1 px-4 sm:gap-8 sm:px-8 lg:px-20", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "h-3.5 w-3.5 rounded-full bg-accent" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u043E" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "h-3.5 w-3.5 rounded-full border-2 border-dashed border-accent-hover bg-bg" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "\u0412 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0435" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "h-3.5 w-3.5 rounded-full border border-border bg-surface-2" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "\u0417\u0430\u043A\u0440\u044B\u0442\u043E" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Hexagon, { className: "h-4 w-4 fill-warn text-warn" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "Keystone" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Hexagon, { className: "h-4 w-4 fill-pink text-pink" }), _jsx("span", { className: "font-mono text-[12px] text-text-secondary", children: "Ascendant" })] }), _jsxs("div", { className: "ml-auto flex items-center gap-2 pr-2", children: [_jsx(Sparkles, { className: "h-3.5 w-3.5 text-text-muted" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "Layout \u2014 \u0430\u0432\u0442\u043E-radial \u043F\u043E \u0442\u0438\u043F\u0443 \u0443\u0437\u043B\u0430" })] })] }));
}
export default function AtlasPage() {
    const { data: atlas, isError, isLoading, refetch } = useAtlasQuery();
    const total = atlas?.nodes.length ?? 0;
    const unlocked = atlas?.nodes.filter((n) => n.unlocked).length ?? 0;
    // Default-выделение: центральный узел, чтобы боковая панель не была
    // пустой при первом открытии.
    const [selectedKey, setSelectedKey] = useState(null);
    const effectiveKey = selectedKey ?? atlas?.center_node ?? null;
    const selectedNode = atlas && effectiveKey ? atlas.nodes.find((n) => n.key === effectiveKey) ?? null : null;
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col", children: [_jsx(HeaderStrip, { unlocked: unlocked, total: total, isError: isError, onRetry: () => void refetch() }), _jsxs("div", { className: "flex flex-col lg:flex-row", children: [isLoading ? (_jsx(GraphSkeleton, {})) : isError || !atlas ? (_jsx("div", { className: "flex flex-1 items-center justify-center bg-bg p-8", children: _jsxs("div", { className: "flex max-w-md flex-col items-center gap-3 text-center", children: [_jsx(AlertCircle, { className: "h-8 w-8 text-danger" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0430\u0442\u043B\u0430\u0441. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u2014 \u0435\u0441\u043B\u0438 \u043E\u0448\u0438\u0431\u043A\u0430 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u0435\u0442\u0441\u044F, \u043F\u0440\u043E\u0432\u0435\u0440\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435." }), _jsx(Button, { variant: "primary", icon: _jsx(RotateCcw, { className: "h-3.5 w-3.5" }), onClick: () => void refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }) })) : atlas.nodes.length === 0 ? (_jsx("div", { className: "flex flex-1 items-center justify-center bg-bg p-8", children: _jsx("p", { className: "max-w-md text-center text-sm text-text-secondary", children: "\u0412 \u0430\u0442\u043B\u0430\u0441\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0443\u0437\u043B\u043E\u0432. \u0420\u0435\u0448\u0438 \u043F\u0435\u0440\u0432\u0443\u044E \u0437\u0430\u0434\u0430\u0447\u0443 \u2014 \u0438 \u0441\u044E\u0434\u0430 \u043F\u0440\u0438\u0434\u0443\u0442 \u043F\u0435\u0440\u0432\u044B\u0435 \u043D\u0430\u0432\u044B\u043A\u0438." }) })) : (_jsx(GraphCanvas, { atlas: atlas, selectedKey: effectiveKey, onSelect: setSelectedKey })), _jsx(NodeDetails, { node: selectedNode })] }), _jsx(LegendStrip, {})] }) }));
}
