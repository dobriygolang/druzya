import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { CheckCircle2, Flame, Loader2, Play, Send, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { cn } from '../lib/cn';
import { useDailyKataQuery, useDailyRunMutation, useDailySubmitMutation, useStreakQuery, } from '../lib/queries/daily';
function Hero({ kata, isError }) {
    const { t } = useTranslation('daily');
    const { data: streak } = useStreakQuery();
    const day = streak?.current ?? 0;
    const title = kata?.task?.title ?? '—';
    const difficulty = kata?.task?.difficulty ?? '—';
    const section = kata?.task?.section ?? '—';
    return (_jsxs("div", { className: "flex flex-col items-start justify-between gap-5 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0", style: {
            minHeight: 200,
            background: 'linear-gradient(10deg, #F472B6 0%, #582CFF 100%)',
        }, children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/90 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.1em] text-bg", children: [_jsx(Flame, { className: "h-3 w-3" }), " ", t('day_of', { day })] }), _jsx("h1", { className: "font-display text-3xl font-extrabold leading-[1.05] text-white sm:text-4xl lg:text-[44px]", children: title }), isError && (_jsx("span", { className: "rounded-full bg-danger/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-white", children: t('load_failed') })), _jsxs("div", { className: "flex flex-wrap items-center gap-2 sm:gap-3", children: [_jsx(MetaTag, { children: difficulty }), _jsx(MetaTag, { children: section })] })] }), _jsxs("div", { className: "flex w-full flex-row items-center justify-between gap-2 lg:w-auto lg:flex-col lg:items-end", children: [_jsx("span", { className: "font-mono text-[11px] uppercase tracking-[0.1em] text-white/80", children: t('passed_today') }), _jsx("span", { className: "font-display text-[28px] font-extrabold text-white", children: kata?.already_submitted ? '✓' : '—' }), _jsx("span", { className: "font-mono text-[13px] text-cyan", children: kata?.already_submitted ? 'ты сдал сегодня' : 'не сдано' })] })] }));
}
function MetaTag({ children }) {
    return (_jsx("span", { className: "rounded-md border border-white/30 bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-white", children: children }));
}
const DESC_TABS = ['description'];
function DescriptionCard({ kata }) {
    const { t } = useTranslation('daily');
    const [tab, setTab] = useState('description');
    const description = kata?.task?.description ?? '';
    const timeLimit = kata?.task?.time_limit_sec;
    const memoryLimit = kata?.task?.memory_limit_mb;
    return (_jsxs(Card, { className: "w-full flex-col gap-0 p-0 lg:w-[380px]", interactive: false, children: [_jsx("div", { className: "flex min-w-0 flex-wrap items-center gap-1 overflow-x-auto border-b border-border px-2", children: DESC_TABS.map((tk) => {
                    const active = tab === tk;
                    return (_jsx("button", { type: "button", onClick: () => setTab(tk), className: cn('relative h-11 shrink-0 px-3 text-[13px] font-semibold transition-colors', active
                            ? 'text-text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
                            : 'text-text-muted hover:text-text-primary'), children: t(`tabs.${tk}`) }, tk));
                }) }), _jsx("div", { className: "flex flex-col gap-4 p-5", children: tab === 'description' && (_jsxs(_Fragment, { children: [description ? (_jsx("p", { className: "whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary", children: description })) : (_jsx("p", { className: "text-[13px] italic leading-relaxed text-text-muted", children: t('no_kata_today') })), (timeLimit || memoryLimit) && (_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted", children: t('constraints') }), _jsxs("ul", { className: "flex flex-col gap-1 pl-4 text-[12px] text-text-secondary", children: [timeLimit ? _jsx("li", { className: "list-disc", children: t('time_limit', { sec: timeLimit }) }) : null, memoryLimit ? _jsx("li", { className: "list-disc", children: t('memory_limit', { mb: memoryLimit }) }) : null] })] }))] })) })] }));
}
function Editor3({ kataID, initialCode }) {
    const { t } = useTranslation('daily');
    const [code, setCode] = useState(initialCode);
    // When the kata switches (id transitions from pending → real), reset the
    // editor buffer to the new starter snippet.
    useEffect(() => {
        setCode(initialCode);
    }, [initialCode]);
    const [state, setState] = useState({ kind: 'idle' });
    const runMu = useDailyRunMutation();
    const submitMu = useDailySubmitMutation();
    const disabled = kataID === 'pending-kata';
    const onRun = () => {
        if (disabled)
            return;
        setState({ kind: 'running' });
        runMu.mutate({ kata_id: kataID, code, language: 'go' }, {
            onSuccess: (result) => setState({ kind: 'run-result', result }),
            onError: (err) => setState({
                kind: 'error',
                message: err instanceof Error ? err.message : 'Ошибка запуска',
            }),
        });
    };
    const onSubmit = () => {
        if (disabled)
            return;
        setState({ kind: 'submitting' });
        submitMu.mutate({ kata_id: kataID, code, language: 'go' }, {
            onSuccess: (result) => setState({ kind: 'submit-result', result }),
            onError: (err) => setState({
                kind: 'error',
                message: err instanceof Error ? err.message : 'Ошибка отправки',
            }),
        });
    };
    const isBusy = state.kind === 'running' || state.kind === 'submitting';
    return (_jsxs("div", { className: "flex min-h-[400px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-1", children: [_jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto border-b border-border px-3", children: [_jsx("div", { className: "flex h-10 shrink-0 items-center gap-2 border-b-2 border-accent px-3 text-[13px] font-semibold text-text-primary", children: "solution.go" }), _jsx("span", { className: "shrink-0 rounded-md bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan", children: "GO" })] }), _jsx("div", { className: "flex min-h-[280px] flex-1 overflow-hidden", children: _jsx(Editor, { language: "go", value: code, onChange: (v) => setCode(v ?? ''), theme: "vs-dark", options: {
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineHeight: 22,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                        readOnly: false,
                    } }) }), _jsx(ResultPanel, { state: state }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3", children: [_jsx("span", { className: "font-mono text-[12px] text-text-muted", children: state.kind === 'idle' ? t('tests_not_run') : statusLabel(state) }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Button, { variant: "ghost", icon: state.kind === 'running' ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" }) : _jsx(Play, { className: "h-3.5 w-3.5" }), size: "sm", onClick: onRun, disabled: isBusy || disabled, children: t('run') }), _jsx(Button, { variant: "primary", icon: state.kind === 'submitting' ? _jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" }) : _jsx(Send, { className: "h-3.5 w-3.5" }), size: "sm", className: "shadow-glow", onClick: onSubmit, disabled: isBusy || disabled, children: t('submit') })] })] })] }));
}
function statusLabel(state) {
    switch (state.kind) {
        case 'running':
            return 'Запускаем тесты…';
        case 'submitting':
            return 'Отправляем решение…';
        case 'run-result':
            return state.result.passed
                ? `OK · ${state.result.total} тест(а) · ${state.result.time_ms}ms`
                : `Не прошло — ${state.result.total} тест(а)`;
        case 'submit-result':
            return state.result.passed
                ? `Принято · +${state.result.xp_earned} XP · streak ${state.result.streak.current}🔥`
                : 'Решение не принято';
        case 'error':
            return state.message;
        case 'idle':
        default:
            return '';
    }
}
function ResultPanel({ state }) {
    if (state.kind === 'idle' || state.kind === 'running' || state.kind === 'submitting') {
        return null;
    }
    if (state.kind === 'error') {
        return (_jsxs("div", { className: "flex items-start gap-2 border-t border-border bg-danger/10 px-4 py-3 text-[12px] text-danger", children: [_jsx(XCircle, { className: "mt-0.5 h-4 w-4 shrink-0" }), _jsx("span", { className: "font-mono", children: state.message })] }));
    }
    const passed = state.kind === 'run-result' ? state.result.passed : state.result.passed;
    const lines = [];
    if (state.kind === 'run-result') {
        lines.push(state.result.output);
    }
    else {
        lines.push(`${state.result.tests_passed}/${state.result.tests_total} тестов пройдено`);
        if (state.result.passed) {
            lines.push(`+${state.result.xp_earned} XP · streak ${state.result.streak.current}🔥`);
        }
    }
    return (_jsxs("div", { className: cn('flex flex-col gap-1 border-t px-4 py-3 text-[12px] font-mono', passed ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'), children: [_jsxs("div", { className: "flex items-center gap-2", children: [passed ? _jsx(CheckCircle2, { className: "h-4 w-4" }) : _jsx(XCircle, { className: "h-4 w-4" }), _jsx("span", { className: "font-semibold", children: passed ? 'PASS' : 'FAIL' })] }), lines.map((l, i) => (_jsx("span", { className: "text-text-secondary", children: l }, i)))] }));
}
function StreakCard() {
    const { t } = useTranslation('daily');
    const { data: streak } = useStreakQuery();
    const current = streak?.current ?? 0;
    const history = streak?.history?.slice(-14) ?? [];
    const days = Array.from({ length: 14 }, (_, i) => Boolean(history[i]));
    return (_jsxs(Card, { className: "flex-col gap-3 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: t('streak_progress') }), _jsx("div", { className: "grid grid-cols-7 gap-1.5", children: days.map((done, i) => (_jsx("div", { className: cn('aspect-square rounded-sm', done ? 'bg-gradient-to-br from-warn to-pink' : 'bg-surface-1') }, i))) }), _jsxs("div", { className: "mt-1 flex flex-col items-center gap-0.5", children: [_jsxs("span", { className: "font-display text-[26px] font-extrabold text-warn", children: [current, " \uD83D\uDD25"] }), _jsx("span", { className: "text-[11px] text-text-muted", children: t('consecutive_days') })] })] }));
}
export default function DailyPage() {
    const { data: kata, isError } = useDailyKataQuery();
    const kataID = useMemo(() => kata?.task?.id ?? 'pending-kata', [kata]);
    const starter = useMemo(() => kata?.task?.starter_code?.go ?? '', [kata]);
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, { kata: kata, isError: isError }), _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8", style: { minHeight: 'calc(100vh - 72px - 200px)' }, children: [_jsx(DescriptionCard, { kata: kata }), _jsx(Editor3, { kataID: kataID, initialCode: starter }), _jsx("div", { className: "flex w-full flex-col gap-4 lg:w-[240px]", children: _jsx(StreakCard, {}) })] })] }));
}
