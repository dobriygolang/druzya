import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useParams } from 'react-router-dom';
import { AlertTriangle, CalendarPlus, Skull, Sparkles, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useInterviewAutopsyQuery } from '../lib/queries/interviewAutopsy';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function Hero({ title, role, date, duration, verdict, verdictSub }) {
    return (_jsxs("div", { className: "relative flex flex-col items-start justify-between gap-4 overflow-hidden border-b border-border px-4 py-6 sm:px-6 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0", style: { background: 'linear-gradient(135deg, #2A0510 0%, #0A0A0F 100%)' }, children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-danger", children: [_jsx(Skull, { className: "h-3 w-3" }), " INTERVIEW AUTOPSY \u00B7 \u041F\u041E\u0421\u041B\u0415 \u0421\u041E\u0411\u0415\u0421\u0410"] }), _jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-extrabold leading-[1.1] text-text-primary", children: title }), _jsxs("p", { className: "text-[13px] text-text-secondary", children: [role, " \u00B7 ", date, " \u00B7 ", duration, " \u043C\u0438\u043D"] })] }), _jsxs("div", { className: "flex flex-col items-end gap-2", children: [_jsx("span", { className: "rounded-lg border-2 border-danger bg-danger/10 px-4 py-2 font-extrabold tracking-wide text-danger", style: { fontFamily: '"Geist Mono", monospace', fontSize: 18, fontWeight: 800 }, children: verdict }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: verdictSub })] })] }));
}
function TimelineCard({ events }) {
    const colorMap = {
        success: 'bg-success/15 text-success',
        warn: 'bg-warn/15 text-warn',
        danger: 'bg-danger/15 text-danger',
    };
    return (_jsxs(Card, { className: "flex-col gap-4 p-6", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0427\u0442\u043E \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E" }), _jsx("div", { className: "flex flex-col gap-3", children: events.map((e, i) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "w-12 font-mono text-[12px] text-text-muted", children: e.time }), _jsxs("div", { className: "flex flex-1 items-center justify-between rounded-lg bg-surface-1 px-4 py-3", children: [_jsx("span", { className: "text-[13px] text-text-secondary", children: e.label }), _jsx("span", { className: `rounded-full px-2.5 py-1 font-mono text-[10px] font-bold ${colorMap[e.color]}`, children: e.status })] })] }, i))) })] }));
}
function FailRowsCard({ rows }) {
    return (_jsxs(Card, { className: "flex-col gap-4 border-danger/40 p-6", interactive: false, children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "h-5 w-5 text-danger" }), _jsx("h3", { className: "font-display text-base font-bold text-danger", children: "\u0413\u0434\u0435 \u0438\u043C\u0435\u043D\u043D\u043E \u043F\u043E\u0442\u0435\u0440\u044F\u043B" })] }), rows.map((r, i) => (_jsxs("div", { className: "flex items-start gap-3 rounded-lg bg-surface-1 p-4", children: [_jsx("span", { className: "rounded bg-danger/20 px-2 py-1 font-mono text-[10px] font-bold text-danger", children: r.tag }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: r.title }), _jsx("span", { className: "text-[12px] text-text-secondary", children: r.sub })] }), _jsx("span", { className: "rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[10px] font-bold text-danger", children: r.level === 'red flag' ? 'красный флаг' : r.level })] }, i)))] }));
}
function VerdictCard({ text }) {
    return (_jsxs(Card, { className: "flex-col gap-3 border-danger/30 bg-gradient-to-br from-danger/40 to-accent/40 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Sparkles, { className: "h-4 w-4 text-text-primary" }), _jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0427\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0431\u044B\u043B\u043E \u0441\u043A\u0430\u0437\u0430\u0442\u044C" })] }), _jsx("p", { className: "text-[13px] leading-relaxed text-white/90", children: text })] }));
}
function ActionPlanCard({ actions }) {
    return (_jsxs(Card, { className: "flex-col gap-3 border-accent/40 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043B\u0430\u043D \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439" }), actions.map((a, i) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("span", { className: [
                            'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                            a.p === 'P1' ? 'bg-danger/30 text-danger' : a.p === 'P2' ? 'bg-warn/30 text-warn' : 'bg-cyan/30 text-cyan',
                        ].join(' '), children: a.p }), _jsx("span", { className: "text-[13px] text-text-secondary", children: a.text })] }, i)))] }));
}
function ApplyCard({ weeks }) {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0417\u0430\u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0434\u0430\u0442\u0443" }), _jsxs("p", { className: "text-[12px] text-text-secondary", children: ["\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u043C \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0447\u0435\u0440\u0435\u0437 ", weeks, " \u043D\u0435\u0434\u0435\u043B\u044C."] }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(CalendarPlus, { className: "h-4 w-4" }), children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043A\u0430\u043B\u0435\u043D\u0434\u0430\u0440\u044C" })] }));
}
const FALLBACK_TIMELINE = [
    { time: '0:08', label: 'Two Sum — оптимально', status: 'PASSED', color: 'success' },
    { time: '0:18', label: 'String parsing — частично', status: 'PARTIAL', color: 'warn' },
    { time: '0:42', label: 'System Design — Twitter feed', status: 'FAILED', color: 'danger' },
    { time: '0:58', label: 'Behavioral — конфликт в команде', status: 'SKIPPED', color: 'danger' },
];
const FALLBACK_FAILURES = [
    { tag: 'SD', title: 'CACHING', sub: 'не упомянул Redis для hot-feed', level: 'critical' },
    { tag: 'BEH', title: 'STAR', sub: 'ответ без структуры (Situation-Task-Action-Result)', level: 'critical' },
    { tag: 'ENG', title: 'ENGAGEMENT', sub: 'не задал ни одного вопроса интервьюеру', level: 'red flag' },
];
const FALLBACK_PLAN = [
    { p: 'P1', text: 'Прорешать 5 system design кейсов (caching focus)' },
    { p: 'P1', text: 'Записать 3 STAR-истории про конфликты' },
    { p: 'P2', text: 'Подготовить 5 умных вопросов интервьюеру' },
    { p: 'P3', text: 'Mock-собес с senior через 7 дней' },
];
export default function InterviewAutopsyPage() {
    const { id } = useParams();
    const { data, isError } = useInterviewAutopsyQuery(id);
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, { title: data?.title ?? 'Не взяли в Yandex — разбираем почему', role: data?.role ?? 'Senior Backend', date: data?.date ?? '28 апреля', duration: data?.duration_min ?? 60, verdict: data?.verdict ?? 'REJECTED', verdictSub: data?.verdict_sub ?? 'после фидбека HR' }), isError && (_jsx("div", { className: "flex justify-end px-4 py-2", children: _jsx(ErrorChip, {}) })), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-6", children: [_jsx(TimelineCard, { events: data?.timeline ?? FALLBACK_TIMELINE }), _jsx(FailRowsCard, { rows: data?.failures ?? FALLBACK_FAILURES })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[380px]", children: [_jsx(VerdictCard, { text: data?.ai_verdict ?? '«Для горячего feed — Redis Sorted Set с TTL 5 мин, fallback в БД. Для celebrity-аккаунтов переходим на pull-модель, чтобы не флудить миллион очередей при каждом твите».' }), _jsx(ActionPlanCard, { actions: data?.action_plan ?? FALLBACK_PLAN }), _jsx(ApplyCard, { weeks: data?.next_attempt_weeks ?? '6-8' })] })] })] }));
}
