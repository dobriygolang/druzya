import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { Check, FileCode, Loader2, Play, Send, Upload, X, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { WSStatus } from '../components/ws/WSStatus';
import { useChannel } from '../lib/ws';
import { useArenaMatchQuery, useSubmitCodeMutation, } from '../lib/queries/arena';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function PlayerCard({ side, nick, tier, gradient, typing, }) {
    return (_jsxs("div", { className: [
            'flex items-center gap-4',
            side === 'right' ? 'flex-row-reverse text-right' : '',
        ].join(' '), children: [_jsx(Avatar, { size: "lg", gradient: gradient, initials: nick.charAt(1).toUpperCase(), status: "online" }), _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: nick }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: tier }), typing && (_jsxs("span", { className: "inline-flex items-center gap-1 font-mono text-[10px] text-success", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-success" }), "typing..."] }))] })] }));
}
function MatchHeader({ opponentTyping, opponentRunStatus }) {
    return (_jsxs("div", { className: "flex flex-col gap-4 border-b border-border bg-surface-1 px-4 py-4 sm:px-6 lg:h-[120px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0", children: [_jsx(PlayerCard, { side: "left", nick: "@you", tier: "Diamond III \u00B7 2 840 LP", gradient: "violet-cyan" }), _jsxs("div", { className: "flex flex-col items-center gap-2", children: [_jsx("span", { className: "font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[40px]", children: "12:43" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.12em] text-text-muted", children: "RANKED \u00B7 BO3 \u00B7 ROUND 1" }), _jsxs("div", { className: "flex gap-1.5", children: [_jsx("span", { className: "h-2 w-6 rounded-full bg-accent" }), _jsx("span", { className: "h-2 w-6 rounded-full bg-border" }), _jsx("span", { className: "h-2 w-6 rounded-full bg-border" })] }), opponentRunStatus && (_jsxs("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: ["opponent: ", opponentRunStatus] }))] }), _jsx(PlayerCard, { side: "right", nick: "@kirill_dev", tier: "Diamond II \u00B7 2 980 LP", gradient: "pink-violet", typing: opponentTyping })] }));
}
function TaskPanel({ title, description, difficulty, section }) {
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 border-b border-border bg-surface-2 p-4 sm:p-6 lg:w-[340px] lg:border-b-0 lg:border-r lg:overflow-y-auto", children: [_jsxs("div", { className: "flex flex-wrap gap-1.5", children: [_jsx("span", { className: "rounded-full bg-warn/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-warn", children: difficulty }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan", children: section })] }), _jsx("h2", { className: "font-display text-lg font-bold text-text-primary break-words", children: title }), _jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary break-words", children: description })] }));
}
const STARTER_GO = `package main

import "fmt"

func solve() {
\tfmt.Println("hello")
}

func main() {
\tsolve()
}
`;
// MONACO_LANG maps our ArenaLanguageKey onto the Monaco language id.
const MONACO_LANG = {
    go: 'go',
    python: 'python',
    javascript: 'javascript',
    typescript: 'typescript',
    sql: 'sql',
};
function CodeEditor({ language, code, onChange, onRun, onSubmit, isSubmitting, resultLabel, }) {
    return (_jsxs("div", { className: "flex min-w-0 flex-1 flex-col bg-surface-1", children: [_jsxs("div", { className: "flex h-11 items-center gap-3 border-b border-border bg-bg px-4", children: [_jsxs("div", { className: "flex items-center gap-2 rounded-t-md border-b-2 border-accent px-2 py-2", children: [_jsx(FileCode, { className: "h-3.5 w-3.5 text-accent-hover" }), _jsxs("span", { className: "font-mono text-[12px] text-text-primary", children: ["solution.", language === 'javascript' ? 'js' : language === 'typescript' ? 'ts' : language === 'python' ? 'py' : language] })] }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-cyan", children: language }), resultLabel && (_jsx("span", { className: "ml-auto rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success", children: resultLabel }))] }), _jsx("div", { className: "flex flex-1 overflow-hidden", children: _jsx(Editor, { language: MONACO_LANG[language], value: code, onChange: (v) => onChange(v ?? ''), theme: "vs-dark", options: {
                        minimap: { enabled: false },
                        fontSize: 12,
                        lineHeight: 20,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        tabSize: 2,
                    } }) }), _jsxs("div", { className: "flex items-center gap-4 border-t border-border bg-bg px-5 py-3", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), onClick: onRun, disabled: isSubmitting, children: "Run" }), _jsx(Button, { variant: "primary", size: "sm", icon: isSubmitting ? (_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin" })) : (_jsx(Upload, { className: "h-3.5 w-3.5" })), className: "shadow-glow", onClick: onSubmit, disabled: isSubmitting, children: "Submit" })] })] }));
}
const TESTS = [
    { status: 'ok', name: 'empty string', time: '0.4ms' },
    { status: 'ok', name: 'single char', time: '0.6ms' },
    { status: 'ok', name: 'all unique', time: '1.2ms' },
    { status: 'loading', name: 'long ascii', time: '...' },
    { status: 'fail', name: 'unicode edge case', time: '8.1ms' },
];
function TestIcon({ status }) {
    if (status === 'ok')
        return (_jsx("span", { className: "grid h-5 w-5 place-items-center rounded-full bg-success/20", children: _jsx(Check, { className: "h-3 w-3 text-success" }) }));
    if (status === 'loading')
        return (_jsx("span", { className: "grid h-5 w-5 place-items-center rounded-full bg-cyan/20", children: _jsx(Loader2, { className: "h-3 w-3 animate-spin text-cyan" }) }));
    return (_jsx("span", { className: "grid h-5 w-5 place-items-center rounded-full bg-danger/20", children: _jsx(X, { className: "h-3 w-3 text-danger" }) }));
}
function TestList({ opponentTests }) {
    return (_jsxs(Card, { className: "flex-col gap-2 p-4", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between pb-1", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0422\u0435\u0441\u0442\u044B" }), _jsxs("span", { className: "font-mono text-[11px] text-cyan", children: ["opponent: ", opponentTests] })] }), TESTS.map((t, i) => (_jsxs("div", { className: "flex items-center gap-3 rounded-md px-1 py-1.5", children: [_jsx(TestIcon, { status: t.status }), _jsx("span", { className: "flex-1 font-mono text-[12px] text-text-secondary", children: t.name }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t.time })] }, i)))] }));
}
function ChatCard() {
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3 p-4", interactive: false, children: [_jsx("div", { className: "flex items-center justify-between pb-1", children: _jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0427\u0430\u0442 \u043C\u0430\u0442\u0447\u0430" }) }), _jsx("div", { className: "flex flex-1 flex-col gap-2 overflow-y-auto" }), _jsxs("div", { className: "flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2", children: [_jsx("input", { className: "flex-1 bg-transparent font-sans text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none", placeholder: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435..." }), _jsx("button", { className: "grid h-6 w-6 place-items-center rounded text-text-muted hover:text-text-primary", children: _jsx(Send, { className: "h-3.5 w-3.5" }) })] })] }));
}
// inferLanguage maps the match section to a default editor language. SQL
// matches obviously use SQL; everything else defaults to Go for now (the
// backend accepts a per-submission language switch via SubmitCode).
function inferLanguage(section) {
    if (section === 'sql')
        return 'sql';
    return 'go';
}
export default function ArenaMatchPage() {
    const { matchId } = useParams();
    const navigate = useNavigate();
    const channel = matchId ? `arena/${matchId}` : '';
    const { lastEvent, data, status, send } = useChannel(channel);
    const { data: match, isError, isLoading } = useArenaMatchQuery(matchId);
    const submit = useSubmitCodeMutation();
    const taskTitle = match?.task?.title ?? '…';
    const taskDesc = match?.task?.description ?? '';
    const taskDifficulty = match?.task?.difficulty ?? 'Medium';
    const taskSection = match?.task?.section ?? 'algorithms';
    const language = useMemo(() => inferLanguage(match?.section), [match?.section]);
    const [code, setCode] = useState(STARTER_GO);
    // When the match loads with a starter snippet for the chosen language,
    // adopt it once. We deliberately don't overwrite user edits afterwards.
    const adoptedStarter = useRef(false);
    useEffect(() => {
        if (adoptedStarter.current)
            return;
        const starter = match?.task?.starter_code?.[language];
        if (starter) {
            setCode(starter);
            adoptedStarter.current = true;
        }
    }, [match, language]);
    const [opponentTyping, setOpponentTyping] = useState(false);
    const [opponentRunStatus, setOpponentRunStatus] = useState(null);
    const [opponentTests, setOpponentTests] = useState('—');
    const [resultLabel, setResultLabel] = useState(null);
    const [submitError, setSubmitError] = useState(null);
    useEffect(() => {
        if (!lastEvent || !data)
            return;
        if (lastEvent === 'opponent_typing') {
            setOpponentTyping(Boolean(data.active));
        }
        else if (lastEvent === 'opponent_run') {
            const tests = data.tests ?? '—';
            setOpponentRunStatus(`запустил Run · ${tests}`);
            setOpponentTests(tests);
            window.setTimeout(() => setOpponentRunStatus(null), 4000);
        }
        else if (lastEvent === 'match_result' && matchId) {
            navigate(`/match/${matchId}/end`);
        }
        else if (lastEvent === 'submission_result') {
            const r = data;
            setResultLabel(r.passed
                ? `passed ${r.tests_passed ?? '?'}/${r.tests_total ?? '?'}`
                : `failed ${r.tests_passed ?? 0}/${r.tests_total ?? '?'}`);
        }
    }, [lastEvent, data, matchId, navigate]);
    // Debounced WS notification of code-edit progress. We only ever send
    // size + line-count, never the actual code (bible §11 leakage).
    const debounceRef = useRef(null);
    const handleCodeChange = useCallback((next) => {
        setCode(next);
        if (debounceRef.current)
            window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            send('code_update', {
                bytes: next.length,
                lines: next.split('\n').length,
            });
        }, 300);
    }, [send]);
    const handleSubmit = useCallback(() => {
        if (!matchId)
            return;
        setSubmitError(null);
        setResultLabel(null);
        submit.mutate({ matchId, code, language }, {
            onSuccess: (r) => {
                setResultLabel(r.passed
                    ? `passed ${r.tests_passed}/${r.tests_total}`
                    : `failed ${r.tests_passed}/${r.tests_total}`);
                if (r.passed) {
                    // Match is now finished server-side; navigate when we receive
                    // the WS match_result envelope. Fallback: kick to end after 2s.
                    window.setTimeout(() => navigate(`/match/${matchId}/end`), 2_000);
                }
            },
            onError: (e) => {
                setSubmitError(e.message ?? 'submit failed');
            },
        });
    }, [matchId, code, language, submit, navigate]);
    const handleRun = useCallback(() => {
        // For MVP "Run" exercises the same backend submit endpoint — Judge0
        // already runs every test. UI distinguishes by NOT navigating away.
        if (!matchId)
            return;
        setResultLabel('running…');
        submit.mutate({ matchId, code, language }, {
            onSuccess: (r) => setResultLabel(r.passed
                ? `run ok ${r.tests_passed}/${r.tests_total}`
                : `run ${r.tests_passed}/${r.tests_total}`),
            onError: (e) => setResultLabel(`error: ${e.message}`),
        });
    }, [matchId, code, language, submit]);
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "relative flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]", children: [_jsxs("div", { className: "absolute right-4 top-4 z-10 flex items-center gap-2", children: [isError && _jsx(ErrorChip, {}), _jsx(WSStatus, { status: status })] }), _jsx(MatchHeader, { opponentTyping: opponentTyping, opponentRunStatus: opponentRunStatus }), _jsxs("div", { className: "flex flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden", children: [_jsx(TaskPanel, { title: isLoading ? 'Загружаем задачу…' : taskTitle, description: taskDesc, difficulty: taskDifficulty, section: taskSection }), _jsx(CodeEditor, { language: language, code: code, onChange: handleCodeChange, onRun: handleRun, onSubmit: handleSubmit, isSubmitting: submit.isPending, resultLabel: submitError ? `err: ${submitError}` : resultLabel }), _jsxs("div", { className: "flex w-full flex-col gap-4 border-t border-border bg-bg p-4 lg:w-[300px] lg:border-l lg:border-t-0", children: [_jsx(TestList, { opponentTests: opponentTests }), _jsx(ChatCard, {})] })] })] }) }));
}
