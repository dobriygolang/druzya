import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useParams } from 'react-router-dom';
import { Bot, Check, FileCode, Lightbulb, Play, Send, Sparkles, Upload, X, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useNativeScoreQuery } from '../lib/queries/native';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function MatchHeader({ aiUsed, aiMax }) {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[80px] lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0", children: [_jsx("div", { className: "flex items-center gap-3", children: _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: [_jsx(Sparkles, { className: "h-3 w-3" }), "AI-ALLOWED \u00B7 \u0420\u0410\u0417\u0420\u0415\u0428\u0401\u041D"] }) }), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsxs("span", { className: "font-display text-[26px] font-extrabold leading-none text-text-primary", children: ["22:14 ", _jsx("span", { className: "text-text-muted", children: "/ 60:00" })] }), _jsx("span", { className: "font-mono text-[11px] tracking-[0.08em] text-text-muted", children: "NATIVE ROUND" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn", children: ["AI \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432: ", aiUsed, " / ", aiMax] }), _jsx(Button, { variant: "ghost", icon: _jsx(Lightbulb, { className: "h-4 w-4" }), size: "sm", children: "\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430" }), _jsx(Button, { variant: "danger", size: "sm", children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C" })] })] }));
}
function QuestionPanel() {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-[18px] font-bold leading-tight text-text-primary", children: "Design Twitter Timeline System" }), _jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary", children: "\u0421\u043F\u0440\u043E\u0435\u043A\u0442\u0438\u0440\u0443\u0439 \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438 home timeline \u0434\u043B\u044F 100M \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439. \u041E\u043F\u0438\u0448\u0438 fan-out, \u043A\u044D\u0448\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0438 \u0441\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044E \u0440\u0435\u043F\u043B\u0438\u043A\u0430\u0446\u0438\u0438." }), _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [_jsx("span", { className: "rounded-full bg-danger/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-danger", children: "Senior" }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan", children: "System Design" })] })] }));
}
function AllowedToolsCard() {
    const allowed = ['GPT-4o Free', 'Claude Sonnet Free', 'Поиск по docs', 'Stack Overflow'];
    const forbidden = ['ChatGPT с web', 'Copilot in IDE'];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "text-sm font-bold text-text-primary", children: "\u0420\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0435 AI-\u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B" }), allowed.map((t) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Check, { className: "h-4 w-4 text-success" }), _jsx("span", { className: "text-[13px] text-text-secondary", children: t })] }, t))), _jsx("div", { className: "my-1 border-t border-border" }), _jsx("h4", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-danger", children: "\u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u041E:" }), forbidden.map((t) => (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(X, { className: "h-4 w-4 text-danger" }), _jsx("span", { className: "text-[13px] text-text-secondary", children: t })] }, t)))] }));
}
function UsageStatsCard({ aiUsed, aiMax, aiFraction, humanFraction }) {
    const rows = [
        { label: 'Промпты', value: `${aiUsed} / ${aiMax}` },
        { label: 'AI fraction', value: `${Math.round(aiFraction * 100)}%` },
        { label: 'Своя доля', value: `${Math.round(humanFraction * 100)}%` },
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 border-warn/30 bg-gradient-to-br from-surface-3 to-warn/30 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "AI Usage" }), rows.map((r) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[13px] text-text-secondary", children: r.label }), _jsx("span", { className: "font-mono text-[13px] font-semibold text-text-primary", children: r.value })] }, r.label)))] }));
}
function EditorArea() {
    const code = [
        '// Twitter timeline — fan-out write',
        'type Tweet struct { ID, AuthorID int64; Body string }',
        '',
        'func PostTweet(t Tweet) error {',
        '    if err := db.Insert(t); err != nil {',
        // AI suggested block 5-12
        '        return err',
        '    }',
        '    followers := graph.GetFollowers(t.AuthorID)',
        '    for _, f := range followers {',
        '        timelineCache.LPush(',
        '            keyFor(f), t.ID)',
        '    }',
        '    return nil',
        '}',
        '',
        'func GetTimeline(uid int64) []Tweet { ... }',
    ];
    return (_jsxs(Card, { className: "flex-1 flex-col p-0 overflow-hidden", interactive: false, children: [_jsxs("div", { className: "flex h-11 items-center justify-between border-b border-border px-4", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(FileCode, { className: "h-4 w-4 text-text-secondary" }), _jsx("span", { className: "font-mono text-[13px] text-text-primary", children: "timeline.go" }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: "Go" })] }), _jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-hover", children: [_jsx(Sparkles, { className: "h-3 w-3" }), " AI \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u043B \u0431\u043B\u043E\u043A 5-12"] })] }), _jsxs("div", { className: "flex flex-1 overflow-auto bg-surface-1", children: [_jsx("div", { className: "flex flex-col items-end px-3 py-3 font-mono text-[12px] text-text-muted select-none", children: code.map((_, i) => (_jsx("span", { children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3 pr-4 font-mono text-[12px] text-text-secondary", children: code.map((line, i) => {
                            const ai = i >= 4 && i <= 11;
                            return (_jsx("pre", { className: [
                                    'whitespace-pre',
                                    ai ? 'bg-accent/10 -mx-2 px-2 border-l-2 border-accent' : '',
                                ].join(' '), children: line || ' ' }, i));
                        }) })] }), _jsxs("div", { className: "flex h-14 items-center justify-between border-t border-border px-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Sparkles, { className: "h-3.5 w-3.5" }), children: "Ask AI" }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), children: "Run" }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(Upload, { className: "h-3.5 w-3.5" }), children: "Submit" })] }), _jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-warn" }), "\u041B\u043E\u0433\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0432\u043A\u043B"] })] })] }));
}
function ChatPanel() {
    const messages = [
        { role: 'user', text: 'Как реализовать LRU? O(1)' },
        {
            role: 'ai',
            text: 'Двусвязный список + хеш-таблица. На Get переноси узел в head, на Put вытесняй tail.',
            code: 'type LRU struct {\n  m map[int]*Node\n  head, tail *Node\n}',
        },
        { role: 'user', text: 'А как fan-out для 100M юзеров?' },
        {
            role: 'ai',
            text: 'Гибрид: write-fan-out для обычных, pull-on-read для celebrity (>1M фолловеров).',
        },
    ];
    return (_jsxs(Card, { className: "flex-col gap-0 p-0 overflow-hidden", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border p-4", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Bot, { className: "h-4 w-4 text-cyan" }), _jsx("span", { className: "text-sm font-bold text-text-primary", children: "Chat \u0441 GPT-4o" })] }), _jsx("span", { className: "rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn", children: "3/10" })] }), _jsx("div", { className: "flex flex-1 flex-col gap-3 overflow-auto p-4", children: messages.map((m, i) => m.role === 'user' ? (_jsx("div", { className: "flex justify-end", children: _jsx("div", { className: "max-w-[80%] rounded-lg bg-accent px-3 py-2 text-[13px] text-text-primary", children: m.text }) }, i)) : (_jsxs("div", { className: "flex gap-2", children: [_jsx(Avatar, { size: "sm", gradient: "cyan-violet", initials: "AI" }), _jsxs("div", { className: "flex max-w-[80%] flex-col gap-2 rounded-lg bg-surface-3 px-3 py-2", children: [_jsx("span", { className: "text-[13px] text-text-secondary", children: m.text }), m.code && (_jsx("pre", { className: "rounded bg-black/40 p-2 font-mono text-[11px] text-cyan whitespace-pre-wrap", children: m.code }))] })] }, i))) }), _jsxs("div", { className: "flex items-center gap-2 border-t border-border p-3", children: [_jsx("input", { placeholder: "\u0421\u043F\u0440\u043E\u0441\u0438 AI\u2026", className: "flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" }), _jsx("button", { className: "grid h-9 w-9 place-items-center rounded-md bg-accent text-text-primary shadow-glow hover:bg-accent-hover", children: _jsx(Send, { className: "h-4 w-4" }) })] })] }));
}
export default function NativeRoundPage() {
    const { sessionId } = useParams();
    const { data: score, isError } = useNativeScoreQuery(sessionId);
    const aiUsed = 3;
    const aiMax = 10;
    const aiFraction = score?.ai_fraction ?? 0.42;
    const humanFraction = score?.human_fraction ?? 0.58;
    return (_jsxs(AppShellV2, { children: [_jsx(MatchHeader, { aiUsed: aiUsed, aiMax: aiMax }), isError && (_jsx("div", { className: "flex justify-end px-4 py-2", children: _jsx(ErrorChip, {}) })), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8", children: [_jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[320px]", children: [_jsx(QuestionPanel, {}), _jsx(AllowedToolsCard, {}), _jsx(UsageStatsCard, { aiUsed: aiUsed, aiMax: aiMax, aiFraction: aiFraction, humanFraction: humanFraction })] }), _jsx("div", { className: "flex min-h-[400px] flex-1 flex-col", children: _jsx(EditorArea, {}) }), _jsx("div", { className: "flex w-full lg:w-[360px]", children: _jsx(ChatPanel, {}) })] })] }));
}
