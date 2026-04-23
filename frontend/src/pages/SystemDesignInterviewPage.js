import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useParams } from 'react-router-dom';
import { MousePointer, Square, Circle, Diamond, Minus, ArrowRight, Type, Image as ImageIcon, ZoomIn, Download, Send, Camera, StickyNote, Sparkles, Check, Loader2, Mic, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useSysDesignSessionQuery } from '../lib/queries/sysdesign';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function Header() {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0", children: [_jsx("span", { className: "rounded-full bg-accent/15 px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover", children: "SYSTEM DESIGN \u00B7 LIVE" }), _jsxs("div", { className: "flex flex-col items-center", children: [_jsxs("span", { className: "font-display text-[20px] font-extrabold text-text-primary", children: ["47:23 ", _jsx("span", { className: "text-text-muted", children: "/ 60:00" })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "Phase 2 \u00B7 Deep dive" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", children: "\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430" }), _jsx(Button, { variant: "danger", size: "sm", children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C" })] })] }));
}
function ProblemCard({ title, description }) {
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl bg-gradient-to-br from-surface-3 to-accent p-4 shadow-glow", children: [_jsx("span", { className: "w-fit rounded-full bg-white/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary", children: "\u0417\u0410\u0414\u0410\u0427\u0410" }), _jsx("h2", { className: "font-display text-[18px] font-bold text-text-primary leading-tight", children: title }), _jsx("p", { className: "text-[12px] text-white/80", children: description })] }));
}
function ReqCard({ rows }) {
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "Functional" }), rows.map((r, i) => (_jsxs("div", { className: "flex items-center gap-2", children: [r.ok ? (_jsx(Check, { className: "h-3.5 w-3.5 text-success" })) : (_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin text-warn" })), _jsx("span", { className: "text-[12px] text-text-secondary", children: r.text })] }, i)))] }));
}
function NonFuncCard({ rows }) {
    const cls = (t) => t === 'cyan'
        ? 'bg-cyan/15 text-cyan'
        : t === 'success'
            ? 'bg-success/15 text-success'
            : t === 'warn'
                ? 'bg-warn/15 text-warn'
                : 'bg-pink/15 text-pink';
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "Non-functional" }), rows.map((r, i) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: r.l }), _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${cls(r.tone)}`, children: r.v })] }, i)))] }));
}
function ConstraintsCard({ rows }) {
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "Constraints" }), rows.map((r, i) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: r.l }), _jsx("span", { className: "font-mono text-[12px] font-semibold text-text-primary", children: r.v })] }, i)))] }));
}
function Toolbar() {
    const tools = [MousePointer, Square, Circle, Diamond, Minus, ArrowRight, Type, ImageIcon];
    const colors = ['#582CFF', '#22D3EE', '#F472B6', '#10B981', '#FBBF24', '#EF4444'];
    return (_jsxs("div", { className: "flex h-11 items-center gap-2 border-b border-border bg-surface-2 px-3", children: [_jsx("div", { className: "flex items-center gap-1", children: tools.map((Icon, i) => (_jsx("button", { className: [
                        'grid h-7 w-7 place-items-center rounded-md',
                        i === 0
                            ? 'bg-accent text-text-primary'
                            : 'text-text-secondary hover:bg-surface-3',
                    ].join(' '), children: _jsx(Icon, { className: "h-3.5 w-3.5" }) }, i))) }), _jsx("span", { className: "mx-2 h-5 w-px bg-border" }), _jsx("div", { className: "flex items-center gap-1", children: colors.map((c) => (_jsx("button", { className: "h-4 w-4 rounded-full ring-1 ring-border", style: { background: c } }, c))) }), _jsxs("div", { className: "ml-auto flex items-center gap-2", children: [_jsx("button", { className: "grid h-7 w-7 place-items-center rounded-md text-text-secondary hover:bg-surface-3", children: _jsx(ZoomIn, { className: "h-3.5 w-3.5" }) }), _jsx("button", { className: "grid h-7 w-7 place-items-center rounded-md text-text-secondary hover:bg-surface-3", children: _jsx(Download, { className: "h-3.5 w-3.5" }) })] })] }));
}
const NODES = [
    { x: 20, y: 30, w: 130, h: 40, label: 'Mobile Clients', border: 'border-cyan', bg: 'bg-cyan/10' },
    { x: 200, y: 30, w: 130, h: 40, label: 'Load Balancer', border: 'border-accent-hover', bg: 'bg-accent/10' },
    { x: 380, y: 30, w: 130, h: 40, label: 'API Gateway', border: 'border-accent-hover', bg: 'bg-accent/10' },
    { x: 100, y: 120, w: 130, h: 40, label: 'Tweet Service', border: 'border-pink', bg: 'bg-pink/10' },
    { x: 270, y: 120, w: 130, h: 40, label: 'Timeline Service', border: 'border-pink', bg: 'bg-pink/10' },
    { x: 440, y: 120, w: 130, h: 40, label: 'User Service', border: 'border-pink', bg: 'bg-pink/10' },
    { x: 30, y: 220, w: 130, h: 40, label: 'Fanout Worker', border: 'border-warn', bg: 'bg-warn/10' },
    { x: 200, y: 220, w: 130, h: 40, label: 'Redis Cache', border: 'border-warn', bg: 'bg-warn/10' },
    { x: 370, y: 220, w: 130, h: 40, label: 'Kafka', border: 'border-warn', bg: 'bg-warn/10' },
    { x: 30, y: 320, w: 130, h: 40, label: 'PostgreSQL', border: 'border-success', bg: 'bg-success/10' },
    { x: 200, y: 320, w: 130, h: 40, label: 'DynamoDB', border: 'border-success', bg: 'bg-success/10' },
    { x: 370, y: 320, w: 130, h: 40, label: 'S3', border: 'border-success', bg: 'bg-success/10' },
    { x: 540, y: 320, w: 100, h: 40, label: 'CDN', border: 'border-cyan', bg: 'bg-cyan/10' },
];
function CanvasNode({ n }) {
    return (_jsx("div", { className: `absolute flex items-center justify-center rounded-md border-2 ${n.border} ${n.bg ?? ''} text-center font-mono text-[11px] font-semibold text-text-primary`, style: { left: n.x, top: n.y, width: n.w, height: n.h }, children: n.label }));
}
function Annotation({ x, y, n, text }) {
    return (_jsxs("div", { className: "absolute flex items-center gap-1.5 rounded-full bg-surface-1 px-2.5 py-1 font-mono text-[10px] font-semibold text-accent-hover ring-1 ring-accent/40", style: { left: x, top: y }, children: [_jsx("span", { className: "grid h-4 w-4 place-items-center rounded-full bg-accent text-[9px] text-text-primary", children: n }), text] }));
}
function Sticky({ x, y, color, text, rot }) {
    return (_jsx("div", { className: "absolute w-[110px] rounded-md p-2 text-[10px] font-semibold text-bg shadow-card", style: { left: x, top: y, background: color, transform: `rotate(${rot}deg)` }, children: text }));
}
function ConnLine({ x, y, w, h }) {
    return (_jsx("div", { className: "absolute bg-border-strong", style: { left: x, top: y, width: w, height: h } }));
}
function Canvas() {
    return (_jsxs("div", { className: "flex flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1", children: [_jsx(Toolbar, {}), _jsxs("div", { className: "relative min-h-[600px] flex-1 overflow-auto bg-surface-1 p-5", children: [_jsx("div", { className: "pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30", style: {
                            background: 'radial-gradient(circle, #2D1B4D 0%, transparent 70%)',
                        } }), _jsx(ConnLine, { x: 150, y: 50, w: 50, h: 2 }), _jsx(ConnLine, { x: 330, y: 50, w: 50, h: 2 }), _jsx(ConnLine, { x: 445, y: 70, w: 2, h: 50 }), _jsx(ConnLine, { x: 165, y: 140, w: 105, h: 2 }), _jsx(ConnLine, { x: 400, y: 140, w: 40, h: 2 }), _jsx(ConnLine, { x: 165, y: 160, w: 2, h: 60 }), _jsx(ConnLine, { x: 335, y: 160, w: 2, h: 60 }), _jsx(ConnLine, { x: 505, y: 160, w: 2, h: 60 }), _jsx(ConnLine, { x: 95, y: 260, w: 2, h: 60 }), _jsx(ConnLine, { x: 265, y: 260, w: 2, h: 60 }), _jsx(ConnLine, { x: 435, y: 260, w: 2, h: 60 }), _jsx(ConnLine, { x: 500, y: 340, w: 40, h: 2 }), NODES.map((n) => (_jsx(CanvasNode, { n: n }, n.label))), _jsx(Annotation, { x: 20, y: 400, n: 1, text: "POST /tweet" }), _jsx(Annotation, { x: 200, y: 400, n: 2, text: "Fanout to followers" }), _jsx(Annotation, { x: 400, y: 400, n: 3, text: "Cache to Redis" }), _jsx(Annotation, { x: 20, y: 440, n: 4, text: "Read Home Timeline" }), _jsx(Sticky, { x: 580, y: 50, color: "#FBBF24", text: "TODO: rate limit per user", rot: -4 }), _jsx(Sticky, { x: 580, y: 150, color: "#F472B6", text: "READ: hot users \u2192 push model", rot: 5 })] })] }));
}
function AIReviewCard() {
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-4 shadow-glow", children: [_jsx("span", { className: "w-fit rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-primary", children: "AI \u0420\u0410\u0417\u0411\u041E\u0420 \u041F\u041E \u041A\u041D\u041E\u041F\u041A\u0415" }), _jsx("h3", { className: "font-display text-[15px] font-bold text-text-primary", children: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043A\u0440\u0438\u043D\u0448\u043E\u0442 \u043A\u0430\u043D\u0432\u0430\u0441\u0430 AI" }), _jsx("p", { className: "text-[11px] text-white/85", children: "AI \u043D\u0435 \u0441\u043B\u0443\u0448\u0430\u0435\u0442 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E \u2014 \u0430\u043D\u0430\u043B\u0438\u0437 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443. \u0421\u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043B\u0438 ~$0.40 \u0437\u0430 \u0441\u0435\u0441\u0441\u0438\u044E." }), _jsxs("button", { className: "inline-flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2.5 text-[13px] font-bold text-bg hover:bg-white/90", children: [_jsx(Send, { className: "h-4 w-4" }), " \u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0440\u0430\u0437\u0431\u043E\u0440 \u00B7 1 \u043A\u0440\u0435\u0434\u0438\u0442"] }), _jsxs("div", { className: "flex items-center justify-between font-mono text-[10px] text-white/70", children: [_jsx("span", { children: "\u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C 7/10" }), _jsx("span", { children: "\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439: 6 \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434" })] })] }));
}
function InterviewerCard() {
    return (_jsxs("div", { className: "flex h-[240px] flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: "A", status: "online" }), _jsx("span", { className: "font-display text-[13px] font-bold text-text-primary", children: "AI \u0418\u043D\u0442\u0435\u0440\u0432\u044C\u044E\u0435\u0440" }), _jsxs("span", { className: "ml-auto flex items-center gap-1 font-mono text-[10px] text-success", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-success" }), "\u0441\u043B\u0443\u0448\u0430\u0435\u0442"] })] }), _jsx("div", { className: "grid flex-1 place-items-center rounded-lg bg-bg", children: _jsx(Mic, { className: "h-10 w-10 text-text-muted" }) })] }));
}
function EvalCard({ rows }) {
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl bg-gradient-to-br from-surface-3 to-surface-2 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "Live evaluation" }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "\u043F\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u043C\u0443 \u0440\u0430\u0437\u0431\u043E\u0440\u0443" })] }), rows.map((r) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: r.l }), _jsx("span", { className: [
                            'font-display text-[14px] font-bold',
                            r.tone === 'success' ? 'text-success' : r.tone === 'cyan' ? 'text-cyan' : 'text-warn',
                        ].join(' '), children: r.v.toFixed(1) })] }, r.l)))] }));
}
function PhaseTracker({ ph }) {
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "\u0424\u0430\u0437\u044B" }), ph.map((p, i) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: [
                            'h-2 w-2 rounded-full',
                            p.s === 'done' ? 'bg-success' : p.s === 'active' ? 'bg-accent animate-pulse' : 'bg-border-strong',
                        ].join(' ') }), _jsx("span", { className: "text-[12px] text-text-secondary", children: p.t })] }, i)))] }));
}
function QuickActions() {
    return (_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { className: "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3", children: [_jsx(Camera, { className: "h-3 w-3" }), " \u0421\u043A\u0440\u0438\u043D\u0448\u043E\u0442"] }), _jsxs("button", { className: "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3", children: [_jsx(StickyNote, { className: "h-3 w-3" }), " \u0417\u0430\u043C\u0435\u0442\u043A\u0430"] }), _jsxs("button", { className: "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-secondary hover:bg-surface-3", children: [_jsx(Sparkles, { className: "h-3 w-3" }), " Hint"] })] }));
}
const FALLBACK_SESSION = {
    id: '',
    problem: { title: 'Спроектируй Twitter Timeline', description: 'Хронологическая лента для 300M DAU. Учти fanout, кеш и реалтайм.' },
    functional: [
        { ok: true, text: 'Публикация твитов (≤280 символов)' },
        { ok: true, text: 'Чтение Home Timeline' },
        { ok: true, text: 'Подписка на пользователей' },
        { ok: true, text: 'Лайки и ретвиты' },
        { ok: false, text: 'Уведомления (push) — обсуждаем' },
    ],
    non_functional: [
        { l: 'Latency p99', v: '< 200ms', tone: 'cyan' },
        { l: 'Доступность', v: '99.95%', tone: 'success' },
        { l: 'Throughput', v: '600k tw/s', tone: 'cyan' },
        { l: 'Read:Write', v: '100:1', tone: 'warn' },
        { l: 'Consistency', v: 'Eventual', tone: 'pink' },
    ],
    constraints: [
        { l: 'DAU', v: '300M' },
        { l: 'Tweets / day', v: '100M' },
        { l: 'Avg followers', v: '200' },
    ],
    evaluation: [
        { l: 'Requirements', v: 9.0, tone: 'success' },
        { l: 'High-level', v: 8.5, tone: 'cyan' },
        { l: 'Deep dive', v: 7.5, tone: 'warn' },
        { l: 'Trade-offs', v: 8.0, tone: 'cyan' },
        { l: 'Communication', v: 9.0, tone: 'success' },
    ],
    phases: [
        { t: 'Requirements', s: 'done' },
        { t: 'High-level design', s: 'done' },
        { t: 'Deep dive', s: 'active' },
        { t: 'Trade-offs', s: 'pending' },
    ],
    ai_credits_used: 3,
    ai_credits_max: 10,
    time_elapsed_sec: 2843,
    time_total_sec: 3600,
    current_phase: 'Phase 2 · Deep dive',
};
export default function SystemDesignInterviewPage() {
    const { sessionId } = useParams();
    const { data, isError } = useSysDesignSessionQuery(sessionId);
    const s = data ?? FALLBACK_SESSION;
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex min-h-[calc(100vh-72px)] flex-col", children: [_jsx(Header, {}), isError && (_jsx("div", { className: "flex justify-end px-4 py-2", children: _jsx(ErrorChip, {}) })), _jsxs("div", { className: "flex flex-1 flex-col gap-4 px-4 py-3 sm:px-5 lg:flex-row", children: [_jsxs("div", { className: "flex w-full flex-col gap-3 lg:w-[300px]", children: [_jsx(ProblemCard, { title: s.problem.title, description: s.problem.description }), _jsx(ReqCard, { rows: s.functional }), _jsx(NonFuncCard, { rows: s.non_functional }), _jsx(ConstraintsCard, { rows: s.constraints })] }), _jsx("div", { className: "flex flex-1 flex-col", children: _jsx(Canvas, {}) }), _jsxs("div", { className: "flex w-full flex-col gap-3 lg:w-[320px]", children: [_jsx(AIReviewCard, {}), _jsx(InterviewerCard, {}), _jsx(EvalCard, { rows: s.evaluation }), _jsx(PhaseTracker, { ph: s.phases }), _jsx(QuickActions, {})] })] }), _jsx("div", { className: "hidden", children: sessionId })] }) }));
}
