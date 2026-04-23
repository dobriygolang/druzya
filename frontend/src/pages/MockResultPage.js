import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// MockResultPage — post-interview AI report.
// Wires:
//   - GET /mock/session/:id/report  via useMockReportQuery (polled until ready)
//   - "Replay интервью" → /mock/:id/replay
//   - "Слушать разбор" → POST /voice/tts (premium-only; 402 → upsell modal)
//
// Cards that don't yet have a backing endpoint (StressTimelineCard,
// CompanyScoreCard) are MVP-static and clearly marked.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Loader2, Plus, RotateCcw, Sparkles, Volume2, X, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useMockReportQuery } from '../lib/queries/mock';
import { API_BASE } from '../lib/apiClient';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function Header({ onBack, onReplay, onListen, listening, premiumGated, }) {
    return (_jsxs("div", { className: "flex h-16 items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-8", children: [_jsx("button", { type: "button", onClick: onBack, className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2", "aria-label": "back", children: _jsx(ArrowLeft, { className: "h-5 w-5" }) }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "AI Mock Review" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Download, { className: "h-4 w-4" }), disabled: true, children: "Export PDF" }), _jsx(Button, { variant: "ghost", size: "sm", icon: listening ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Volume2, { className: "h-4 w-4" }), onClick: onListen, title: premiumGated ? 'Премиум-голос — для подписчиков' : 'Озвучить разбор', children: "\u0421\u043B\u0443\u0448\u0430\u0442\u044C \u0440\u0430\u0437\u0431\u043E\u0440" }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(RotateCcw, { className: "h-4 w-4" }), onClick: onReplay, children: "Replay \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E" })] })] }));
}
function Hero({ overall }) {
    return (_jsxs("div", { className: "relative flex flex-col items-start justify-between gap-4 overflow-hidden border-b border-border bg-gradient-to-r from-surface-3 to-accent px-4 py-6 sm:px-6 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: [_jsx(Sparkles, { className: "h-3 w-3" }), " AI MOCK \u00B7 \u0417\u0410\u0412\u0415\u0420\u0428\u0401\u041D"] }), _jsxs("h1", { className: "font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold leading-[1.1] text-text-primary", children: ["Overall: ", overall, " / 100"] }), _jsxs("p", { className: "text-[13px] text-white/80", children: ["\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C \u043A Senior Yandex Backend: ", overall, "%"] })] }), _jsxs("div", { className: "flex flex-col items-end gap-2", children: [_jsx("span", { className: "rounded-lg border-2 border-warn bg-warn/10 px-4 py-2 font-display text-[18px] font-extrabold tracking-wide text-warn", style: { fontFamily: '"Geist Mono", monospace' }, children: "STRONG MIDDLE" }), _jsx("span", { className: "font-mono text-[11px] text-white/70", children: "verdict" })] })] }));
}
function SectionCard({ label, value, variant, comment, }) {
    const color = variant === 'success' ? 'text-success' : 'text-warn';
    const bar = variant === 'success' ? 'bg-success' : 'bg-warn';
    return (_jsxs(Card, { className: "flex-1 flex-col gap-2 p-5", interactive: false, children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: label.toUpperCase() }), _jsxs("div", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: `font-display text-[28px] font-extrabold ${color}`, children: value }), _jsx("span", { className: "text-[12px] text-text-muted", children: "/ 100" })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: `h-full ${bar}`, style: { width: `${value}%` } }) }), _jsx("p", { className: "text-[12px] leading-relaxed text-text-secondary", children: comment })] }));
}
function StrengthsCard({ items }) {
    return (_jsxs(Card, { className: "flex-col gap-3 border-success/40 p-[22px]", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-success", children: "\u0421\u0438\u043B\u044C\u043D\u044B\u0435 \u0441\u0442\u043E\u0440\u043E\u043D\u044B" }), items.map((t, i) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx(Check, { className: "mt-0.5 h-4 w-4 shrink-0 text-success" }), _jsx("span", { className: "text-[13px] text-text-secondary", children: t })] }, i)))] }));
}
function WeaknessesCard({ items }) {
    return (_jsxs(Card, { className: "flex-col gap-3 border-danger/40 p-[22px]", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-danger", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u043C\u0435\u0441\u0442\u0430" }), items.map((t, i) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx(X, { className: "mt-0.5 h-4 w-4 shrink-0 text-danger" }), _jsx("span", { className: "text-[13px] text-text-secondary", children: t })] }, i)))] }));
}
function RecsCard({ items }) {
    return (_jsxs(Card, { className: "flex-col gap-3 border-accent/40 bg-gradient-to-br from-accent/40 to-pink/30 p-[22px]", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438" }), items.map((it, i) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("span", { className: [
                            'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                            it.p === 'P1' ? 'bg-danger/30 text-danger' : 'bg-warn/30 text-warn',
                        ].join(' '), children: it.p }), _jsx("span", { className: "text-[13px] text-text-secondary", children: it.text })] }, i)))] }));
}
function StressTimelineCard() {
    const bars = [30, 35, 28, 40, 45, 50, 55, 70, 60, 92, 75, 50];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u0421\u0442\u0440\u0435\u0441\u0441 \u043F\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438" }), _jsx("span", { className: "font-mono text-[11px] text-danger", children: "peak 32:00" })] }), _jsx("div", { className: "flex h-24 items-end gap-1.5", children: bars.map((h, i) => (_jsx("div", { className: [
                        'flex-1 rounded-t',
                        h > 80 ? 'bg-danger' : h > 60 ? 'bg-warn' : 'bg-cyan/60',
                    ].join(' '), style: { height: `${h}%` } }, i))) }), _jsxs("div", { className: "flex justify-between font-mono text-[10px] text-text-muted", children: [_jsx("span", { children: "0:00" }), _jsx("span", { children: "30:00" }), _jsx("span", { children: "45:00" })] })] }));
}
function CompanyScoreCard() {
    const rows = [
        { c: 'Yandex', v: 72 },
        { c: 'Tinkoff', v: 78 },
        { c: 'VK', v: 80 },
        { c: 'Avito', v: 85 },
        { c: 'Сбер', v: 76 },
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u041F\u043E \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044F\u043C" }), rows.map((r) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "w-16 text-[13px] text-text-secondary", children: r.c }), _jsx("div", { className: "flex h-1.5 flex-1 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full bg-gradient-to-r from-cyan to-accent", style: { width: `${r.v}%` } }) }), _jsxs("span", { className: "font-mono text-[12px] font-semibold text-text-primary", children: [r.v, "%"] })] }, r.c)))] }));
}
function ApplyCard() {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u043A \u043F\u043B\u0430\u043D\u0443" }), _jsx("p", { className: "text-[12px] text-text-secondary", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u043C 4 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438 \u0432 \u0442\u0432\u043E\u0439 30-\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043F\u043B\u0430\u043D \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0438." }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(Plus, { className: "h-4 w-4" }), children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043F\u043B\u0430\u043D" })] }));
}
function PremiumModal({ onClose }) {
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4", children: _jsxs("div", { className: "w-full max-w-md rounded-xl border border-warn/40 bg-surface-1 p-6 shadow-xl", children: [_jsx("h3", { className: "font-display text-lg font-bold text-warn", children: "\u041F\u0440\u0435\u043C\u0438\u0443\u043C-\u0433\u043E\u043B\u043E\u0441 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u043E\u0432" }), _jsx("p", { className: "mt-2 text-[13px] text-text-secondary", children: "\u041E\u0437\u0432\u0443\u0447\u043A\u0430 \u0440\u0430\u0437\u0431\u043E\u0440\u0430 \u0441 \u043F\u0440\u0435\u043C\u0438\u0443\u043C-\u0433\u043E\u043B\u043E\u0441\u043E\u043C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u043D\u0430 \u0442\u0430\u0440\u0438\u0444\u0430\u0445 Seeker \u0438 Ascendant. \u0411\u0430\u0437\u043E\u0432\u044B\u0439 \u0440\u0430\u0437\u0431\u043E\u0440 (\u0442\u0435\u043A\u0441\u0442 + \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043D\u044B\u0439 TTS) \u0443\u0436\u0435 \u0432\u043A\u043B\u044E\u0447\u0451\u043D \u0432 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0439 \u0442\u0430\u0440\u0438\u0444." }), _jsxs("div", { className: "mt-4 flex justify-end gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: onClose, children: "\u041D\u0435 \u0441\u0435\u0439\u0447\u0430\u0441" }), _jsx(Button, { variant: "primary", size: "sm", onClick: () => { window.location.href = '/settings#billing'; }, children: "\u041E\u0444\u043E\u0440\u043C\u0438\u0442\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443" })] })] }) }));
}
export default function MockResultPage() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const { data: report, isError, isLoading } = useMockReportQuery(sessionId);
    const isProcessing = report?.status === 'processing' || (!report && isLoading);
    // Empty / fallback values keep the page rendering coherently while the
    // worker is still grading. Once the report lands, every cell shows real
    // numbers — no hardcoded "72" sneaks through.
    const overall = report?.overall_score ?? 0;
    const sections = report?.sections ?? {};
    const ps = sections['problem_solving'] ?? { score: 0, comment: '—' };
    const cq = sections['code_quality'] ?? { score: 0, comment: '—' };
    const cm = sections['communication'] ?? { score: 0, comment: '—' };
    const sh = sections['stress_handling'] ?? { score: 0, comment: '—' };
    const strengths = report?.strengths ?? [];
    const weaknesses = report?.weaknesses ?? [];
    const recs = (report?.recommendations ?? []).map((r, i) => ({ p: i < 2 ? 'P1' : 'P2', text: r.title }));
    // ── audio playback ──────────────────────────────────────────────────
    const [audioURL, setAudioURL] = useState(null);
    const [listening, setListening] = useState(false);
    const [showPremium, setShowPremium] = useState(false);
    const [premiumGated, setPremiumGated] = useState(false);
    const buildSummary = () => {
        if (!report)
            return '';
        const head = `Общий балл ${report.overall_score} из 100. `;
        const body = (report.strengths ?? []).slice(0, 3).join('. ');
        const tail = (report.recommendations ?? []).slice(0, 2).map((r) => r.title).join('. ');
        return [head, body, tail].filter(Boolean).join(' ');
    };
    const onListen = async () => {
        const text = buildSummary();
        if (!text)
            return;
        setListening(true);
        try {
            const token = localStorage.getItem('druz9_access_token');
            const res = await fetch(`${API_BASE}/voice/tts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({ text, voice: 'premium-male', lang: 'ru-RU' }),
            });
            if (res.status === 402) {
                setPremiumGated(true);
                setShowPremium(true);
                return;
            }
            if (res.status === 501) {
                // Defensive fallback — Edge TTS WS is now real, but ops may opt to
                // wire StubEdgeTTSClient (e.g. on networks that block Bing). In that
                // case fall back to browser speech synthesis so the user still
                // hears something. Ops should alarm on this header in prod.
                if ('speechSynthesis' in window) {
                    const u = new SpeechSynthesisUtterance(text);
                    u.lang = 'ru-RU';
                    window.speechSynthesis.speak(u);
                }
                return;
            }
            if (!res.ok)
                return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setAudioURL(url);
            const a = new Audio(url);
            void a.play().catch(() => undefined);
        }
        finally {
            setListening(false);
        }
    };
    return (_jsxs(AppShellV2, { children: [_jsx(Header, { onBack: () => navigate(-1), onReplay: () => sessionId && navigate(`/mock/${sessionId}/replay`), onListen: onListen, listening: listening, premiumGated: premiumGated }), _jsx(Hero, { overall: overall }), _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [isError && _jsx(ErrorChip, {}), isProcessing && (_jsxs("div", { className: "flex items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 px-4 py-3 text-[13px] text-cyan", children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin" }), "AI \u0435\u0449\u0451 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442 \u0438\u043D\u0442\u0435\u0440\u0432\u044C\u044E \u2014 \u043E\u0442\u0447\u0451\u0442 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0447\u0435\u0440\u0435\u0437 30\u201360 \u0441\u0435\u043A\u0443\u043D\u0434."] })), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: [_jsx(SectionCard, { label: "Problem Solving", value: ps.score, variant: ps.score >= 70 ? 'success' : 'warn', comment: ps.comment }), _jsx(SectionCard, { label: "Code Quality", value: cq.score, variant: cq.score >= 70 ? 'success' : 'warn', comment: cq.comment }), _jsx(SectionCard, { label: "Communication", value: cm.score, variant: cm.score >= 70 ? 'success' : 'warn', comment: cm.comment }), _jsx(SectionCard, { label: "Stress Handling", value: sh.score, variant: sh.score >= 70 ? 'success' : 'warn', comment: sh.comment })] }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-4", children: [strengths.length > 0 && _jsx(StrengthsCard, { items: strengths }), weaknesses.length > 0 && _jsx(WeaknessesCard, { items: weaknesses }), recs.length > 0 && _jsx(RecsCard, { items: recs }), report?.stress_analysis && (_jsxs(Card, { className: "flex-col gap-2 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0442\u0440\u0435\u0441\u0441-\u0430\u043D\u0430\u043B\u0438\u0437" }), _jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary", children: report.stress_analysis })] }))] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[380px]", children: [_jsx(StressTimelineCard, {}), _jsx(CompanyScoreCard, {}), _jsx(ApplyCard, {})] })] }), audioURL && (_jsx("audio", { src: audioURL, controls: true, className: "w-full" }))] }), showPremium && _jsx(PremiumModal, { onClose: () => setShowPremium(false) })] }));
}
